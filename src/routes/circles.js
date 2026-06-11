const prisma = require('../db');
async function circleRoutes(app) {
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const memberships = await prisma.circleMember.findMany({ where: { userId: request.user.id, isActive: true }, include: { circle: { include: { members: { include: { user: { select: { alias: true, trustScore: true } } } } } } } });
    return { circles: memberships.map(m => m.circle) };
  });
  app.get('/:id', { preHandler: [app.authenticate] }, async (request) => {
    return { circle: await prisma.circle.findUnique({ where: { id: request.params.id }, include: { members: { include: { user: { select: { id: true, alias: true, trustScore: true } } } }, rounds: { orderBy: { roundNum: 'desc' }, take: 5, include: { answers: true } }, games: { where: { status: 'active' } } } }) };
  });
}
module.exports = circleRoutes;
