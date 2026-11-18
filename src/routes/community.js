// Posts "Say hello" messages from the website into the Riff Discord, through a Discord webhook.
//
// The webhook URL lives ONLY in the Railway variable DISCORD_WEBHOOK_URL. Never put it in the
// website or the app: anyone who has it can post anything to the server as Riff.
//
// Protection against spam and abuse:
//  - honeypot field, minimum time on page, length limits, no links
//  - 3 messages per person (IP) per 10 minutes, and a daily cap for the whole site
//  - @everyone, @here and all other mentions are switched off
//  - the person's IP is never sent to Discord
const WINDOW_MS = 10 * 60 * 1000;
const PER_IP = 3;
const DAILY_CAP = Number(process.env.DISCORD_DAILY_CAP || 150);

const hits = new Map();          // ip -> [timestamps]
let day = '', dayCount = 0;

function clientIp(request) {
  const fwd = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || request.ip;
}
function clean(s, max) {
  return String(s || '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')   // control characters
    .replace(/@(everyone|here)/gi, '@​$1')             // belt and braces with allowed_mentions
    .replace(/<@[!&]?\d+>/g, '')                            // raw user/role mentions
    .trim()
    .slice(0, max);
}
const LINK = /(https?:\/\/|www\.|discord\.gg|\b[a-z0-9-]+\.(com|net|org|io|gg|co|uk|xyz|ru|me|ly)\b)/i;

async function communityRoutes(app) {
  app.get('/status', async () => ({ enabled: !!process.env.DISCORD_WEBHOOK_URL }));

  app.post('/message', async (request, reply) => {
    const hook = process.env.DISCORD_WEBHOOK_URL;
    if (!hook || !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(hook)) {
      return reply.code(503).send({ error: 'Messages are switched off at the moment.' });
    }
    const b = request.body || {};

    // Bots: honeypot filled in, or form sent less than 3 seconds after the page loaded. Pretend it worked.
    if (b.website || (Number(b.openedMs) > 0 && Number(b.openedMs) < 3000)) return { status: 'sent' };

    const name = clean(b.name, 40);
    const message = clean(b.message, 1000);
    const area = clean(b.area, 40);
    if (b.adult !== true) return reply.code(400).send({ error: 'Please confirm you are 18 or over.' });
    if (name.length < 2) return reply.code(400).send({ error: 'Please add a name (it can be a nickname).' });
    if (message.length < 5) return reply.code(400).send({ error: 'Your message is a bit short.' });
    if (LINK.test(name + ' ' + message + ' ' + area)) return reply.code(400).send({ error: 'Links are not allowed in messages.' });

    const ip = clientIp(request);
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= PER_IP) return reply.code(429).send({ error: 'You have sent a few messages already. Try again in a few minutes.' });
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) { day = today; dayCount = 0; }
    if (dayCount >= DAILY_CAP) return reply.code(429).send({ error: 'We have had lots of messages today. Please try again tomorrow, or join the Discord.' });
    if (hits.size > 5000) hits.clear();

    const payload = {
      username: 'Riff website',
      allowed_mentions: { parse: [] },
      embeds: [{
        author: { name: name + (area ? ' · ' + area : '') },
        description: message,
        color: 0x8B5CF6,
        footer: { text: 'Sent from riff-app.co.uk' },
        timestamp: new Date().toISOString(),
      }],
    };
    try {
      const res = await fetch(hook + (hook.includes('?') ? '&' : '?') + 'wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        request.log.error({ status: res.status }, 'discord webhook failed');
        return reply.code(502).send({ error: 'Could not post your message just now. Please try again later.' });
      }
    } catch (e) {
      request.log.error({ err: e.message }, 'discord webhook error');
      return reply.code(502).send({ error: 'Could not post your message just now. Please try again later.' });
    }
    recent.push(now);
    hits.set(ip, recent);
    dayCount += 1;
    return { status: 'sent' };
  });
}

module.exports = communityRoutes;
