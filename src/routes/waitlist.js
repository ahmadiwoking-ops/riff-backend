const crypto = require('crypto');
const prisma = require('../db');
const { sendEmail, launchEmail } = require('../services/email');

// Same allow-list the admin routes use. Kept in the environment so admin
// cannot be granted by editing a row.
function isAdminUser(userId) {
  const ids = String(process.env.ADMIN_USER_IDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length > 0 && ids.indexOf(userId) !== -1;
}

// Resend's free tier allows 100 a day, so a broadcast sends in bounded
// batches and can be run again to continue where it left off.
const BATCH_SIZE = 80;

async function waitlistRoutes(app) {
  // ── Public signup ──────────────────────────────────────────────────────
  app.post('/', async (request, reply) => {
    const body = request.body || {};
    const raw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!raw || raw.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      return reply.code(400).send({ error: 'Please enter a valid email address.' });
    }
    const source = typeof body.source === 'string' ? body.source.slice(0, 60) : null;

    try {
      const existing = await prisma.waitingList.findUnique({ where: { email: raw } });
      if (existing) {
        // Someone signing up again after unsubscribing is opting back in.
        if (existing.unsubbed) {
          await prisma.waitingList.update({ where: { id: existing.id }, data: { unsubbed: false } });
        }
        return { status: 'ok', alreadyOn: true };
      }
      await prisma.waitingList.create({
        data: { email: raw, source: source, unsubToken: crypto.randomBytes(24).toString('hex') },
      });
      return { status: 'ok', alreadyOn: false };
    } catch (err) {
      if (err && err.code === 'P2002') return { status: 'ok', alreadyOn: true };
      request.log.error(err, 'waitlist signup failed');
      return reply.code(500).send({ error: 'Could not add you just now. Please try again.' });
    }
  });

  // ── Public unsubscribe ─────────────────────────────────────────────────
  // A plain page rather than a JSON response: this link is clicked from an
  // email client, by a person.
  app.get('/unsubscribe', async (request, reply) => {
    const token = (request.query || {}).token;
    let ok = false;
    if (token) {
      const row = await prisma.waitingList.findUnique({ where: { unsubToken: String(token) } });
      if (row) {
        await prisma.waitingList.update({ where: { id: row.id }, data: { unsubbed: true } });
        ok = true;
      }
    }
    reply.type('text/html').send(
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Riff</title></head>' +
      '<body style="margin:0;background:#0A0E18;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">' +
      '<div style="max-width:440px;margin:80px auto;padding:32px;background:#151B2B;border-radius:16px;text-align:center;">' +
      (ok
        ? '<h1 style="font-size:20px;color:#F0ECE5;margin:0 0 12px;">You have been unsubscribed</h1>' +
          '<p style="font-size:14px;color:#94A3B8;line-height:1.7;margin:0;">We will not email you again. Sorry to see you go.</p>'
        : '<h1 style="font-size:20px;color:#F0ECE5;margin:0 0 12px;">Link not recognised</h1>' +
          '<p style="font-size:14px;color:#94A3B8;line-height:1.7;margin:0;">This unsubscribe link is invalid or has already been used. ' +
          'Email admin@riff-app.co.uk and we will remove you.</p>') +
      '</div></body></html>'
    );
  });

  // ── Admin: the list ────────────────────────────────────────────────────
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!isAdminUser(request.user.id)) return reply.code(403).send({ error: 'Not permitted.' });

    const entries = await prisma.waitingList.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, source: true, notified: true, unsubbed: true, lastError: true, createdAt: true },
    });
    return {
      total: entries.length,
      pending: entries.filter((e) => !e.notified && !e.unsubbed).length,
      notified: entries.filter((e) => e.notified).length,
      unsubbed: entries.filter((e) => e.unsubbed).length,
      entries,
    };
  });

  // ── Admin: send the launch announcement ────────────────────────────────
  // Sends only to people who have not had it and have not opted out, marking
  // each as it goes so a re-run continues rather than sending twice.
  app.post('/broadcast', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!isAdminUser(request.user.id)) return reply.code(403).send({ error: 'Not permitted.' });
    if (!process.env.RESEND_API_KEY) {
      return reply.code(503).send({ error: 'Email is not configured (RESEND_API_KEY missing).' });
    }

    const dryRun = (request.body || {}).dryRun === true;
    const targets = await prisma.waitingList.findMany({
      where: { notified: false, unsubbed: false },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    if (dryRun) {
      const remaining = await prisma.waitingList.count({ where: { notified: false, unsubbed: false } });
      return { dryRun: true, wouldSend: targets.length, remainingAfter: Math.max(0, remaining - targets.length) };
    }

    const base = process.env.PUBLIC_API_URL || 'https://api.riff-app.co.uk';
    let sent = 0;
    const failed = [];

    for (const row of targets) {
      // Older rows predate the token column.
      let token = row.unsubToken;
      if (!token) {
        token = crypto.randomBytes(24).toString('hex');
        await prisma.waitingList.update({ where: { id: row.id }, data: { unsubToken: token } });
      }
      const mail = launchEmail(base + '/api/waitlist/unsubscribe?token=' + token);
      const res = await sendEmail(row.email, mail.subject, mail.html, mail.text);

      if (res.sent) {
        await prisma.waitingList.update({ where: { id: row.id }, data: { notified: true, lastError: null } });
        sent++;
      } else {
        await prisma.waitingList.update({
          where: { id: row.id },
          data: { lastError: String(res.reason).slice(0, 200) },
        });
        failed.push({ email: row.email, reason: res.reason });
      }
    }

    const remaining = await prisma.waitingList.count({ where: { notified: false, unsubbed: false } });
    request.log.info({ sent, failed: failed.length, remaining }, 'waitlist broadcast run');
    return { sent, failed, remaining };
  });
}

module.exports = waitlistRoutes;
