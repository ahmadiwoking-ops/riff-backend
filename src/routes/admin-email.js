// Admin email: individual emails and bulk sends to registered users.
//
// Bulk sends run against a daily budget (BULK_EMAIL_DAILY_LIMIT, default 80)
// so Resend's free-plan cap of 100 a day always leaves room for password
// resets and verification. Anything over the budget waits as "pending" and
// is sent with Continue on a later day.
//
// Kinds:
//   announcement - service news about Riff; goes to everyone in the audience
//   marketing    - news and offers; unsubscribe link, skips anyone opted out
//   direct       - one email to one user from the Users list
const crypto = require('crypto');
const { Resend } = require('resend');
const prisma = require('../db');
const { FROM } = require('../services/email');

const REPLY_TO = 'admin@riff-app.co.uk';
const DAILY_LIMIT = Math.max(1, parseInt(process.env.BULK_EMAIL_DAILY_LIMIT, 10) || 80);
const SEND_GAP_MS = 600; // stay under Resend's per-second rate limit
const PUBLIC_BASE = process.env.PUBLIC_API_URL || 'https://api.riff-app.co.uk';
const running = new Set(); // campaign ids sending right now in this process

const PAID = ['single', 'bot_connection', 'explorer', 'inner_circle'];
const AUDIENCES = [
  { key: 'all', label: 'All users' },
  { key: 'free', label: 'Free / trial' },
  { key: 'paid', label: 'Any paid plan' },
  { key: 'single', label: 'Riff Single' },
  { key: 'bot_connection', label: 'AI Companions' },
  { key: 'explorer', label: 'Explorer' },
  { key: 'inner_circle', label: 'Inner Circle' },
  { key: 'verified', label: 'ID verified' },
  { key: 'unverified', label: 'Not ID verified' },
  { key: 'inactive30', label: 'Inactive 30+ days' },
  { key: 'new7', label: 'Joined in the last 7 days' },
];

