// src/routes/genie.js — standalone Genie resources assistant with 20/month limit + credit top-ups
const OpenAI = require('openai');
const prisma = require('../db');

const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k2.6';
let kimiClient = null;
if (process.env.MOONSHOT_API_KEY) {
  kimiClient = new OpenAI({ apiKey: process.env.MOONSHOT_API_KEY, baseURL: 'https://api.moonshot.ai/v1' });
}

const GENIE_SYSTEM = [
  'You are Genie, a professional resource and information assistant.',
  'You are NOT a casual friend and NOT a persona - you are a formal, clear, concise expert concierge and research assistant.',
  '',
  'RULES:',
  '- Be professional, formal and to-the-point. No casual chit-chat, no lowercase texting style, no emojis.',
  '- When the user asks for information or resources, provide clear, structured, practical guidance.',
  '- ALWAYS include relevant, real, well-known website links. Use trusted established sites (for example: gov.uk, nhs.uk, which.co.uk, moneysavingexpert.com, coursera.org, gov.uk/foreign-travel-advice, and major recognised organisations relevant to the topic).',
  '- Format every response as: a brief 1-2 sentence introduction, then a list of resources.',
  '- Put EACH resource on its own line, starting with a bullet character (•), followed by the resource name, a short dash-separated description, and the full URL beginning with https://.',
  '- Example:',
  '• Foreign Travel Advice — Official UK government travel guidance and safety information: https://www.gov.uk/foreign-travel-advice',
  '• Travel Insurance Comparison — Compare policies from trusted providers: https://www.which.co.uk/money/insurance/travel-insurance',
  '- Keep descriptions short. Always use full https:// URLs so they are clickable.',
  '- IMPORTANT: Only link to stable, well-established pages that are very unlikely to be broken - prefer homepages and main section pages (e.g. https://www.gov.uk/browse/travel) over deep specific article URLs that may have moved. Never invent or guess specific deep URLs.',
  '- If the request is unclear or too broad, ask ONE concise clarifying question before listing resources.',
].join('\n');

const FREE_LIMIT = 20;

async function getGenieUsage(userId) {
  var now = new Date();
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var usage = await prisma.genieUsage.findFirst({ where: { userId: userId, monthStart: monthStart } });
  if (!usage) usage = await prisma.genieUsage.create({ data: { userId: userId, monthStart: monthStart, requestCount: 0, bonusRequests: 0 } });
  return usage;
}


// Check a single URL is live (not 404/dead). Returns true if reachable.
async function checkLink(url) {
  try {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 2000);
    var res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' } });
    clearTimeout(timer);
    // Only treat definite "page gone" statuses as dead. 403/401/429/5xx often mean bot-blocking or transient - keep them.
    if (res.status === 404 || res.status === 410) return false;
    return true;
  } catch (e) {
    // Timeout or network error - assume the site is up but slow/blocking. Keep it.
    return true;
  }
}

// Extract URLs, validate them in parallel, remove lines with dead links
async function validateResourceLinks(text) {
  var lines = text.split('\n');
  var urlRegex = /(https?:\/\/[^\s)]+)/;
  // Gather all URLs with their line index
  var checks = [];
  lines.forEach(function(line, i) {
    var m = line.match(urlRegex);
    if (m) {
      var url = m[1].replace(/[.,)]+$/, '');
      checks.push({ index: i, url: url });
    }
  });
  if (checks.length === 0) return { text: text, removed: 0 };
  // Check all in parallel, but cap total time at 4s - if exceeded, keep all links
  var allChecks = Promise.all(checks.map(function(c) { return checkLink(c.url); }));
  var capTimeout = new Promise(function(resolve) { setTimeout(function() { resolve(null); }, 4000); });
  var results = await Promise.race([allChecks, capTimeout]);
  if (!results) return { text: text, removed: 0 }; // timed out - keep everything
  var deadIndexes = {};
  var removed = 0;
  checks.forEach(function(c, i) {
    if (!results[i]) { deadIndexes[c.index] = true; removed++; }
  });
  // Rebuild text without the dead-link lines
  var kept = lines.filter(function(line, i) { return !deadIndexes[i]; });
  return { text: kept.join('\n'), removed: removed };
}

