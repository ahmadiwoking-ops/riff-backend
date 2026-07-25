const prisma = require('../db');
const { getLimits } = require('../services/plan-limits');

async function circleRoutes(app) {
  // Get my circles
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const memberships = await prisma.circleMember.findMany({ where: { userId: request.user.id, isActive: true }, include: { circle: { include: { members: { include: { user: { select: { alias: true, trustScore: true } } } } } } } });
    return { circles: memberships.map(m => m.circle) };
  });

  // Get circle detail
  app.get('/:id', { preHandler: [app.authenticate] }, async (request) => {
    return { circle: await prisma.circle.findUnique({ where: { id: request.params.id }, include: { members: { include: { user: { select: { id: true, alias: true, trustScore: true } } } }, rounds: { orderBy: { roundNum: 'desc' }, take: 5, include: { answers: true } }, games: { where: { status: 'active' } } } }) };
  });

  // Join a circle — with plan-based limits
  app.post('/join', { preHandler: [app.authenticate] }, async (request) => {
    var circleId = request.body.circleId;
    if (!circleId) return { error: 'circleId required' };
    var myId = request.user.id;

    // Check if already a member
    var existing = await prisma.circleMember.findFirst({ where: { circleId: circleId, userId: myId } });
    if (existing) return { status: 'already_member', member: existing };

    // Check plan limits
    var user = await prisma.user.findUnique({ where: { id: myId }, select: { plan: true, planExpiresAt: true } });
    var plan = user.plan || 'free';
    if (user.planExpiresAt && user.planExpiresAt < new Date()) plan = 'free';
    var limits = getLimits(plan);

    if (limits.circles === 0) {
      return { error: 'Your plan does not include friend circles. Upgrade to Explorer or Inner Circle.', code: 'PLAN_LIMIT' };
    }

    if (limits.circles !== -1) {
      var activeCircles = await prisma.circleMember.count({ where: { userId: myId, isActive: true } });
      if (activeCircles >= limits.circles) {
        return {
          error: 'You have reached your friend circle limit (' + limits.circles + ' on ' + plan + ' plan). Upgrade to join more circles.',
          code: 'PLAN_LIMIT',
          current: activeCircles,
          limit: limits.circles,
          plan: plan,
        };
      }
    }

    // Join the circle
    var member = await prisma.circleMember.create({
      data: { circleId: circleId, userId: myId, alias: request.user.alias || 'Member' },
    });
    return { status: 'joined', member: member };
  });
}
module.exports = circleRoutes;