function adminIds() {
  return String(process.env.ADMIN_USER_IDS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}
async function requireAdmin(request, reply) {
  var ids = adminIds();
  if (!ids.length) return reply.code(503).send({ error: 'Admin access is not configured.' });
  if (ids.indexOf(request.user.id) === -1) {
    request.log.warn({ userId: request.user.id, route: request.url }, 'non-admin attempted an admin email route');
    return reply.code(403).send({ error: 'Not permitted.' });
  }
}

let client = null;
function resend() {
  if (client) return client;
  if (!process.env.RESEND_API_KEY) return null;
  client = new Resend(process.env.RESEND_API_KEY);
  return client;
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function audienceWhere(key, kind) {
  const now = new Date();
  const live = { OR: [{ planExpiresAt: null }, { planExpiresAt: { gt: now } }] };
  let w;
  switch (key) {
    case 'all': w = {}; break;
    case 'free': w = { OR: [{ plan: 'free' }, { planExpiresAt: { lte: now } }] }; break;
    case 'paid': w = { AND: [{ plan: { in: PAID } }, live] }; break;
    case 'single': case 'bot_connection': case 'explorer': case 'inner_circle':
      w = { AND: [{ plan: key }, live] }; break;
    case 'verified': w = { idVerified: true }; break;
    case 'unverified': w = { idVerified: false }; break;
    case 'inactive30': w = { lastActiveAt: { lt: new Date(now.getTime() - 30 * 86400000) } }; break;
    case 'new7': w = { createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } }; break;
    default: return null;
  }
  const base = [{ isBanned: false }];
  if (kind === 'marketing') base.push({ marketingOptOut: false });
  return { AND: base.concat([w]) };
}

// ---------- the email itself ----------
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function linkify(s) {
  return s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#A78BFA;">$1</a>');
}
function render(subject, body, alias, kind, unsubUrl) {
  const filled = String(body).split('{name}').join(alias || 'there').trim();
  const paras = filled.split(/\n\s*\n/).map(function (p) {
    return '<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#CBD5E1;">' + linkify(esc(p)).replace(/\n/g, '<br>') + '</p>';
  }).join('\n');
  let footHtml, footText;
  if (kind === 'marketing') {
    footHtml = 'You are receiving this because you have a Riff account. <a href="' + esc(unsubUrl) + '" style="color:#94A3B8;">Unsubscribe from news and offers</a>';
    footText = 'You are receiving this because you have a Riff account.\nUnsubscribe from news and offers: ' + unsubUrl;
  } else if (kind === 'announcement') {
    footHtml = 'This is a service message about your Riff account.';
    footText = footHtml;
  } else {
    footHtml = 'Sent by the Riff team. Reply to this email to get in touch.';
    footText = footHtml;
  }
  const html = [
    '<div style="background:#0A0E18;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">',
    '  <div style="max-width:520px;margin:0 auto;background:#151B2B;border-radius:16px;padding:30px;">',
    '    <h1 style="margin:0 0 18px;font-size:21px;font-weight:700;color:#F0ECE5;">' + esc(subject) + '</h1>',
    paras,
    '  </div>',
    '  <p style="max-width:520px;margin:18px auto 0;font-size:12px;line-height:1.6;color:#64748B;text-align:center;">' + footHtml + '<br>Riff Apps Limited</p>',
    '</div>',
  ].join('\n');
  const text = filled + '\n\n---\n' + footText + '\nRiff Apps Limited';
  return { subject: subject, html: html, text: text };
}

async function sendOne(to, mail, unsubUrl) {
  const r = resend();
  if (!r) return { sent: false, reason: 'RESEND_API_KEY is not set' };
  try {
    const payload = { from: FROM, to: [to], replyTo: REPLY_TO, subject: mail.subject, html: mail.html, text: mail.text };
    if (unsubUrl) payload.headers = { 'List-Unsubscribe': '<' + unsubUrl + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
    const res = await r.emails.send(payload);
    if (res && res.error) return { sent: false, reason: res.error.message || 'send rejected' };
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: (err && err.message) || 'send failed' };
  }
}

async function unsubUrlFor(user) {
  let t = user.emailUnsubToken;
  if (!t) {
    t = crypto.randomBytes(24).toString('hex');
    await prisma.user.update({ where: { id: user.id }, data: { emailUnsubToken: t } });
  }
  return PUBLIC_BASE + '/api/email/unsubscribe?token=' + t;
}

async function budgetLeft() {
  const used = await prisma.emailRecipient.count({ where: { status: 'sent', sentAt: { gte: new Date(Date.now() - 86400000) } } });
  return Math.max(0, DAILY_LIMIT - used);
}

async function refreshCounts(id) {
  const g = await prisma.emailRecipient.groupBy({ by: ['status'], where: { campaignId: id }, _count: { _all: true } });
  const n = function (s) { const row = g.find(function (x) { return x.status === s; }); return row ? row._count._all : 0; };
  return prisma.emailCampaign.update({
    where: { id: id },
    data: { sentCount: n('sent'), failedCount: n('failed'), skippedCount: n('skipped'), pendingCount: n('pending'), status: n('pending') > 0 ? 'paused' : 'done' },
  });
}

// Sends as many pending emails as today's budget allows. Runs in the background.
async function runCampaign(id, log) {
  if (running.has(id)) return;
  running.add(id);
  try {
    const c = await prisma.emailCampaign.findUnique({ where: { id: id } });
    if (!c) return;
    await prisma.emailCampaign.update({ where: { id: id }, data: { status: 'sending' } });
    const left = await budgetLeft();
    const pending = left > 0 ? await prisma.emailRecipient.findMany({ where: { campaignId: id, status: 'pending' }, orderBy: { id: 'asc' }, take: left }) : [];
    for (const rec of pending) {
      const u = await prisma.user.findUnique({
        where: { id: rec.userId },
        select: { id: true, email: true, alias: true, isBanned: true, marketingOptOut: true, emailUnsubToken: true },
      });
      let data;
      if (!u || u.isBanned || (c.kind === 'marketing' && u.marketingOptOut)) {
        data = { status: 'skipped' }; // deleted, banned or unsubscribed since the send was created
      } else {
        const unsub = c.kind === 'marketing' ? await unsubUrlFor(u) : null;
        const res = await sendOne(u.email, render(c.subject, c.body, u.alias, c.kind, unsub), unsub);
        data = res.sent ? { status: 'sent', sentAt: new Date(), error: null } : { status: 'failed', error: String(res.reason).slice(0, 200) };
        await sleep(SEND_GAP_MS);
      }
      await prisma.emailRecipient.update({ where: { id: rec.id }, data: data });
    }
  } catch (err) {
    if (log) log.error(err, 'email campaign run failed');
  } finally {
    try { await refreshCounts(id); } catch (e) { /* counts refresh on the next run */ }
    running.delete(id);
  }
}

function cleanInput(body) {
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const text = typeof body.body === 'string' ? body.body.replace(/\r\n/g, '\n') : '';
  if (!subject || subject.length > 150) return { error: 'Subject is required (up to 150 characters).' };
  if (!text.trim() || text.length > 20000) return { error: 'Message is required (up to 20,000 characters).' };
  return { subject: subject, text: text };
}

const UNSUB_PAGE = function (ok) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Riff</title></head>' +
    '<body style="margin:0;background:#0A0E18;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">' +
    '<div style="max-width:440px;margin:80px auto;padding:32px;background:#151B2B;border-radius:16px;text-align:center;">' +
    (ok
      ? '<h1 style="font-size:20px;color:#F0ECE5;margin:0 0 12px;">You have been unsubscribed</h1>' +
        '<p style="font-size:14px;color:#94A3B8;line-height:1.7;margin:0;">You will not get news and offers from Riff by email. We will still send messages about your account, such as password resets.</p>'
      : '<h1 style="font-size:20px;color:#F0ECE5;margin:0 0 12px;">Link not recognised</h1>' +
        '<p style="font-size:14px;color:#94A3B8;line-height:1.7;margin:0;">This unsubscribe link is not valid. Email admin@riff-app.co.uk and we will sort it out.</p>') +
    '</div></body></html>';
};

