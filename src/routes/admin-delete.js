// Secure account deletion for the admin area.
//
// Being an admin is not enough. To delete an account you must:
//   1. be listed in ADMIN_DELETE_USER_IDS (Railway) as well as ADMIN_USER_IDS;
//   2. unlock with your password AND a 6-digit code from your authenticator app
//      (secret in ADMIN_DELETE_TOTP_SECRET) - this gives a delete token valid for 5 minutes;
//   3. type the account's email to confirm each deletion.
// Admin accounts and your own account cannot be deleted here. Every deletion is
// written to AdminAuditLog and emailed to admin@riff-app.co.uk.
//
// The deletion itself runs the app's own "Delete account" route (DELETE /api/auth/me)
// on the target's behalf, so the admin area always removes exactly the same data.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { sendEmail } = require('../services/email');

const UNLOCK_MINUTES = 5;
const MAX_FAILS = 5;
const LOCKOUT_MS = 60 * 60 * 1000;
const ALERT_TO = 'admin@riff-app.co.uk';
const PAID = ['single', 'bot_connection', 'explorer', 'inner_circle'];

const fails = new Map();       // adminId -> { count, lockedUntil }
const usedSteps = new Map();   // adminId -> last TOTP time-step used (stops a code being replayed)

function ids(name) {
  return String(process.env[name] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}
function isAdmin(id) { return ids('ADMIN_USER_IDS').indexOf(id) !== -1; }
function isDeleter(id) { return isAdmin(id) && ids('ADMIN_DELETE_USER_IDS').indexOf(id) !== -1; }

async function requireDeleter(request, reply) {
  if (!ids('ADMIN_DELETE_USER_IDS').length || !process.env.ADMIN_DELETE_TOTP_SECRET) {
    return reply.code(503).send({ error: 'Secure delete is not configured.' });
  }
  if (!isDeleter(request.user.id)) {
    request.log.warn({ userId: request.user.id, route: request.url }, 'non-deleter attempted a secure delete route');
    return reply.code(403).send({ error: 'Not permitted.' });
  }
}

// ---- TOTP (RFC 6238: SHA-1, 6 digits, 30 seconds) ----
function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}
// Returns the matching time-step (allowing one step of clock drift either way), or -1.
function checkTotp(secret, code, now) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return -1;
  const step = Math.floor((now || Date.now()) / 30000);
  for (const s of [step - 1, step, step + 1]) {
    const a = Buffer.from(totpAt(secret, s)), b = Buffer.from(c);
    if (crypto.timingSafeEqual(a, b)) return s;
  }
  return -1;
}

function maskEmail(e) {
  const [u, d] = String(e || '').split('@');
  if (!d) return '***';
  return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '***') + '@' + d;
}
function planIsLive(u) {
  return PAID.indexOf(u.plan) !== -1 && (!u.planExpiresAt || new Date(u.planExpiresAt) > new Date());
}

