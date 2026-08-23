const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const REASONS = ['harassment', 'inappropriate_content', 'spam_or_scam', 'fake_profile', 'underage', 'safety_concern', 'other'];

async function safetyRoutes(app) {
  // ═══ Report a user ═══
  // Creates a SafetyFlag for the admin queue. Immutable once filed: a reporter
  // cannot withdraw a report about someone who may then pressure them to.
  app.post('/report', { preHandler: [app.authenticate] }, async (request, reply) => {
    const reporterId = request.user.id;
    const { targetUserId, reason, details, connectionId, alsoBlock } = request.body || {};
    if (!targetUserId) return reply.code(400).send({ error: 'targetUserId is required' });
    if (targetUserId === reporterId) return reply.code(400).send({ error: 'You cannot report yourself' });
    if (!reason || REASONS.indexOf(reason) === -1) {
      return reply.code(400).send({ error: 'Invalid reason', validReasons: REASONS });
    }

    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, alias: true, email: true } });
    if (!target) return reply.code(404).send({ error: 'User not found' });

    // One open report per reporter per target — stops accidental or deliberate pile-ons.
    const existing = await prisma.safetyFlag.findFirst({
      where: { userId: targetUserId, reporterId: reporterId, status: 'pending' },
    });
    if (existing) {
      return { status: 'already_reported', message: 'You have already reported this person. Our team is reviewing it.' };
    }

    const severity = (reason === 'underage' || reason === 'safety_concern') ? 'high' : 'medium';

    await prisma.safetyFlag.create({
      data: {
        userId: targetUserId,
        reporterId: reporterId,
        subjectAliasSnapshot: target.alias,
        subjectEmailSnapshot: target.email,
        flagType: reason,
        severity: severity,
        triggerContent: details ? String(details).slice(0, 2000) : null,
        connectionId: connectionId || null,
        status: 'pending',
      },
    });

    let blocked = false;
    if (alsoBlock !== false) {
      try { await doBlock(reporterId, targetUserId, 'reported: ' + reason); blocked = true; } catch (e) { request.log.error(e, 'block during report failed'); }
    }

    request.log.warn({ reporterId, targetUserId, reason, severity }, 'user report filed');
    return {
      status: 'reported',
      blocked: blocked,
      message: blocked
        ? 'Thank you. Our team will review this, and you will not see this person again.'
        : 'Thank you. Our team will review this.',
    };
  });

  // ═══ Block ═══
  app.post('/block', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { targetUserId, reason } = request.body || {};
    if (!targetUserId) return reply.code(400).send({ error: 'targetUserId is required' });
    if (targetUserId === request.user.id) return reply.code(400).send({ error: 'You cannot block yourself' });
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!target) return reply.code(404).send({ error: 'User not found' });
    try {
      await doBlock(request.user.id, targetUserId, reason || null);
      return { status: 'blocked' };
    } catch (err) {
      request.log.error(err, 'block failed');
      return reply.code(500).send({ error: 'Could not block this person' });
    }
  });

  // ═══ Unblock ═══
  app.delete('/block/:userId', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      await prisma.block.deleteMany({ where: { blockerId: request.user.id, blockedId: request.params.userId } });
      return { status: 'unblocked' };
    } catch (err) {
      request.log.error(err, 'unblock failed');
      return reply.code(500).send({ error: 'Could not unblock' });
    }
  });

  // ═══ List who I have blocked ═══
  app.get('/blocks', { preHandler: [app.authenticate] }, async (request) => {
    const blocks = await prisma.block.findMany({
      where: { blockerId: request.user.id },
      orderBy: { createdAt: 'desc' },
    });
    const ids = blocks.map(function (b) { return b.blockedId; });
    const users = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, alias: true } })
      : [];
    const byId = {};
    users.forEach(function (u) { byId[u.id] = u.alias; });
    return {
      blocks: blocks.map(function (b) {
        return { userId: b.blockedId, alias: byId[b.blockedId] || 'Deleted user', createdAt: b.createdAt };
      }),
    };
  });

  // ═══ Valid report reasons (so the client and server never drift) ═══
  app.get('/report-reasons', async () => {
    return {
      reasons: [
        { id: 'harassment', label: 'Harassment or bullying' },
        { id: 'inappropriate_content', label: 'Inappropriate or explicit content' },
        { id: 'spam_or_scam', label: 'Spam or a scam' },
        { id: 'fake_profile', label: 'Fake profile or impersonation' },
        { id: 'underage', label: 'They appear to be under 18' },
        { id: 'safety_concern', label: 'Safety concern or threat' },
        { id: 'other', label: 'Something else' },
      ],
    };
  });
}

// Blocking is mutual in effect: the connection between the two ends, and
// neither can reach the other again. Idempotent.
async function doBlock(blockerId, blockedId, reason) {
  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: blockerId, blockedId: blockedId } },
    update: {},
    create: { blockerId: blockerId, blockedId: blockedId, reason: reason },
  });

  // If they share an active circle, blocking cannot quietly remove either of
  // them without breaking the group — so raise it for a human to judge.
  var myCircles = await prisma.circleMember.findMany({ where: { userId: blockerId, isActive: true }, select: { circleId: true } });
  if (myCircles.length) {
    var ids = myCircles.map(function (c) { return c.circleId; });
    var shared = await prisma.circleMember.findFirst({ where: { userId: blockedId, isActive: true, circleId: { in: ids } }, select: { circleId: true } });
    if (shared) {
      var already = await prisma.safetyFlag.findFirst({ where: { userId: blockedId, reporterId: blockerId, flagType: 'blocked_in_circle', status: 'pending' } });
      if (!already) {
        var subject = await prisma.user.findUnique({ where: { id: blockedId }, select: { alias: true, email: true } });
        await prisma.safetyFlag.create({ data: {
          userId: blockedId,
          reporterId: blockerId,
          subjectAliasSnapshot: subject ? subject.alias : null,
          subjectEmailSnapshot: subject ? subject.email : null,
          flagType: 'blocked_in_circle',
          severity: 'medium',
          triggerContent: 'One member blocked another while both are in circle ' + shared.circleId + '. Decide whether either should be moved.',
          status: 'pending',
        } });
      }
    }
  }

  // End any deep connection between them. A block means it is over, not hidden.
  await prisma.connection.updateMany({
    where: {
      OR: [
        { userAId: blockerId, userBId: blockedId },
        { userAId: blockedId, userBId: blockerId },
      ],
      isActive: true,
    },
    data: { isActive: false, stage: 'ended', endedAt: new Date(), endReason: 'blocked' },
  });
}

module.exports = safetyRoutes;
module.exports.doBlock = doBlock;
