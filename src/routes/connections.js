const prisma = require('../db');
const bcrypt = require('bcryptjs');
const { checkStageGate, advanceStage } = require('../services/stages');

async function connectionRoutes(app) {
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.id;
    return { connections: await prisma.connection.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }], isActive: true },
      include: { userA: { select: { id: true, alias: true, trustScore: true } }, userB: { select: { id: true, alias: true, trustScore: true } } },
      orderBy: { updatedAt: 'desc' },
    }) };
  });

  app.get('/:id', { preHandler: [app.authenticate] }, async (request) => {
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id }, include: { userA: { select: { id: true, alias: true, trustScore: true } }, userB: { select: { id: true, alias: true, trustScore: true } } } });
    if (!conn) return { error: 'Not found' };
    const stageCheck = await checkStageGate(conn.id, request.user.id, conn.stage);
    return { connection: conn, stageProgress: stageCheck };
  });

  app.get('/:id/check-advance', { preHandler: [app.authenticate] }, async (request) => {
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return { error: 'Not found' };
    return { currentStage: conn.stage, ...(await checkStageGate(conn.id, request.user.id, conn.stage)) };
  });

  app.post('/:id/advance', { preHandler: [app.authenticate] }, async (request) => {
    const result = await advanceStage(request.params.id, request.user.id);
    return result.error ? { error: result.error, progress: result.progress } : result;
  });

  app.post('/test-match', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.id;
      let testUser = await prisma.user.findUnique({ where: { email: 'luna-bot@riff.app' } });
      if (!testUser) {
        testUser = await prisma.user.create({ data: { email: 'luna-bot@riff.app', alias: 'MysteryMatch', age: 27, gender: 'Female', seekingGender: 'No preference', connectionType: 'both', passwordHash: await bcrypt.hash('testpassword123', 12), trustScore: 'green', idVerified: true, selfieVerified: true, phoneVerified: true } });
      }
      const existing = await prisma.connection.findFirst({ where: { OR: [{ userAId: userId, userBId: testUser.id }, { userAId: testUser.id, userBId: userId }], isActive: true } });
      if (existing) return { connection: existing, message: 'Match exists' };
      const connection = await prisma.connection.create({ data: { userAId: userId, userBId: testUser.id, compatScore: 78 + Math.random() * 15, stage: 'questioning', isPractice: false } });
      return { connection, message: 'Test match created' };
    } catch (err) { app.log.error(err); return reply.status(500).send({ error: 'Failed: ' + err.message }); }
  });

  app.post('/:id/decision', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { decision } = request.body;
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.status(404).send({ error: 'Not found' });
    const field = conn.userAId === request.user.id ? 'userADecision' : 'userBDecision';
    const updated = await prisma.connection.update({ where: { id: conn.id }, data: { [field]: decision, revealedAt: conn.revealedAt || new Date() } });
    if (updated.userADecision && updated.userBDecision) {
      const both = updated.userADecision === 'continue' && updated.userBDecision === 'continue';
      await prisma.connection.update({ where: { id: conn.id }, data: { stage: both ? 'chapters' : 'diverged', isActive: both } });
    }
    return { status: 'recorded' };
  });
}
module.exports = connectionRoutes;
