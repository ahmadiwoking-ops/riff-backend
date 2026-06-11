const prisma = require('../db');
async function messageRoutes(app) {
  app.get('/connection/:connectionId', { preHandler: [app.authenticate] }, async (request) => {
    return { messages: await prisma.message.findMany({ where: { connectionId: request.params.connectionId }, include: { sender: { select: { alias: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }) };
  });
  app.get('/circle/:circleId', { preHandler: [app.authenticate] }, async (request) => {
    return { messages: await prisma.message.findMany({ where: { circleId: request.params.circleId }, include: { sender: { select: { alias: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }) };
  });
  app.post('/', { preHandler: [app.authenticate] }, async (request) => {
    const { connectionId, circleId, content, type } = request.body;
    const message = await prisma.message.create({ data: { connectionId, circleId, senderId: request.user.id, content, type: type || 'text' }, include: { sender: { select: { alias: true } } } });
    return { message };
  });
}
module.exports = messageRoutes;