async function adminEmailRoutes(app) {
  const admin = { preHandler: [app.authenticate, requireAdmin] };

  // ---- Public: unsubscribe (link in the email, and one-click from mail apps) ----
  async function unsubscribe(token) {
    if (!token) return false;
    const u = await prisma.user.findUnique({ where: { emailUnsubToken: String(token) }, select: { id: true } });
    if (!u) return false;
    await prisma.user.update({ where: { id: u.id }, data: { marketingOptOut: true } });
    return true;
  }
  app.get('/unsubscribe', async (request, reply) => {
    const ok = await unsubscribe((request.query || {}).token);
    reply.type('text/html').send(UNSUB_PAGE(ok));
  });
  app.post('/unsubscribe', async (request, reply) => {
    const ok = await unsubscribe((request.query || {}).token);
    return reply.code(ok ? 200 : 404).send({ unsubscribed: ok });
  });

  // ---- Admin ----
  app.get('/admin/audiences', admin, async (request) => {
    const kind = (request.query || {}).kind === 'marketing' ? 'marketing' : 'announcement';
    const counts = await Promise.all(AUDIENCES.map(function (a) { return prisma.user.count({ where: audienceWhere(a.key, kind) }); }));
    return { kind: kind, audiences: AUDIENCES.map(function (a, i) { return { key: a.key, label: a.label, count: counts[i] }; }) };
  });

  app.post('/admin/test', admin, async (request, reply) => {
    const body = request.body || {};
    const input = cleanInput(body);
    if (input.error) return reply.code(400).send({ error: input.error });
    const kind = ['announcement', 'marketing', 'direct'].indexOf(body.kind) >= 0 ? body.kind : 'announcement';
    const me = await prisma.user.findUnique({ where: { id: request.user.id }, select: { id: true, email: true, alias: true, emailUnsubToken: true } });
    if (!me) return reply.code(404).send({ error: 'Your account was not found.' });
    const unsub = kind === 'marketing' ? await unsubUrlFor(me) : null;
    const res = await sendOne(me.email, render('[Test] ' + input.subject, input.text, me.alias, kind, unsub), unsub);
    if (!res.sent) return reply.code(502).send({ error: 'Test not sent: ' + res.reason });
    return { sent: true, to: me.email };
  });

  app.post('/admin/user/:id', admin, async (request, reply) => {
    const input = cleanInput(request.body || {});
    if (input.error) return reply.code(400).send({ error: input.error });
    const u = await prisma.user.findUnique({ where: { id: request.params.id }, select: { id: true, email: true, alias: true } });
    if (!u) return reply.code(404).send({ error: 'User not found.' });
    const res = await sendOne(u.email, render(input.subject, input.text, u.alias, 'direct', null), null);
    await prisma.emailCampaign.create({
      data: {
        kind: 'direct', audience: 'user:' + u.alias, subject: input.subject, body: input.text, sentBy: request.user.id,
        total: 1, sentCount: res.sent ? 1 : 0, failedCount: res.sent ? 0 : 1, status: 'done',
        recipients: { create: [{ userId: u.id, status: res.sent ? 'sent' : 'failed', sentAt: res.sent ? new Date() : null, error: res.sent ? null : String(res.reason).slice(0, 200) }] },
      },
    });
    if (!res.sent) return reply.code(502).send({ error: 'Not sent: ' + res.reason });
    return { sent: true, to: u.email };
  });

  app.post('/admin/campaigns', admin, async (request, reply) => {
    const body = request.body || {};
    if (body.confirm !== 'SEND') return reply.code(400).send({ error: 'Confirmation missing.' });
    const input = cleanInput(body);
    if (input.error) return reply.code(400).send({ error: input.error });
    const kind = body.kind === 'marketing' ? 'marketing' : body.kind === 'announcement' ? 'announcement' : null;
    if (!kind) return reply.code(400).send({ error: 'Choose Announcement or News & offers.' });
    const where = audienceWhere(body.audience, kind);
    if (!where) return reply.code(400).send({ error: 'Unknown audience.' });
    if (!resend()) return reply.code(503).send({ error: 'Email is not configured (RESEND_API_KEY missing).' });

    const users = await prisma.user.findMany({ where: where, select: { id: true } });
    if (!users.length) return reply.code(400).send({ error: 'Nobody is in that audience.' });
    const label = (AUDIENCES.find(function (a) { return a.key === body.audience; }) || {}).label || body.audience;
    const c = await prisma.emailCampaign.create({
      data: {
        kind: kind, audience: label, subject: input.subject, body: input.text, sentBy: request.user.id,
        total: users.length, pendingCount: users.length, status: 'paused',
      },
    });
    await prisma.emailRecipient.createMany({ data: users.map(function (u) { return { campaignId: c.id, userId: u.id }; }), skipDuplicates: true });
    const left = await budgetLeft();
    request.log.info({ campaignId: c.id, kind: kind, audience: label, total: users.length, by: request.user.id }, 'admin email send started');
    runCampaign(c.id, request.log); // background - progress shows in the history list
    return { id: c.id, total: users.length, budgetLeft: left };
  });

  app.post('/admin/campaigns/:id/continue', admin, async (request, reply) => {
    const c = await prisma.emailCampaign.findUnique({ where: { id: request.params.id } });
    if (!c) return reply.code(404).send({ error: 'Not found.' });
    if (running.has(c.id)) return reply.code(409).send({ error: 'Already sending.' });
    const pending = await prisma.emailRecipient.count({ where: { campaignId: c.id, status: 'pending' } });
    if (!pending) { await refreshCounts(c.id); return { status: 'done', pending: 0 }; }
    const left = await budgetLeft();
    if (!left) return reply.code(429).send({ error: "Today's sending limit is used up. Try again tomorrow." });
    runCampaign(c.id, request.log);
    return { status: 'sending', pending: pending, budgetLeft: left };
  });

  app.get('/admin/campaigns', admin, async () => {
    const rows = await prisma.emailCampaign.findMany({
      orderBy: { createdAt: 'desc' }, take: 30,
      select: { id: true, kind: true, audience: true, subject: true, total: true, sentCount: true, failedCount: true, skippedCount: true, pendingCount: true, status: true, createdAt: true },
    });
    return {
      dailyLimit: DAILY_LIMIT,
      budgetLeft: await budgetLeft(),
      campaigns: rows.map(function (r) { return Object.assign({}, r, { running: running.has(r.id) }); }),
    };
  });
}

module.exports = adminEmailRoutes;
