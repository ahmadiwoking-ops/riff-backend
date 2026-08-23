const prisma = require('../db');

async function subscriptionRoutes(app) {
  app.get('/plans', async () => ({
    plans: {
      free: { name: 'Free', priceMonthly: 0, priceYearly: 0, currency: 'gbp', deepConnections: 1, circles: 1, verification: 'basic', badge: 'yellow' },
      explorer: { name: 'Explorer', priceMonthly: 599, priceYearly: 3799, currency: 'gbp', deepConnections: 2, circles: 3, verification: 'full', badge: 'green' },
      inner_circle: { name: 'Inner Circle', priceMonthly: 1199, priceYearly: 7499, currency: 'gbp', deepConnections: -1, circles: -1, verification: 'full', badge: 'green' },
      bot_connection: { name: 'Bot Connection', priceMonthly: 799, priceYearly: 7188, currency: 'gbp', deepConnections: 0, circles: 0, verification: 'none', badge: 'yellow', botMessages: 500 },
    },
  }));

  app.get('/current', { preHandler: [app.authenticate] }, async (request) => {
    return { subscription: await prisma.user.findUnique({ where: { id: request.user.id }, select: { plan: true, planExpiresAt: true } }) };
  });

  app.post('/checkout', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { plan, billing, source } = request.body;

    // Demo / no-Stripe mode: instant upgrade (used when STRIPE_SECRET_KEY is unset).
    if (!process.env.STRIPE_SECRET_KEY) {
      await prisma.user.update({
        where: { id: request.user.id },
        data: { plan, planExpiresAt: new Date(Date.now() + (billing === 'yearly' ? 365 : 30) * 86400000), idVerified: true, selfieVerified: true, phoneVerified: true, trustScore: 'green' },
      });
      return { status: 'upgraded', plan, demo: true };
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // Resolve the price FIRST so a bad plan/billing combo returns a clear 400
    // instead of a cryptic Stripe "missing price" error. Includes `single`,
    // which your app offers but the old map was missing.
    const priceMap = {
      single_monthly: process.env.STRIPE_PRICE_SINGLE_MONTHLY,
      single_yearly: process.env.STRIPE_PRICE_SINGLE_BIANNUAL,
      single_biannual: process.env.STRIPE_PRICE_SINGLE_BIANNUAL,
      explorer_monthly: process.env.STRIPE_PRICE_EXPLORER_MONTHLY,
      explorer_yearly: process.env.STRIPE_PRICE_EXPLORER_YEARLY,
      inner_circle_monthly: process.env.STRIPE_PRICE_INNER_CIRCLE_MONTHLY,
      inner_circle_yearly: process.env.STRIPE_PRICE_INNER_CIRCLE_YEARLY,
      bot_connection_monthly: process.env.STRIPE_PRICE_BOT_CONNECTION_MONTHLY,
      bot_connection_yearly: process.env.STRIPE_PRICE_BOT_CONNECTION_YEARLY,
    };
    const priceKey = `${plan}_${billing}`;
    const priceId = priceMap[priceKey];
    if (!priceId) {
      request.log.error({ plan, billing, priceKey }, 'No Stripe price configured for this plan/billing');
      return reply.code(400).send({ error: `No price configured for ${priceKey}. Set the matching STRIPE_*_PRICE_ID env var to a test-mode price id.` });
    }

    const user = await prisma.user.findUnique({ where: { id: request.user.id } });

    // Create a fresh Stripe customer and persist it.
    const createCustomer = async () => {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
      return customer.id;
    };

    let customerId = user.stripeCustomerId || (await createCustomer());

    const buildSession = (cust) => stripe.checkout.sessions.create({
      mode: 'subscription', customer: cust,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: source === 'mobile' ? 'https://api.riff-app.co.uk/api/subscriptions/payment-success' : 'https://riff-app.co.uk/get-started?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: source === 'mobile' ? 'riff://subscription?onboarding=true' : 'https://riff-app.co.uk/get-started',
      metadata: { userId: user.id, plan, billing },
    });

    let session;
    try {
      session = await buildSession(customerId);
    } catch (err) {
      // Self-heal: stored customer doesn't exist in this Stripe mode/account
      // (test/live mismatch or deleted). Recreate once and retry.
      if (err && err.code === 'resource_missing' && err.param === 'customer') {
        request.log.warn({ customerId }, 'Stored Stripe customer missing — recreating and retrying');
        customerId = await createCustomer();
        session = await buildSession(customerId);
      } else {
        throw err;
      }
    }

    return { checkoutUrl: session.url, sessionId: session.id };
  });

  app.post('/cancel', { preHandler: [app.authenticate] }, async (request, reply) => {
    // Cancel in Stripe at PERIOD END: the user keeps what they paid for, and the
    // customer.subscription.deleted webhook downgrades the plan when it actually lapses.
    const u = await prisma.user.findUnique({ where: { id: request.user.id }, select: { stripeCustomerId: true, plan: true, planExpiresAt: true } });
    if (!u) return reply.code(404).send({ error: 'User not found' });
    if (!u.stripeCustomerId || !process.env.STRIPE_SECRET_KEY) {
      // No Stripe record (e.g. comped or legacy account) — downgrade locally.
      await prisma.user.update({ where: { id: request.user.id }, data: { plan: 'free', planExpiresAt: null } });
      return { status: 'cancelled', plan: 'free' };
    }
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const subs = await stripe.subscriptions.list({ customer: u.stripeCustomerId, status: 'active', limit: 10 });
      let endsAt = null;
      for (const s of subs.data) {
        const updated = await stripe.subscriptions.update(s.id, { cancel_at_period_end: true });
        if (updated.current_period_end) endsAt = new Date(updated.current_period_end * 1000);
      }
      if (!subs.data.length) {
        await prisma.user.update({ where: { id: request.user.id }, data: { plan: 'free', planExpiresAt: null } });
        return { status: 'cancelled', plan: 'free' };
      }
      if (endsAt) await prisma.user.update({ where: { id: request.user.id }, data: { planExpiresAt: endsAt } });
      return { status: 'cancelling', plan: u.plan, accessUntil: endsAt, message: 'Your subscription will not renew. You keep full access until ' + (endsAt ? endsAt.toDateString() : 'the end of your billing period') + '.' };
    } catch (err) {
      request.log.error(err, 'stripe cancel failed');
      return reply.code(500).send({ error: 'Could not cancel your subscription. Please contact Admin@riff-app.co.uk.' });
    }
  });
