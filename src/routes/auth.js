const prisma = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendEmail, resetEmail, verifyEmail } = require('../services/email');
const { z } = require('zod');

const registerSchema = z.object({
  email: z.string().email(), password: z.string().min(8), alias: z.string().min(2).max(20),
  age: z.number().int().min(18).max(120),
  gender: z.enum(['Male', 'Female', 'Non-binary', 'No Preference', 'Prefer not to say']).optional().default('No Preference'),
  seekingGender: z.enum(['Male', 'Female', 'Non-binary', 'No Preference', 'No preference', 'A Friends Circle']).optional().default('No Preference'),
  connectionType: z.enum(['deep', 'circle', 'bot', 'all', 'both']),
});

// Fire-and-forget: a failed send must never fail a registration.
async function sendVerification(app, user) {
  try {
    await prisma.emailVerification.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    var raw = crypto.randomBytes(32).toString('hex');
    await prisma.emailVerification.create({
      data: {
        userId: user.id,
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });
    var base = process.env.PUBLIC_API_URL || 'https://api.riff-app.co.uk';
    var mail = verifyEmail(base + '/api/auth/verify-email?token=' + raw, user.alias);
    await sendEmail(user.email, mail.subject, mail.html, mail.text);
  } catch (err) {
    app.log.error(err, 'could not send a verification email');
  }
}
async function authRoutes(app) {
  app.post('/register', async (request, reply) => {
    try {
      const data = registerSchema.parse(request.body);
      data.email = data.email.trim().toLowerCase();
      const existing = await prisma.user.findFirst({ where: { OR: [{ email: data.email }, { alias: data.alias }] } });
      if (existing) return reply.status(409).send({ error: existing.email === data.email ? 'Email already registered' : 'Alias taken' });
      const passwordHash = await bcrypt.hash(data.password, 12);
      const regIp = request.headers["x-forwarded-for"]?.split(",")[0]?.trim() || request.ip || null;
      let registrationLocation = null;
      try { const geo = await fetch("http://ip-api.com/json/" + regIp + "?fields=country,city"); const loc = await geo.json(); if (loc.country) registrationLocation = (loc.city ? loc.city + ", " : "") + loc.country; } catch {}
      const user = await prisma.user.create({
        data: { email: data.email, alias: data.alias, age: data.age, gender: data.gender, seekingGender: data.seekingGender, connectionType: data.connectionType, passwordHash, registrationIp: regIp, registrationLocation },
        select: { id: true, alias: true, email: true, plan: true, trustScore: true, idVerified: true },
      });
      sendVerification(app, user);

      const token = app.jwt.sign({ id: user.id, alias: user.alias, role: 'user' });
      return reply.status(201).send({ user, token });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      app.log.error(err);
      return reply.status(500).send({ error: 'Registration failed: ' + err.message });
    }
  });

  app.post('/login', async (request, reply) => {
    try {
      const password = (request.body || {}).password;
      const email = ((request.body || {}).email || '').trim().toLowerCase();
      if (!email || !password) return reply.status(400).send({ error: 'Email and password required' });
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return reply.status(401).send({ error: 'Invalid email or password' });
      if (user.isBanned) return reply.status(403).send({ error: 'Account suspended' });
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return reply.status(401).send({ error: 'Invalid email or password' });
      await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
      const token = app.jwt.sign({ id: user.id, alias: user.alias, role: 'user' });
      return { user: { id: user.id, alias: user.alias, email: user.email, plan: user.plan, trustScore: user.trustScore, idVerified: user.idVerified, avatarEmoji: user.avatarEmoji, avatarColour: user.avatarColour, displayPhoto: user.displayPhoto }, token };
    } catch (err) { app.log.error(err); return reply.status(500).send({ error: 'Login failed' }); }
  });

  // Always reports success, whether or not the address is registered -
  // otherwise this becomes a way to discover who has an account.
  app.post('/forgot-password', async (request) => {
    var email = ((request.body || {}).email || '').trim().toLowerCase();
    var ok = { status: 'sent' };
    if (!email) return ok;

    try {
      var user = await prisma.user.findUnique({
        where: { email: email },
        select: { id: true, alias: true, email: true, isBanned: true },
      });
      if (!user || user.isBanned) return ok;

      // Any outstanding token is spent, so only the newest link works.
      await prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      var raw = crypto.randomBytes(32).toString('hex');
      var hash = crypto.createHash('sha256').update(raw).digest('hex');
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      var base = process.env.PUBLIC_WEB_URL || 'https://riff-app.co.uk';
      var mail = resetEmail(base + '/reset-password?token=' + raw, user.alias);
      await sendEmail(user.email, mail.subject, mail.html, mail.text);
    } catch (err) {
      request.log.error(err, 'password reset request failed');
    }
    return ok;
  });

  app.post('/reset-password', async (request, reply) => {
    var body = request.body || {};
    var token = (body.token || '').trim();
    var password = body.password || '';
    if (!token) return reply.code(400).send({ error: 'That reset link is not valid.' });
    if (password.length < 8) {
      return reply.code(400).send({ error: 'Choose a password of at least 8 characters.' });
    }

    var hash = crypto.createHash('sha256').update(token).digest('hex');
    var row = await prisma.passwordReset.findUnique({ where: { tokenHash: hash } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      return reply.code(400).send({ error: 'That link has expired or has already been used. Ask for a new one.' });
    }

    var passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash: passwordHash } }),
      prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);

    return { status: 'reset' };
  });
  // Opened from an email client, by a person - so it answers with a page.
  app.get('/verify-email', async (request, reply) => {
    var token = (request.query || {}).token;
    var ok = false;
    if (token) {
      var hash = crypto.createHash('sha256').update(String(token)).digest('hex');
      var row = await prisma.emailVerification.findUnique({ where: { tokenHash: hash } });
      if (row && !row.usedAt && row.expiresAt > new Date()) {
        await prisma.$transaction([
          prisma.user.update({ where: { id: row.userId }, data: { emailVerified: true } }),
          prisma.emailVerification.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
        ]);
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
        ? '<h1 style="font-size:20px;color:#F0ECE5;margin:0 0 12px;">Email confirmed</h1>' +
          '<p style="font-size:14px;color:#94A3B8;line-height:1.7;margin:0;">Thank you. You can go back to the app now.</p>'
        : '<h1 style="font-size:20px;color:#F0ECE5;margin:0 0 12px;">Link not recognised</h1>' +
          '<p style="font-size:14px;color:#94A3B8;line-height:1.7;margin:0;">This link has expired or has already been used. Open Riff and ask for a new one.</p>') +
      '</div></body></html>'
    );
  });

  app.post('/resend-verification', { preHandler: [app.authenticate] }, async (request) => {
    var user = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { id: true, email: true, alias: true, emailVerified: true },
    });
    if (!user) return { status: 'sent' };
    if (user.emailVerified) return { status: 'already' };
    await sendVerification(app, user);
    return { status: 'sent' };
  });
  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    return await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { id: true, alias: true, email: true, age: true, gender: true, seekingGender: true, connectionType: true, plan: true, trustScore: true, idVerified: true, createdAt: true, avatarEmoji: true, avatarColour: true, displayPhoto: true },
    });
  });
  // ═══ Delete my account (App Store / Play Store requirement + UK GDPR erasure) ═══
  // Permanent and immediate. Requires the user to confirm by sending { confirm: 'DELETE' }.
  app.delete('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    if (!request.body || request.body.confirm !== 'DELETE') {
      return reply.code(400).send({ error: 'Confirmation required', code: 'CONFIRM_REQUIRED' });
    }
    try {
      const connections = await prisma.connection.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] }, select: { id: true } });
      const connIds = connections.map(function(c) { return c.id; });
      await prisma.$transaction([
        prisma.voiceScore.deleteMany({ where: { OR: [{ scorerId: userId }, { scoredId: userId }] } }),
        prisma.voiceMessage.deleteMany({ where: { senderId: userId } }),
        prisma.message.deleteMany({ where: { OR: [{ senderId: userId }, { receiverId: userId }] } }),
        ...(connIds.length ? [
          prisma.voiceScore.deleteMany({ where: { connectionId: { in: connIds } } }),
          prisma.voiceMessage.deleteMany({ where: { connectionId: { in: connIds } } }),
          prisma.message.deleteMany({ where: { connectionId: { in: connIds } } }),
        ] : []),
        prisma.connection.deleteMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] } }),
        prisma.circleMember.deleteMany({ where: { userId: userId } }),
        prisma.photo.deleteMany({ where: { userId: userId } }),
        prisma.lifeChapter.deleteMany({ where: { userId: userId } }),
        prisma.safetyFlag.updateMany({ where: { userId: userId }, data: { userId: null } }),
        prisma.safetyFlag.updateMany({ where: { reporterId: userId }, data: { reporterId: null } }),
        prisma.notification.deleteMany({ where: { userId: userId } }),
        prisma.block.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }),
        prisma.questionAnswer.deleteMany({ where: { userId: userId } }),
        prisma.botConnectionUsage.deleteMany({ where: { userId: userId } }),
        prisma.circleRoundAnswer.deleteMany({ where: { userId: userId } }),
        prisma.gameResponse.deleteMany({ where: { userId: userId } }),
        prisma.genieMessage.deleteMany({ where: { userId: userId } }),
        prisma.genieUsage.deleteMany({ where: { userId: userId } }),
        prisma.personaMemory.deleteMany({ where: { userId: userId } }),
        prisma.circleVote.deleteMany({ where: { OR: [{ targetUserId: userId }, { voterUserId: userId }] } }),
        prisma.user.delete({ where: { id: userId } }),
      ]);
      request.log.warn({ userId: userId }, 'User self-deleted account');
      return { status: 'deleted' };
    } catch (err) {
      request.log.error(err, 'self delete failed');
      return reply.code(500).send({ error: 'Could not delete account. Please contact support.' });
    }
  });

}
module.exports = authRoutes;
