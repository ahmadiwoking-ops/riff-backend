const prisma = require('../db');
async function notificationRoutes(app) {
  app.post('/register-token', { preHandler: [app.authenticate] }, async (request) => {
    return { status: 'registered' };
  });
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    return { notifications: await prisma.notification.findMany({ where: { userId: request.user.id }, orderBy: { createdAt: 'desc' }, take: 50 }) };
  });
  app.post('/read', { preHandler: [app.authenticate] }, async (request) => {
    const { notificationId } = request.body;
    if (notificationId) await prisma.notification.update({ where: { id: notificationId }, data: { isRead: true } });
    else await prisma.notification.updateMany({ where: { userId: request.user.id, isRead: false }, data: { isRead: true } });
    return { status: 'read' };
  });
}
module.exports = notificationRoutes;
