// Push notifications.
//
// Every notification is recorded in the Notification table whether or not a
// push goes out, so the in-app list stays complete for people who have push
// switched off or have never granted permission.
//
// Preference keys match the toggles on the mobile notifications screen.
// notificationPrefs is null for existing users, which means "all defaults on"
// - that way a new type added later starts enabled rather than silently off.

const { Expo } = require('expo-server-sdk');
const prisma = require('../db');

const expo = new Expo();

// type -> which toggle on the settings screen governs it
const PREF_FOR_TYPE = {
  first_message: 'newMessages',
  circle_joined: 'circleUpdates',
  circle_complete: 'circleUpdates',
  circle_reveal: 'circleUpdates',
  game_started: 'gameInvites',
  match_nudge: 'matchFound',
  promotion: 'promotions',
};

// Mirrors the defaults shown on the settings screen.
const DEFAULT_PREFS = {
  newMessages: true,
  circleUpdates: true,
  gameInvites: true,
  matchFound: true,
  promotions: false,
};

function wants(prefs, type) {
  const key = PREF_FOR_TYPE[type];
  if (!key) return true;                       // unknown type: don't silently swallow it
  if (!prefs || typeof prefs !== 'object') return DEFAULT_PREFS[key] !== false;
  if (prefs[key] === undefined) return DEFAULT_PREFS[key] !== false;
  return prefs[key] === true;
}

/**
 * Record a notification and push it if we can.
 * Never throws - a failed push must not break the action that triggered it.
 */
async function notify(userId, type, title, body, data) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { pushToken: true, notificationPrefs: true, isActive: true },
    });
    if (!user || user.isActive === false) return { sent: false, reason: 'no such user' };
    if (!wants(user.notificationPrefs, type)) return { sent: false, reason: 'opted out' };

    // The in-app list is written regardless of whether push is available.
    await prisma.notification.create({
      data: { userId, type, title, body, data: data || null },
    });

    if (!user.pushToken) return { sent: false, reason: 'no token' };
    if (!Expo.isExpoPushToken(user.pushToken)) {
      // A stale or malformed token would fail on every future send.
      await prisma.user.update({ where: { id: userId }, data: { pushToken: null } });
      return { sent: false, reason: 'invalid token, cleared' };
    }

    const tickets = await expo.sendPushNotificationsAsync([{
      to: user.pushToken,
      sound: 'default',
      title,
      body,
      data: data || {},
    }]);

    // DeviceNotRegistered means the app was uninstalled or the token rotated.
    const t = tickets && tickets[0];
    if (t && t.status === 'error' && t.details && t.details.error === 'DeviceNotRegistered') {
      await prisma.user.update({ where: { id: userId }, data: { pushToken: null } });
      return { sent: false, reason: 'device not registered, token cleared' };
    }
    return { sent: true };
  } catch (err) {
    // Deliberately swallowed: sending a push is never worth failing a message
    // send, a circle join, or anything else that called us.
    console.error('[push] notify failed for ' + userId + ':', err && err.message);
    return { sent: false, reason: 'error' };
  }
}

/** Same as notify, but for several people at once (circle events). */
async function notifyMany(userIds, type, title, body, data) {
  const unique = Array.from(new Set(userIds || []));
  const results = await Promise.all(unique.map(function (id) {
    return notify(id, type, title, body, data);
  }));
  return { attempted: unique.length, sent: results.filter(function (r) { return r.sent; }).length };
}

module.exports = { notify, notifyMany, DEFAULT_PREFS, PREF_FOR_TYPE };
