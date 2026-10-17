// RevenueCat webhook - App Store (and later Google Play) purchases.
// RevenueCat calls POST /api/revenuecat/webhook with the Authorization header
// set in its dashboard; it must match REVENUECAT_WEBHOOK_AUTH on Railway.
// Stripe (web) purchases are untouched - they still go through subscriptions.js.
const crypto = require('crypto');
const prisma = require('../db');

const PLAN_BY_PREFIX = [
  ['riff_single_', 'single'],
  ['riff_companions_', 'bot_connection'],
  ['riff_explorer_', 'explorer'],
  ['riff_inner_', 'inner_circle'],
];
const VERIFICATION_PRODUCT = 'riff_verification';
const PLAN_EVENTS = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT', 'REFUND_REVERSED'];

// Google Play ids look like "base:plan" - compare on the base part only.
function baseId(productId) { return String(productId || '').split(':')[0]; }
function planFor(productId) {
  const id = baseId(productId);
  for (const [prefix, plan] of PLAN_BY_PREFIX) if (id.startsWith(prefix)) return plan;
  return null;
}
function creditsFor(productId) {
  const m = /^riff_credits_(\d+)$/.exec(baseId(productId));
  return m ? parseInt(m[1], 10) : 0;
}

// Tolerant of stray spaces, quotes and a missing or extra "Bearer " on either side.
function clean(v) { return String(v || '').trim().replace(/^["']|["']$/g, '').trim().replace(/^Bearer\s+/i, '').trim(); }
function fingerprint(v) { return crypto.createHash('sha256').update(v).digest('hex').slice(0, 6); }
function authorised(header, log) {
  const expected = clean(process.env.REVENUECAT_WEBHOOK_AUTH);
  const got = clean(header);
  const a = Buffer.from(got), b = Buffer.from(expected);
  const ok = expected.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  // Safe hint on failure: lengths and a short hash only, never the secret itself.
  if (!ok && log) log.warn({ gotLength: got.length, expectedLength: expected.length, got: fingerprint(got), expected: fingerprint(expected) }, 'RevenueCat auth mismatch');
  return ok;
}

// The app logs in to RevenueCat with the Riff user id, so app_user_id is our User.id.
async function findUser(ev) {
  const ids = [ev.app_user_id, ev.original_app_user_id].concat(Array.isArray(ev.aliases) ? ev.aliases : []);
  for (const id of ids) {
    if (!id || String(id).startsWith('$RCAnonymousID')) continue;
    const u = await prisma.user.findUnique({
      where: { id: String(id) },
      select: { id: true, plan: true, planExpiresAt: true, creditBalance: true },
    });
    if (u) return u;
  }
  return null;
}

// Runs the update once per key; a repeat (P2002 on ProcessedPayment) is skipped.
async function onceOnly(key, userId, kind, update) {
  try {
    await prisma.$transaction([prisma.processedPayment.create({ data: { id: key, userId: userId, kind: kind } }), update]);
    return true;
  } catch (e) {
    if (e && e.code === 'P2002') return false;
    throw e;
  }
}

async function revenuecatRoutes(app) {
  app.post('/webhook', async (request, reply) => {
    if (!process.env.REVENUECAT_WEBHOOK_AUTH) {
      request.log.error('REVENUECAT_WEBHOOK_AUTH is not set');
      return reply.code(503).send({ error: 'Not configured' });
    }
    if (!authorised(request.headers.authorization, request.log)) return reply.code(401).send({ error: 'Unauthorised' });

    const ev = request.body && request.body.event;
    if (!ev || !ev.type) return reply.code(400).send({ error: 'No event' });
    const info = { type: ev.type, product: ev.product_id, env: ev.environment, eventId: ev.id };
    if (ev.type === 'TEST') { request.log.info(info, 'RevenueCat test event'); return { received: true }; }

    const user = await findUser(ev);
    if (!user) {
      // 200 so RevenueCat does not retry forever; the log shows what was missed.
      request.log.warn(Object.assign({ appUserId: ev.app_user_id }, info), 'RevenueCat event for unknown user - ignored');
      return { received: true };
    }

    const now = Date.now();
    const exp = ev.expiration_at_ms ? new Date(Number(ev.expiration_at_ms)) : null;
    const plan = planFor(ev.product_id);
    const credits = creditsFor(ev.product_id);
    const isVerification = baseId(ev.product_id) === VERIFICATION_PRODUCT;
    const isRefund = ev.cancel_reason === 'CUSTOMER_SUPPORT';
    const txn = String(ev.transaction_id || ev.id);
    let action = 'none';

    if (PLAN_EVENTS.includes(ev.type)) {
      // Purchase, renewal (also how an upgrade or a downgrade arrives), re-enabled renewal, extension.
      if (plan && exp && exp.getTime() > now) {
        // Never shorten the same plan if RevenueCat retries an older event late.
        if (user.plan === plan && user.planExpiresAt && user.planExpiresAt > exp) action = 'kept later end date';
        else {
          await prisma.user.update({ where: { id: user.id }, data: { plan: plan, planExpiresAt: exp } });
          action = 'plan ' + plan + ' until ' + exp.toISOString();
        }
      }
    } else if (ev.type === 'NON_RENEWING_PURCHASE') {
      if (credits > 0) {
        const done = await onceOnly('rc_' + txn, user.id, 'message_credits',
          prisma.user.update({ where: { id: user.id }, data: { creditBalance: { increment: credits } } }));
        action = done ? '+' + credits + ' credits' : 'credits already added';
      } else if (isVerification) {
        await prisma.user.update({ where: { id: user.id }, data: { verificationPaid: true } });
        action = 'verification paid';
      }
    } else if (ev.type === 'CANCELLATION') {
      // A normal cancel only turns off renewal - access runs to the end date already stored.
      // A refund (CUSTOMER_SUPPORT) takes the purchase back.
      if (isRefund && plan && user.plan === plan) {
        const end = exp && exp.getTime() > now ? exp : new Date(now);
        await prisma.user.update({ where: { id: user.id }, data: end.getTime() > now ? { planExpiresAt: end } : { plan: 'free', planExpiresAt: end } });
        action = 'refund: plan ends ' + end.toISOString();
      } else if (isRefund && credits > 0) {
        const take = Math.min(credits, user.creditBalance || 0);
        const done = await onceOnly('rc_refund_' + txn, user.id, 'credit_refund',
          prisma.user.update({ where: { id: user.id }, data: { creditBalance: { decrement: take } } }));
        action = done ? 'refund: -' + take + ' credits' : 'refund already handled';
      } else if (isRefund && isVerification) {
        await prisma.user.update({ where: { id: user.id }, data: { verificationPaid: false } });
        action = 'refund: verification unpaid';
      }
    } else if (ev.type === 'EXPIRATION') {
      // Only drop the plan this product gave, and not if a newer purchase pushed the end date on.
      if (plan && user.plan === plan) {
        const extended = user.planExpiresAt && exp && user.planExpiresAt.getTime() > exp.getTime() + 60 * 1000;
        if (!extended) {
          await prisma.user.update({ where: { id: user.id }, data: { plan: 'free', planExpiresAt: exp || new Date(now) } });
          action = 'expired: back to free';
        } else action = 'expiry ignored (extended)';
      }
    }
    // PRODUCT_CHANGE (a RENEWAL carries the new plan), BILLING_ISSUE, TRANSFER,
    // SUBSCRIPTION_PAUSED and anything new are logged and otherwise ignored.

    request.log.info(Object.assign({ userId: user.id, action: action }, info), 'RevenueCat event handled');
    return { received: true };
  });
}

module.exports = revenuecatRoutes;
