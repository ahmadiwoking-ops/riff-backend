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

  // Lifestyle avatar shown before a reveal. Emoji only — a short allowlist keeps
  // arbitrary strings out of a field that renders in other people's UI.
  app.put('/avatar', { preHandler: [app.authenticate] }, async (request, reply) => {
    var emoji = request.body && request.body.emoji;
    var colour = request.body && request.body.colour;
    if (!emoji || typeof emoji !== 'string' || emoji.length > 8) {
      return reply.code(400).send({ error: 'A valid avatar is required' });
    }
    if (colour && !/^#[0-9A-Fa-f]{6}$/.test(colour)) {
      return reply.code(400).send({ error: 'Invalid colour' });
    }
    await prisma.user.update({
      where: { id: request.user.id },
      data: { avatarEmoji: emoji, avatarColour: colour || null },
    });
    return { status: 'saved', avatarEmoji: emoji, avatarColour: colour || null };
  });
}
module.exports = userRoutes;
