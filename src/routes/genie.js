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

      const res = await kimiClient.chat.completions.create({
        model: KIMI_MODEL,
        max_tokens: 2048,
        temperature: 1,
        messages: [{ role: 'system', content: GENIE_SYSTEM }, ...msgs],
      });

      const text = res.choices && res.choices[0] && res.choices[0].message ? res.choices[0].message.content : 'I could not find resources for that. Please rephrase.';

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
}

module.exports = genieRoutes;
