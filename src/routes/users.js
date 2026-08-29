const prisma = require('../db');
// Illustrated avatars. The picker fetches this list and /avatar validates
// against it, so the two cannot drift apart. Keys match PNG filenames in the
// app's src/assets/avatars/ folder — Metro is case-sensitive, so they must
// match exactly.
//
// NOTE: these are stored in User.avatarEmoji. The column name is now a
// misnomer, but renaming a live column across five queries and six render
// sites is risk for no functional gain.
var AVATAR_IDS = [
  'av_music', 'av_guitar', 'av_headphones',
  'av_mountains', 'av_waves', 'av_forest',
  'av_books', 'av_coffee', 'av_writing',
  'av_football', 'av_running', 'av_cycling',
  'av_ramen', 'av_cooking', 'av_baking',
  'av_paint', 'av_camera', 'av_theatre',
  'av_code', 'av_gaming', 'av_rocket',
  'av_calm', 'av_plant', 'av_cat',
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

  // Lifestyle avatar shown before a reveal. Allowlisted ids only — this value
  // renders in other people's UI, so arbitrary strings must not reach it.
  app.get('/avatar-options', { preHandler: [app.authenticate] }, async () => {
    return { avatars: AVATAR_IDS, emoji: AVATAR_IDS };
  });

  app.put('/avatar', { preHandler: [app.authenticate] }, async (request, reply) => {
    var emoji = request.body && request.body.emoji;
    var colour = request.body && request.body.colour;
    if (AVATAR_IDS.indexOf(emoji) === -1) {
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
