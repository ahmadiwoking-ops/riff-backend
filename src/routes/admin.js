const prisma = require('../db');
async function adminRoutes(app) {
  app.get('/stats', { preHandler: [app.authenticate] }, async () => {
    const [totalUsers, activeUsers, totalConnections, activeCircles, pendingFlags, paidUsers] = await Promise.all([
      prisma.user.count(), prisma.user.count({ where: { lastActiveAt: { gte: new Date(Date.now() - 86400000) } } }),
      prisma.connection.count({ where: { isActive: true, isPractice: false } }), prisma.circle.count({ where: { isActive: true } }),
      prisma.safetyFlag.count({ where: { status: 'pending' } }), prisma.user.count({ where: { plan: { not: 'free' } } }),
    ]);
    return { totalUsers, activeUsers24h: activeUsers, activeConnections: totalConnections, activeCircles, pendingFlags, paidUsers };
  });
  app.get('/flags', { preHandler: [app.authenticate] }, async () => {
    return { flags: await prisma.safetyFlag.findMany({ where: { status: 'pending' }, include: { user: { select: { id: true, alias: true, trustScore: true } } }, orderBy: { createdAt: 'asc' }, take: 50 }) };
  });
  app.post('/flags/:id/resolve', { preHandler: [app.authenticate] }, async (request) => {
    const { action, notes } = request.body;
    const flag = await prisma.safetyFlag.update({ where: { id: request.params.id }, data: { status: 'resolved', reviewedBy: request.user.id, reviewNotes: notes, resolvedAt: new Date() } });
    if (action === 'ban') await prisma.user.update({ where: { id: flag.userId }, data: { isBanned: true, banReason: notes } });
    if (action === 'warn') await prisma.user.update({ where: { id: flag.userId }, data: { trustScore: 'yellow', trustFlags: { increment: 1 } } });
    return { flag, action };
  });
  app.get('/users', { preHandler: [app.authenticate] }, async (request) => {
    const { search, page } = request.query;
    const where = search ? { OR: [{ alias: { contains: search } }, { email: { contains: search } }] } : {};
    return { users: await prisma.user.findMany({ where, select: { id: true, alias: true, email: true, gender: true, plan: true, trustScore: true, isBanned: true, createdAt: true, lastActiveAt: true }, orderBy: { createdAt: 'desc' }, take: 50, skip: ((parseInt(page) || 1) - 1) * 50 }) };
  });
}
module.exports = adminRoutes;
