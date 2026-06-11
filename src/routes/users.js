const prisma = require('../db');
async function userRoutes(app) {
  app.get('/stats', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.id;
    const [deepConns, circles, msgs] = await Promise.all([
      prisma.connection.count({ where: { OR: [{ userAId: userId }, { userBId: userId }], isActive: true, isPractice: false } }),
      prisma.circleMember.count({ where: { userId, isActive: true } }),
      prisma.message.count({ where: { senderId: userId } }),
    ]);
    return { deepConnections: deepConns, circles, messagesSent: msgs };
  });
}
module.exports = userRoutes;
