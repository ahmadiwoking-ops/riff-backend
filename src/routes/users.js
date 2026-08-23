const prisma = require('../db');
// The picker fetches this list, and /avatar validates against it, so the two
// can never drift apart. Emoji only — this renders in other people's UI.
var AVATAR_EMOJI = [
  '\u{1F3A7}','\u{1F3B8}','\u{1F3B5}','\u{1F399}',
  '\u{1F3D4}','\u{1F30A}','\u{1F333}','\u{2600}',
  '\u{1F4DA}','\u{2615}','\u{270D}','\u{1F3AC}',
  '\u{26BD}','\u{1F3C3}','\u{1F6B4}','\u{1F3CB}',
  '\u{1F35C}','\u{1F373}','\u{1F347}','\u{1F36B}',
  '\u{1F3A8}','\u{1F4F7}','\u{1F3AD}','\u{1F4AD}',
  '\u{1F4BB}','\u{1F3AE}','\u{1F680}','\u{1F52C}',
  '\u{1F9D8}','\u{1F331}','\u{1F415}','\u{1F431}',
];

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
  app.get('/avatar-options', { preHandler: [app.authenticate] }, async () => {
    return { emoji: AVATAR_EMOJI };
  });

  app.put('/avatar', { preHandler: [app.authenticate] }, async (request, reply) => {
    var emoji = request.body && request.body.emoji;
    var colour = request.body && request.body.colour;
    if (AVATAR_EMOJI.indexOf(emoji) === -1) {
      return reply.code(400).send({ error: 'That avatar is not available', code: 'INVALID_AVATAR' });
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
