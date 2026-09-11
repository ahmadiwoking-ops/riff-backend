const prisma = require('../db');
const { Expo } = require('expo-server-sdk');
const { DEFAULT_PREFS } = require('../services/push');
async function notificationRoutes(app) {
  app.post('/register-token', { preHandler: [app.authenticate] }, async (request) => {
    // Was a stub returning success without storing anything.
    var token = (request.body || {}).token;
    if (typeof token !== 'string' || !token.trim()) return { error: 'A push token is required.' };
    if (!Expo.isExpoPushToken(token)) return { error: 'That is not a valid Expo push token.' };
    await prisma.user.update({ where: { id: request.user.id }, data: { pushToken: token } });
    return { status: 'registered' };
  });

  app.get('/prefs', { preHandler: [app.authenticate] }, async (request) => {
    var u = await prisma.user.findUnique({ where: { id: request.user.id }, select: { notificationPrefs: true, pushToken: true } });
    return { prefs: Object.assign({}, DEFAULT_PREFS, (u && u.notificationPrefs) || {}), hasToken: !!(u && u.pushToken) };
  });

  app.post('/prefs', { preHandler: [app.authenticate] }, async (request) => {
    var body = (request.body || {}).prefs;
    if (!body || typeof body !== 'object') return { error: 'No preferences supplied.' };
    var clean = {};
    Object.keys(DEFAULT_PREFS).forEach(function (k) {
      if (body[k] !== undefined) clean[k] = body[k] === true;
    });
    var u = await prisma.user.update({ where: { id: request.user.id }, data: { notificationPrefs: clean } });
    return { status: 'saved', prefs: Object.assign({}, DEFAULT_PREFS, u.notificationPrefs || {}) };
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
