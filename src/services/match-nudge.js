// Twice-weekly "check your matches" nudge.
//
// Riff computes matches on request, so there is no moment when one "arrives"
// to push on. This is a periodic reminder rather than an alert, and it only
// goes to people it would actually be true for: a free slot, and at least one
// unconnected candidate above the floor.
//
// Runs in-process rather than as a separate cron service. That is fine on a
// single instance; if the API is ever scaled horizontally this must move out,
// or every instance will send its own copy.

const prisma = require('../db');
const { notify } = require('./push');
const { getLimits } = require('./plan-limits');

const FLOOR = 40;
const CHECK_EVERY_MS = 60 * 60 * 1000;          // wake hourly, act rarely
const MIN_GAP_MS = 3.5 * 24 * 60 * 60 * 1000;   // ~twice a week per person
const SEND_HOUR_START = 18;                      // early evening, local-ish
const SEND_HOUR_END = 21;

async function lastNudgeAt(userId) {
  const last = await prisma.notification.findFirst({
    where: { userId, type: 'match_nudge' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return last ? last.createdAt.getTime() : 0;
}

/**
 * Would a nudge be true for this person right now?
 * Cheap checks first so we bail before touching the match vectors.
 */
async function hasSomethingWaiting(user) {
  let plan = user.plan || 'free';
  if (user.planExpiresAt && user.planExpiresAt < new Date()) plan = 'free';

  const limit = getLimits(plan).deepConnections;
  if (limit === 0) return false;
  if (!user.matchVector || !user.matchVector.answers) return false;

  const conns = await prisma.connection.findMany({
    where: { OR: [{ userAId: user.id }, { userBId: user.id }] },
    select: { userAId: true, userBId: true, isActive: true },
  });
  const active = conns.filter(function (c) { return c.isActive; }).length;
  const used = plan === 'free' ? conns.length : active;
  if (limit !== -1 && used >= limit) return false;   // no room - the nudge would be a lie

  // Someone unconnected must actually be available, or we are sending people
  // to an empty screen.
  const connectedIds = conns.map(function (c) {
    return c.userAId === user.id ? c.userBId : c.userAId;
  });
  const cached = user.matchVector.cachedMatches;
  if (!Array.isArray(cached) || !cached.length) return false;
  return cached.some(function (m) {
    return m && m.score >= FLOOR && connectedIds.indexOf(m.userId) === -1;
  });
}

async function runOnce() {
  const hour = new Date().getHours();
  if (hour < SEND_HOUR_START || hour >= SEND_HOUR_END) return { skipped: 'outside sending hours' };

  const users = await prisma.user.findMany({
    where: { isActive: true, pushToken: { not: null } },
    select: { id: true, plan: true, planExpiresAt: true, matchVector: true },
  });

  let sent = 0;
  for (const user of users) {
    try {
      const since = Date.now() - (await lastNudgeAt(user.id));
      if (since < MIN_GAP_MS) continue;
      if (!(await hasSomethingWaiting(user))) continue;
      const r = await notify(
        user.id,
        'match_nudge',
        'Someone new might be waiting',
        'You have room for another Deep Connection. Take a look at your matches.',
        { screen: 'connections' }
      );
      if (r.sent) sent++;
    } catch (err) {
      console.error('[nudge] failed for ' + user.id + ':', err && err.message);
    }
  }
  return { considered: users.length, sent };
}

let timer = null;

function start() {
  if (timer) return;
  // Wait a minute after boot so a deploy does not fire mid-startup.
  setTimeout(function () {
    runOnce().then(function (r) { console.log('[nudge] first run:', JSON.stringify(r)); }).catch(function () {});
    timer = setInterval(function () {
      runOnce().then(function (r) {
        if (r && r.sent) console.log('[nudge]', JSON.stringify(r));
      }).catch(function (e) { console.error('[nudge] run failed:', e && e.message); });
    }, CHECK_EVERY_MS);
  }, 60 * 1000);
  console.log('[nudge] scheduler started');
}

module.exports = { start, runOnce };
