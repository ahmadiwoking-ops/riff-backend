const prisma = require('../db');
const { getLimits } = require('../services/plan-limits');

async function messageRoutes(app) {
  app.get('/connection/:connectionId', { preHandler: [app.authenticate] }, async (request) => {
    return { messages: await prisma.message.findMany({ where: { connectionId: request.params.connectionId }, include: { sender: { select: { alias: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }) };
  });
  app.get('/circle/:circleId', { preHandler: [app.authenticate] }, async (request) => {
    return { messages: await prisma.message.findMany({ where: { circleId: request.params.circleId }, include: { sender: { select: { alias: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }) };
  });
  app.post('/', { preHandler: [app.authenticate] }, async (request) => {
    const { connectionId, circleId, content, type } = request.body;
    // ── Free-tier Deep Connection trial: free for 1 week from registration, then read-only ──
    if (connectionId && !circleId) {
      const sender = await prisma.user.findUnique({ where: { id: request.user.id }, select: { plan: true, planExpiresAt: true, createdAt: true } });
      let plan = sender.plan || 'free';
      if (sender.planExpiresAt && sender.planExpiresAt < new Date()) plan = 'free';
      if (plan === 'free') {
        const weekMs = 7 * 24 * 60 * 60 * 1000;
        const elapsed = Date.now() - new Date(sender.createdAt).getTime();
        if (elapsed > weekMs) {
          return { locked: true, upgrade: true, code: 'TRIAL_ENDED',
                   message: 'Your free week of deep connections has ended. Subscribe to Riff Single, Explorer, or Inner Circle to keep sending messages.' };
        }
      }
    }
    const message = await prisma.message.create({ data: { connectionId, circleId, senderId: request.user.id, content, type: type || 'text' }, include: { sender: { select: { alias: true } } } });
    return { message };
  });

  // Get or create a connection — with plan-based limits
  app.post('/connect', { preHandler: [app.authenticate] }, async (request) => {
    var matchId = request.body.matchId;
    var score = parseFloat(request.body.score) || 50;
    if (!matchId) return { error: 'matchId required' };
    var myId = request.user.id;
    var ids = [myId, matchId].sort();

    // Check if connection already exists (always allow existing ones)
    var existing = await prisma.connection.findFirst({
      where: { OR: [{ userAId: ids[0], userBId: ids[1] }, { userAId: ids[1], userBId: ids[0] }] },
    });
    if (existing) return { connection: existing };

    // Check plan limits before creating new connection
    var user = await prisma.user.findUnique({ where: { id: myId }, select: { plan: true, planExpiresAt: true } });
    var plan = user.plan || 'free';
    if (user.planExpiresAt && user.planExpiresAt < new Date()) plan = 'free';
    var limits = getLimits(plan);

    if (limits.deepConnections === 0) {
      return { error: 'Your plan does not include deep connections. Upgrade to Explorer or Inner Circle.', code: 'PLAN_LIMIT' };
    }

    if (limits.deepConnections !== -1) {
      if (plan === 'free') {
        // FREE = one deep connection EVER (lifetime). Count active + ended (any non-practice connection).
        var everCount = await prisma.connection.count({
          where: { OR: [{ userAId: myId }, { userBId: myId }], isPractice: false },
        });
        if (everCount >= 1) {
          return {
            error: 'Free accounts include one deep connection. Subscribe to a paid plan to connect with more people.',
            code: 'FREE_LIFETIME_LIMIT',
            current: everCount,
            limit: 1,
            plan: plan,
          };
        }
      } else {
        // Paid tiers: limit is per active connection (at a time)
        var activeCount = await prisma.connection.count({
          where: { OR: [{ userAId: myId }, { userBId: myId }], isActive: true },
        });
        if (activeCount >= limits.deepConnections) {
          return {
            error: plan === 'inner_circle' ? 'You have reached your limit of 5 active connections. End one to start a new connection.' : 'You have reached your deep connection limit (' + limits.deepConnections + ' on ' + plan + ' plan). Upgrade to get more connections.',
            code: 'PLAN_LIMIT',
            current: activeCount,
            limit: limits.deepConnections,
            plan: plan,
          };
        }
      }
    }

    // Create new connection
    var conn = await prisma.connection.create({ data: { userAId: ids[0], userBId: ids[1], compatScore: score, stage: 'open' } });
    return { connection: conn };
  });
}
module.exports = messageRoutes;
