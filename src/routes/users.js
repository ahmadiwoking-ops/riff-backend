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
  'av_carpenter', 'av_potter', 'av_architect', 'av_illustrator', 'av_chef', 'av_baker',
  'av_doctor', 'av_nurse', 'av_veterinarian', 'av_paramedic', 'av_police_officer', 'av_firefighter',
  'av_teacher', 'av_social_worker', 'av_scientist', 'av_lecturer', 'av_musician', 'av_actor',
  'av_writer', 'av_developer', 'av_product_manager', 'av_manager', 'av_office_professional', 'av_finance_analyst',
  'av_farmer', 'av_outdoor_guide', 'av_sailor', 'av_fisherman', 'av_tour_guide', 'av_monastic_life',
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

  // ═══ Location shown on match cards ═══
  // Off by default and never inferred - see the IP geolocation in auth.js,
  // which is a separate admin-only signal and deliberately not used here.
  app.get('/location', { preHandler: [app.authenticate] }, async (request) => {
    var u = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { area: true, country: true, shareLocation: true },
    });
    return { area: u ? u.area : null, country: u ? u.country : null, shareLocation: u ? u.shareLocation : false };
  });

  app.post('/location', { preHandler: [app.authenticate] }, async (request) => {
    var body = request.body || {};
    var data = {};
    if (body.area !== undefined) {
      var a = typeof body.area === 'string' ? body.area.trim() : '';
      if (a.length > 60) return { error: 'That area name is too long.' };
      data.area = a === '' ? null : a;
    }
    if (body.country !== undefined) {
      var c = typeof body.country === 'string' ? body.country.trim().toUpperCase() : '';
      data.country = c === '' ? null : c.slice(0, 2);
    }
    if (body.shareLocation !== undefined) data.shareLocation = body.shareLocation === true;
    if (!Object.keys(data).length) return { error: 'Nothing to update.' };
    var u = await prisma.user.update({ where: { id: request.user.id }, data: data });
    return { status: 'saved', area: u.area, country: u.country, shareLocation: u.shareLocation };
  });

}
module.exports = userRoutes;