// Mobile payment success page
  app.get('/payment-success', async (request, reply) => {
    reply.type('text/html').send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment Complete</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0A0E18;color:#F0ECE5;font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:24px;text-align:center}.card{max-width:380px}.spinner{width:40px;height:40px;border:3px solid rgba(34,211,238,0.2);border-top:3px solid #22D3EE;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 20px}@keyframes spin{to{transform:rotate(360deg)}}h1{font-size:22px;font-weight:800;margin-bottom:8px;color:#22D3EE}p{color:#8B8B96;font-size:14px;line-height:1.5;margin-bottom:16px}.sub{color:#4A4A54;font-size:12px;margin-top:20px}</style>
<script>
var tried = false;
function goBack() {
  if (tried) return;
  tried = true;
  // Try closing this browser tab/window first
  window.close();
  // If still here after 500ms, try deep link
  setTimeout(function() { window.location.href = 'riff://(tabs)/home'; }, 500);
}
// Auto-trigger after 2 seconds
setTimeout(goBack, 2000);
</script>
</head><body><div class="card"><div class="spinner"></div><h1>Payment Complete</h1><p>Your subscription is now active.<br>Redirecting you back to the app...</p><p class="sub">If you are not redirected automatically,<br>switch back to the Riff app manually.</p></div></body></html>`);
  });
// Verify a checkout session and activate the plan (called by mobile after Stripe redirect)
  app.post('/verify-session', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sessionId } = request.body;
    if (!sessionId || !process.env.STRIPE_SECRET_KEY) return reply.status(400).send({ error: 'Missing session' });
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid' && session.metadata?.plan) {
        await prisma.user.update({
          where: { id: request.user.id },
          data: { plan: session.metadata.plan, planExpiresAt: new Date(Date.now() + 30 * 86400000) },
        });
        return { status: 'activated', plan: session.metadata.plan };
      }
      return { status: 'pending' };
    } catch (err) {
      return reply.status(400).send({ error: 'Could not verify session' });
    }
  });
  // Stripe webhook for subscription events
  app.post('/webhook', async (request, reply) => {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return { received: true };

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = request.headers['stripe-signature'];
    let event;
    try { event = stripe.webhooks.constructEvent(request.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET); }
    catch { return reply.status(400).send({ error: 'Invalid signature' }); }

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      // Handle message credit purchases
      if (s.metadata && s.metadata.type === 'message_credits') {
        const uid = s.metadata.userId;
        const msgs = parseInt(s.metadata.messages) || 0;
        const now = new Date();
        const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
        let u = await prisma.botConnectionUsage.findFirst({ where: { userId: uid, monthStart: mStart } });
        if (!u) u = await prisma.botConnectionUsage.create({ data: { userId: uid, monthStart: mStart, messageCount: 0, bonusMessages: 0 } });
        await prisma.botConnectionUsage.update({ where: { id: u.id }, data: { bonusMessages: { increment: msgs } } });
        return { received: true };
      }
      // Handle Genie credit purchases
      if (s.metadata && s.metadata.type === 'verification_fee') {
        var vUserId = s.metadata.userId || s.client_reference_id;
        if (vUserId) { try { await prisma.user.update({ where: { id: vUserId }, data: { verificationPaid: true } }); } catch (e) {} }
        return { received: true };
      }
      if (s.metadata && s.metadata.type === 'genie_credits') {
        const guid = s.metadata.userId;
        const reqs = parseInt(s.metadata.requests) || 0;
        const gnow = new Date();
        const gStart = new Date(gnow.getFullYear(), gnow.getMonth(), 1);
        let gu = await prisma.genieUsage.findFirst({ where: { userId: guid, monthStart: gStart } });
        if (!gu) gu = await prisma.genieUsage.create({ data: { userId: guid, monthStart: gStart, requestCount: 0, bonusRequests: 0 } });
        await prisma.genieUsage.update({ where: { id: gu.id }, data: { bonusRequests: { increment: reqs } } });
        return { received: true };
      }
      const session = event.data.object;
      const { userId, plan } = session.metadata;
      if (userId && plan) {
        await prisma.user.update({
          where: { id: userId },
          data: { plan, planExpiresAt: new Date(Date.now() + 30 * 86400000), idVerified: true, selfieVerified: true, phoneVerified: true, trustScore: 'green' },
        });
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const customer = await stripe.customers.retrieve(sub.customer);
      if (customer.metadata?.userId) {
        await prisma.user.update({ where: { id: customer.metadata.userId }, data: { plan: 'free', planExpiresAt: null } });
      }
    }

    return { received: true };
  });
}

module.exports = subscriptionRoutes;