async function genieRoutes(app) {
  // Get Genie usage/status
  app.get('/status', { preHandler: [app.authenticate] }, async (request) => {
    var usage = await getGenieUsage(request.user.id);
    var limit = FREE_LIMIT + (usage.bonusRequests || 0);
    return { used: usage.requestCount, limit: limit, remaining: Math.max(0, limit - usage.requestCount), bonusRequests: usage.bonusRequests || 0 };
  });

  // Ask Genie
  app.post('/ask', { preHandler: [app.authenticate] }, async (request, reply) => {
    const message = request.body.message;
    const history = request.body.conversationHistory || [];
    if (!message) return reply.code(400).send({ error: 'message required' });

    // Check limit
    var usage = await getGenieUsage(request.user.id);
    var limit = FREE_LIMIT + (usage.bonusRequests || 0);
    if (usage.requestCount >= limit) {
      return { limitReached: true, response: 'You have used all ' + limit + ' of your Genie requests this month. You can buy more to continue.', used: usage.requestCount, limit: limit, remaining: 0 };
    }

    if (!kimiClient) {
      return { response: 'Genie is not configured right now. Please try again later.' };
    }

    try {
      const msgs = [];
      history.slice(-10).forEach(function (h) {
        if (h && h.role && h.content) msgs.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content) });
      });
      msgs.push({ role: 'user', content: String(message) });

      var res = await kimiClient.chat.completions.create({
        model: KIMI_MODEL,
        max_tokens: 1200,
        temperature: 1,
        messages: [{ role: 'system', content: GENIE_SYSTEM }, ...msgs],
      });
      var text = res.choices && res.choices[0] && res.choices[0].message ? (res.choices[0].message.content || '') : '';
      console.log('[genie] AI returned ' + text.length + ' chars, finish_reason=' + (res.choices && res.choices[0] ? res.choices[0].finish_reason : 'none'));
      if (!text || text.trim().length === 0) {
        var retry = await kimiClient.chat.completions.create({
          model: KIMI_MODEL, max_tokens: 1200, temperature: 1,
          messages: [{ role: 'system', content: GENIE_SYSTEM }, ...msgs],
        });
        text = retry.choices && retry.choices[0] && retry.choices[0].message ? (retry.choices[0].message.content || '') : '';
        console.log('[genie] retry returned ' + text.length + ' chars');
      }
      if (!text || text.trim().length === 0) {
        return { response: 'I was unable to generate resources for that request. Please try rephrasing it.', used: usage.requestCount, limit: limit, remaining: Math.max(0, limit - usage.requestCount) };
      }
      var originalText = text;
      try {
        var validated = await validateResourceLinks(text);
        if (validated.text.trim().length < 20) { text = originalText; } else { text = validated.text; }
      } catch (e) { text = originalText; }

      // Save to history (request + response)
      try {
        await prisma.genieMessage.create({ data: { userId: request.user.id, role: 'user', text: String(message) } });
        await prisma.genieMessage.create({ data: { userId: request.user.id, role: 'genie', text: text } });
      } catch (histErr) {}

      // Increment usage
      await prisma.genieUsage.update({ where: { id: usage.id }, data: { requestCount: { increment: 1 } } });
      var newRemaining = Math.max(0, limit - usage.requestCount - 1);

      return { response: text, used: usage.requestCount + 1, limit: limit, remaining: newRemaining };
    } catch (e) {
      console.log('[genie] error: ' + (e.message || e));
      return { response: 'I am unable to retrieve resources at the moment. Please try again shortly.' };
    }
  });

  // Buy Genie credits (one-time purchase)
  app.post('/buy-credits', { preHandler: [app.authenticate] }, async (request, reply) => {
    var pack = request.body.pack;
    var PACKS = {
      genie10: { requests: 10, priceKey: 'RESOURCES_INCREASE_10' },
      genie20: { requests: 20, priceKey: 'RESOURCES_INCREASE_20' },
    };
    var selected = PACKS[pack];
    if (!selected) return reply.code(400).send({ error: 'Invalid pack' });
    var now = new Date();
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    if (!process.env.STRIPE_SECRET_KEY) {
      // Demo mode: instantly add
      var usage = await getGenieUsage(request.user.id);
      await prisma.genieUsage.update({ where: { id: usage.id }, data: { bonusRequests: { increment: selected.requests } } });
      return { status: 'added', requests: selected.requests, demo: true };
    }

    var priceId = process.env[selected.priceKey];
    if (!priceId) return reply.code(400).send({ error: 'Price not configured for ' + pack });

    var stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    var user = await prisma.user.findUnique({ where: { id: request.user.id }, select: { email: true, stripeCustomerId: true } });
    var session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.stripeCustomerId ? undefined : user.email,
      customer: user.stripeCustomerId || undefined,
      success_url: 'https://api.riff-app.co.uk/api/subscriptions/payment-success',
      cancel_url: 'riff://bot-connection/resources',
      metadata: { userId: request.user.id, type: 'genie_credits', requests: String(selected.requests) },
    });
    return { checkoutUrl: session.url, sessionId: session.id };
  });

  // Get Genie conversation history
  app.get('/history', { preHandler: [app.authenticate] }, async (request) => {
    var msgs = await prisma.genieMessage.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return { messages: msgs.map(function(m) { return { id: m.id, role: m.role, text: m.text, createdAt: m.createdAt }; }) };
  });

  // Search Genie history by keyword
  app.get('/search', { preHandler: [app.authenticate] }, async (request) => {
    var q = (request.query.q || '').trim();
    if (!q) return { results: [] };
    var msgs = await prisma.genieMessage.findMany({
      where: {
        userId: request.user.id,
        text: { contains: q, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { results: msgs.map(function(m) { return { id: m.id, role: m.role, text: m.text, createdAt: m.createdAt }; }) };
  });

}

module.exports = genieRoutes;