async function adminDeleteRoutes(app) {
  const deleter = { preHandler: [app.authenticate, requireDeleter] };

  function checkDeleteToken(request) {
    const raw = request.headers['x-delete-token'];
    if (!raw) return false;
    try {
      const t = app.jwt.verify(String(raw));
      return t && t.purpose === 'admin-delete' && t.id === request.user.id;
    } catch (e) { return false; }
  }

  // The website uses this to decide whether to show the Delete accounts tab.
  app.get('/status', deleter, async () => ({ canDelete: true, unlockMinutes: UNLOCK_MINUTES }));

  // Step-up: password + authenticator code -> short-lived delete token.
  app.post('/unlock', Object.assign({ config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, deleter), async (request, reply) => {
    const me = request.user.id;
    const f = fails.get(me) || { count: 0, lockedUntil: 0 };
    if (f.lockedUntil > Date.now()) {
      return reply.code(429).send({ error: 'Too many wrong attempts. Deleting is locked until ' + new Date(f.lockedUntil).toLocaleTimeString('en-GB') + '.' });
    }
    const body = request.body || {};
    const user = await prisma.user.findUnique({ where: { id: me }, select: { passwordHash: true, alias: true } });
    const pwOk = !!(user && typeof body.password === 'string' && await bcrypt.compare(body.password, user.passwordHash));
    const step = checkTotp(process.env.ADMIN_DELETE_TOTP_SECRET, body.code);
    const replay = step !== -1 && usedSteps.get(me) !== undefined && step <= usedSteps.get(me);
    if (!pwOk || step === -1 || replay) {
      f.count += 1;
      if (f.count >= MAX_FAILS) { f.lockedUntil = Date.now() + LOCKOUT_MS; f.count = 0; }
      fails.set(me, f);
      request.log.warn({ userId: me, locked: f.lockedUntil > Date.now() }, 'secure delete unlock failed');
      if (f.lockedUntil > Date.now()) {
        sendEmail(ALERT_TO, 'Riff: secure delete locked', '<p>Secure delete was locked for an hour after ' + MAX_FAILS + ' wrong attempts on the admin account ' + (user ? user.alias : me) + '.</p>', 'Secure delete was locked for an hour after ' + MAX_FAILS + ' wrong attempts on the admin account ' + (user ? user.alias : me) + '.').catch(function () {});
        return reply.code(429).send({ error: 'Too many wrong attempts. Deleting is locked for an hour.' });
      }
      return reply.code(401).send({ error: replay ? 'That code was already used. Wait for the next one.' : 'Password or code is wrong.' });
    }
    fails.delete(me);
    usedSteps.set(me, step);
    const token = app.jwt.sign({ id: me, purpose: 'admin-delete' }, { expiresIn: UNLOCK_MINUTES + 'm' });
    return { deleteToken: token, expiresAt: new Date(Date.now() + UNLOCK_MINUTES * 60000).toISOString() };
  });

  app.get('/search', deleter, async (request) => {
    const q = String((request.query || {}).q || '').trim();
    if (q.length < 2) return { users: [] };
    const rows = await prisma.user.findMany({
      where: { OR: [{ alias: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] },
      select: { id: true, alias: true, email: true, plan: true, planExpiresAt: true, createdAt: true, lastActiveAt: true },
      orderBy: { createdAt: 'desc' }, take: 25,
    });
    return { users: rows.map(function (u) {
      return Object.assign({}, u, { isAdmin: isAdmin(u.id), isYou: u.id === request.user.id, paidLive: planIsLive(u) });
    }) };
  });

  app.post('/users/:id', deleter, async (request, reply) => {
    const me = request.user.id;
    if (!checkDeleteToken(request)) return reply.code(401).send({ error: 'Unlock again with your password and code.', relock: true });
    const targetId = request.params.id;
    if (targetId === me) return reply.code(400).send({ error: 'You cannot delete your own account here.' });
    if (isAdmin(targetId)) return reply.code(400).send({ error: 'Admin accounts cannot be deleted here. Remove them from ADMIN_USER_IDS first.' });

    const t = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, alias: true, email: true, plan: true, planExpiresAt: true } });
    if (!t) return reply.code(404).send({ error: 'Account not found.' });
    const body = request.body || {};
    if (String(body.confirmEmail || '').trim().toLowerCase() !== String(t.email).toLowerCase()) {
      return reply.code(400).send({ error: 'The email you typed does not match this account.' });
    }
    if (planIsLive(t) && body.acknowledgePaid !== true) {
      return reply.code(409).send({ error: 'This account has a live ' + t.plan + ' plan. Apple or Stripe may keep charging until the person cancels. Tick the box to confirm.', paidLive: true });
    }

    // Run the app's own deletion as the target user (token valid for one minute).
    const asTarget = app.jwt.sign({ id: t.id, alias: t.alias, role: 'user' }, { expiresIn: '1m' });
    const res = await app.inject({ method: 'DELETE', url: '/api/auth/me', headers: { authorization: 'Bearer ' + asTarget } });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      let msg = 'Delete failed.';
      try { msg = JSON.parse(res.body).error || msg; } catch (e) {}
      request.log.error({ targetId: t.id, status: res.statusCode, body: String(res.body).slice(0, 300) }, 'secure delete: account deletion failed');
      return reply.code(502).send({ error: msg + ' Nothing was deleted.' });
    }
    const still = await prisma.user.findUnique({ where: { id: t.id }, select: { id: true } });
    if (still) return reply.code(502).send({ error: 'The account still exists after deletion. Check the server log.' });

    const admin = await prisma.user.findUnique({ where: { id: me }, select: { alias: true } });
    const masked = maskEmail(t.email);
    await prisma.adminAuditLog.create({ data: {
      adminId: me, adminAlias: admin ? admin.alias : null, action: 'delete_user',
      targetId: t.id, targetAlias: t.alias, targetEmailMasked: masked,
      detail: planIsLive(t) ? 'had live plan ' + t.plan : null,
    } });
    request.log.info({ by: me, targetId: t.id }, 'secure delete: account deleted');
    const when = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });
    const line = 'The account ' + t.alias + ' (' + masked + ') was deleted by ' + (admin ? admin.alias : me) + ' on ' + when + '.';
    sendEmail(ALERT_TO, 'Riff: account deleted from the admin area', '<p>' + line + '</p><p>If this was not you, sign in, change your password and remove the account from ADMIN_DELETE_USER_IDS in Railway.</p>', line).catch(function () {});
    return { status: 'deleted', alias: t.alias };
  });

  app.get('/log', deleter, async () => ({
    entries: await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
  }));
}

module.exports = adminDeleteRoutes;
