const prisma = require('../db');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const registerSchema = z.object({
  email: z.string().email(), password: z.string().min(8), alias: z.string().min(2).max(20),
  age: z.number().int().min(18).max(120),
  gender: z.enum(['Male', 'Female', 'Non-binary', 'No Preference', 'Prefer not to say']).optional().default('No Preference'),
  seekingGender: z.enum(['Male', 'Female', 'Non-binary', 'No Preference', 'No preference', 'A Friends Circle']).optional().default('No Preference'),
  connectionType: z.enum(['deep', 'circle', 'bot', 'all', 'both']),
});

async function authRoutes(app) {
  app.post('/register', async (request, reply) => {
    try {
      const data = registerSchema.parse(request.body);
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
      const { email, password } = request.body;
      if (!email || !password) return reply.status(400).send({ error: 'Email and password required' });
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return reply.status(401).send({ error: 'Invalid email or password' });
      if (user.isBanned) return reply.status(403).send({ error: 'Account suspended' });
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return reply.status(401).send({ error: 'Invalid email or password' });
      await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
      const token = app.jwt.sign({ id: user.id, alias: user.alias, role: 'user' });
      return { user: { id: user.id, alias: user.alias, email: user.email, plan: user.plan, trustScore: user.trustScore, idVerified: user.idVerified }, token };
    } catch (err) { app.log.error(err); return reply.status(500).send({ error: 'Login failed' }); }
  });

  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    return await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { id: true, alias: true, email: true, age: true, gender: true, seekingGender: true, connectionType: true, plan: true, trustScore: true, idVerified: true, createdAt: true },
    });
  });
}
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
        prisma.safetyFlag.deleteMany({ where: { userId: userId } }),
        prisma.notification.deleteMany({ where: { userId: userId } }),
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

module.exports = authRoutes;
