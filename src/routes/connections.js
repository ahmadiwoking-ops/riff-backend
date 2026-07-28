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

  // Post-reveal decision (continue or fade)
  app.post('/:id/decision', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { decision } = request.body;
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.status(404).send({ error: 'Not found' });
    const field = conn.userAId === request.user.id ? 'userADecision' : 'userBDecision';
    const updated = await prisma.connection.update({ where: { id: conn.id }, data: { [field]: decision } });
    if (updated.userADecision && updated.userBDecision) {
      const both = updated.userADecision === 'continue' && updated.userBDecision === 'continue';
      if (both) {
        await prisma.connection.update({ where: { id: conn.id }, data: { stage: 'video', videoStartedAt: new Date() } });
        return { status: 'both_continue', message: 'You both chose to continue! Video connection unlocked.', advanced: true };
      } else {
        await prisma.connection.update({ where: { id: conn.id }, data: { stage: 'ended', isActive: false, endedAt: new Date(), endReason: 'faded' } });
        return { status: 'faded', message: 'One of you chose to fade. The connection has closed.', ended: true };
      }
    }
    return { status: 'waiting', message: 'Waiting for the other person to decide...' };
  });

  // Submit selfie for the reveal
  app.post('/:id/selfie', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { photo } = request.body;
    if (!photo) return reply.status(400).send({ error: 'photo required' });
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.status(404).send({ error: 'Not found' });
    const field = conn.userAId === request.user.id ? 'userAPhoto' : 'userBPhoto';
    const updated = await prisma.connection.update({ where: { id: conn.id }, data: { [field]: photo } });
    const bothSubmitted = !!(updated.userAPhoto && updated.userBPhoto);
    if (bothSubmitted && !updated.revealedAt) {
      await prisma.connection.update({ where: { id: conn.id }, data: { revealedAt: new Date(), revealReady: true } });
    }
    return { status: 'saved', bothSubmitted: bothSubmitted, message: bothSubmitted ? 'Both selfies in — get ready for the reveal!' : 'Selfie saved. Waiting for the other person...' };
  });

  // Get reveal photos (only returns once both submitted)
  app.get('/:id/reveal', { preHandler: [app.authenticate] }, async (request) => {
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return { error: 'Not found' };
    if (!conn.userAPhoto || !conn.userBPhoto) return { ready: false, message: 'Waiting for both selfies' };
    const isUserA = conn.userAId === request.user.id;
    return { ready: true, myPhoto: isUserA ? conn.userAPhoto : conn.userBPhoto, theirPhoto: isUserA ? conn.userBPhoto : conn.userAPhoto, revealedAt: conn.revealedAt };
  });

  // Get the Jitsi video room for this connection
  app.get('/:id/video-room', { preHandler: [app.authenticate] }, async (request) => {
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return { error: 'Not found' };
    // Unique deterministic room name both users share
    const room = 'riff-' + conn.id;
    const url = 'https://meet.jit.si/' + room;
    // 3-day timer info
    var hoursLeft = null;
    if (conn.videoStartedAt) {
      const hrs = (Date.now() - new Date(conn.videoStartedAt).getTime()) / 3600000;
      hoursLeft = Math.max(0, Math.ceil(72 - hrs));
    }
    return { room: room, url: url, videoStartedAt: conn.videoStartedAt, hoursLeft: hoursLeft, decisionReady: hoursLeft === 0 };
  });

  // Final decision after 3 days of video (continue or end)
  app.post('/:id/final-decision', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { decision } = request.body;
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.status(404).send({ error: 'Not found' });
    const field = conn.userAId === request.user.id ? 'userAFinalDecision' : 'userBFinalDecision';
    const updated = await prisma.connection.update({ where: { id: conn.id }, data: { [field]: decision } });
    if (updated.userAFinalDecision && updated.userBFinalDecision) {
      const both = updated.userAFinalDecision === 'continue' && updated.userBFinalDecision === 'continue';
      if (both) {
        await prisma.connection.update({ where: { id: conn.id }, data: { stage: 'connected' } });
        return { status: 'connected', message: 'You both chose to continue! Full connection unlocked.', advanced: true };
      } else {
        await prisma.connection.update({ where: { id: conn.id }, data: { stage: 'ending', endReason: 'ended' } });
        return { status: 'ending', message: 'The connection is ending. You can send a final goodbye message.', ending: true };
      }
    }
    return { status: 'waiting', message: 'Waiting for the other person to decide...' };
  });

  // Send a goodbye message when ending
  app.post('/:id/goodbye', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { message } = request.body;
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.status(404).send({ error: 'Not found' });
    const field = conn.userAId === request.user.id ? 'userAGoodbye' : 'userBGoodbye';
    await prisma.connection.update({ where: { id: conn.id }, data: { [field]: message || '', stage: 'ended', isActive: false, endedAt: conn.endedAt || new Date() } });
    return { status: 'sent', message: 'Your goodbye has been sent. This connection is now closed.' };
  });

  // Get goodbye messages (both, once ended)
  app.get('/:id/goodbye', { preHandler: [app.authenticate] }, async (request) => {
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return { error: 'Not found' };
    const isUserA = conn.userAId === request.user.id;
    return { myGoodbye: isUserA ? conn.userAGoodbye : conn.userBGoodbye, theirGoodbye: isUserA ? conn.userBGoodbye : conn.userAGoodbye, endReason: conn.endReason };
  });
}
module.exports = connectionRoutes;
