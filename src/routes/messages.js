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

  // Get or create a connection between two matched users
  app.post('/connect', { preHandler: [app.authenticate] }, async (request) => {
    var matchId = request.body.matchId;
    var score = parseFloat(request.body.score) || 50;
    if (!matchId) return { error: 'matchId required' };
    var myId = request.user.id;
    var ids = [myId, matchId].sort();
    // Check if connection exists in either direction
    var existing = await prisma.connection.findFirst({
      where: { OR: [{ userAId: ids[0], userBId: ids[1] }, { userAId: ids[1], userBId: ids[0] }] },
    });
    if (existing) return { connection: existing };
    // Create new connection
    var conn = await prisma.connection.create({
      data: { userAId: ids[0], userBId: ids[1], compatScore: score, stage: 'text' },
    });
    return { connection: conn };
  });
