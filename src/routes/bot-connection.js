const prisma = require('../db');
const { generateKimiResponse, generateAudioResponse, GAME_DATA } = require('../services/kimi-bot');
const { loadMemory, updateMemory } = require('../services/persona-memory');
const FREE_PERSONAS = ['Luna', 'Zara', 'Naia', 'Oscar', 'Maya']; // 5 personas available on free plan
// Personas that discuss adult topics candidly. Subscription is a payment, not an
// age check — these require completed ID verification (idVerified), not just a plan.
const VERIFIED_ONLY_PERSONAS = ['Yuki'];

// Who gets the full companion experience (all 25, 500 a month). Single is deliberately
// not here: Single and free users get the 5 free companions and 50 messages once.
const FULL_ACCESS_PLANS = ['bot_connection', 'explorer', 'inner_circle'];
const MONTHLY_ALLOWANCE = 500;
function hasFullAccess(user) {
  const now = new Date();
  const legacy = user.botConnectionPlan === 'bot_connection' && (!user.botConnectionExpiresAt || user.botConnectionExpiresAt > now);
  const plan = FULL_ACCESS_PLANS.includes(user.plan) && (!user.planExpiresAt || user.planExpiresAt > now);
  return legacy || plan;
}
// Takes credits only if there are enough - the balance can never go negative.
async function spendCredits(userId, n) {
  const r = await prisma.user.updateMany({ where: { id: userId, creditBalance: { gte: n } }, data: { creditBalance: { decrement: n } } });
  return r.count === 1;
}

async function botConnectionRoutes(app) {

  // ═══ Usage check helper ═══
  async function checkUsage(userId) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let usage = await prisma.botConnectionUsage.findFirst({
      where: { userId, monthStart },
    });

    if (!usage) {
      usage = await prisma.botConnectionUsage.create({
        data: { userId, monthStart, messageCount: 0 },
      });
    }

    return usage;
  }

  // ═══ Get subscription status and usage ═══
  app.get('/status', { preHandler: [app.authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { plan: true, planExpiresAt: true, botConnectionPlan: true, botConnectionExpiresAt: true, creditBalance: true, freeChatUsed: true },
    });
    const full = hasFullAccess(user);
    const credits = user.creditBalance || 0;
    let used, allowance;
    if (full) { const usage = await checkUsage(request.user.id); used = usage.messageCount; allowance = MONTHLY_ALLOWANCE; }
    else { used = Math.min(50, user.freeChatUsed || 0); allowance = 50; }
    return {
      plan: user.plan || 'free',
      expiresAt: user.botConnectionExpiresAt,
      usage: { used, limit: allowance + credits, remaining: Math.max(0, allowance - used) + credits, credits, allowance, monthly: full },
      active: full,
    };
  });

  // ═══ Chat (text + optional audio) ═══
  app.post('/chat', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { message, conversationHistory, persona, mode, withAudio, gameContext } = request.body;

    if (!message) return reply.code(400).send({ error: 'Message required' });

    // Check subscription
    const user = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { plan: true, botConnectionPlan: true, botConnectionExpiresAt: true, planExpiresAt: true },
    });
    if (!hasFullAccess(user)) {
      return reply.code(403).send({ error: 'AI Companions subscription required', code: 'NO_SUBSCRIPTION' });
    }

    // Age-restricted personas require real ID verification, not just a subscription.
    if (persona && VERIFIED_ONLY_PERSONAS.includes(persona)) {
      const vu = await prisma.user.findUnique({ where: { id: request.user.id }, select: { idVerified: true } });
      if (!vu || vu.idVerified !== true) {
        return reply.code(403).send({ error: persona + ' is only available to ID-verified adults. Complete verification in your profile to chat with them.', code: 'VERIFICATION_REQUIRED', persona: persona });
      }
    }

    // Check usage limit
    const usage = await checkUsage(request.user.id);
    const me = await prisma.user.findUnique({ where: { id: request.user.id }, select: { creditBalance: true } });
    const fromAllowance = usage.messageCount < MONTHLY_ALLOWANCE;
    if (!fromAllowance && (me.creditBalance || 0) < 1) {
      return reply.code(429).send({ error: 'You have used your ' + MONTHLY_ALLOWANCE + ' messages this month. Buy credits to keep chatting, or wait for your allowance to reset.', code: 'LIMIT_REACHED' });
    }

    // Get persona from DB or use requested one
    var personaRecord = persona
      ? await prisma.botPersona.findFirst({ where: { alias: persona } })
      : await prisma.botPersona.findFirst({ where: { alias: 'Luna' } });
    if (!personaRecord && persona) personaRecord = { alias: persona };

    // Load persona memory and inject it as context at the start of history
    var personaAlias = personaRecord && personaRecord.alias ? personaRecord.alias : (persona || 'Luna');
    var memorySummary = await loadMemory(request.user.id, personaAlias);
    var historyWithMemory = (conversationHistory || []).slice();
    if (memorySummary) {
      historyWithMemory.unshift({ role: 'assistant', content: '[Things I remember about you from our past conversations: ' + memorySummary + ']' });
    }
    // Generate text response via Kimi
    const response = await generateKimiResponse(
      personaRecord,
      message,
      historyWithMemory,
      mode || (mode || 'chat'),
      gameContext
    );
    // Update memory in the background (non-blocking)
    updateMemory(request.user.id, personaAlias, (conversationHistory || []).concat([{ role: 'user', content: message }, { role: 'assistant', content: response.text }])).catch(function() {});

    // Generate audio if requested
    let audio = null;
    if (withAudio && response.text) {
      audio = await generateAudioResponse(response.text, personaRecord?.alias || 'Luna');
    }

    // Use the monthly allowance first, then one credit
    if (fromAllowance) {
      await prisma.botConnectionUsage.update({ where: { id: usage.id }, data: { messageCount: { increment: 1 } } });
    } else {
      await spendCredits(request.user.id, 1);
    }
    const after = await prisma.user.findUnique({ where: { id: request.user.id }, select: { creditBalance: true } });
    const usedNow = fromAllowance ? usage.messageCount + 1 : usage.messageCount;
    const creditsNow = after.creditBalance || 0;

    return {
      response: response.text,
      source: response.source,
      persona: personaRecord?.alias || 'Luna',
      audio: audio || null,
      usage: { used: usedNow, limit: MONTHLY_ALLOWANCE + creditsNow, remaining: Math.max(0, MONTHLY_ALLOWANCE - usedNow) + creditsNow, credits: creditsNow, allowance: MONTHLY_ALLOWANCE, monthly: true },
    };
  });

  // ═══ Free chat (free and Single users): 5 companions, 50 messages once ever, then credits ═══
  app.post('/demo', { preHandler: [app.authenticate] }, async (request, reply) => {
    const DEMO_LIMIT = 50;
    const { message, conversationHistory, persona, mode } = request.body;
    if (!message) return reply.code(400).send({ error: 'Message required' });
    // Free plan can only chat with the 5 free personas; the rest require a subscription.
    if (persona && VERIFIED_ONLY_PERSONAS.includes(persona)) {
      return reply.code(403).send({ error: persona + ' is only available to ID-verified adults on a paid plan.', code: 'VERIFICATION_REQUIRED', persona: persona });
    }
    if (persona && !FREE_PERSONAS.includes(persona)) {
      return reply.code(403).send({ locked: true, upgrade: true, code: 'PERSONA_LOCKED',
        message: persona + ' is available on paid plans. Subscribe to chat with all 25 companions.' });
    }
    const me = await prisma.user.findUnique({ where: { id: request.user.id }, select: { freeChatUsed: true, creditBalance: true } });
    const fromFree = (me.freeChatUsed || 0) < DEMO_LIMIT;
    if (!fromFree && (me.creditBalance || 0) < 1) {
      return reply.code(429).send({ error: 'You have used your ' + DEMO_LIMIT + ' free messages. Buy credits or subscribe to keep chatting.', remaining: 0, limit: DEMO_LIMIT, used: me.freeChatUsed, code: 'LIMIT_REACHED' });
    }
    const personaRecord = persona ? await prisma.botPersona.findFirst({ where: { alias: persona } }) : await prisma.botPersona.findFirst({ where: { alias: 'Luna' } });
    const response = await generateKimiResponse(personaRecord || { alias: persona || 'Luna' }, message, conversationHistory || [], (mode || 'chat'), null);
    let audio = null;
    // Audio now generated on-demand via /tts when the user taps play (saves cost + latency)
    if (fromFree) {
      await prisma.user.update({ where: { id: request.user.id }, data: { freeChatUsed: { increment: 1 } } });
    } else {
      await spendCredits(request.user.id, 1);
    }
    const after = await prisma.user.findUnique({ where: { id: request.user.id }, select: { freeChatUsed: true, creditBalance: true } });
    const freeUsed = Math.min(DEMO_LIMIT, after.freeChatUsed || 0), creditsNow = after.creditBalance || 0;
    return { response: response.text, source: response.source, persona: personaRecord?.alias || 'Luna', audio: audio || null, isDemo: true, usage: { used: freeUsed, limit: DEMO_LIMIT + creditsNow, remaining: Math.max(0, DEMO_LIMIT - freeUsed) + creditsNow, credits: creditsNow, allowance: DEMO_LIMIT, monthly: false } };
  });

  // ═══ Get available personas ═══
  app.get('/personas', { preHandler: [app.authenticate] }, async () => {
    const personas = await prisma.botPersona.findMany({
      where: { isActive: true },
      select: { id: true, alias: true, gender: true, age: true, country: true, archetype: true, bio: true },
    });
    return { personas };
  });

  // ═══ Get available games ═══
  app.get('/games', { preHandler: [app.authenticate] }, async () => {
    return {
      games: Object.entries(GAME_DATA).map(([key, game]) => ({
        id: key,
        name: game.name,
        hasRounds: !!game.rounds || !!game.statements,
      })),
    };
  });

  // ═══ Start a game ═══
  // ═══ On-demand TTS: generate audio only when the user taps play ═══
  app.post('/tts', { preHandler: [app.authenticate] }, async (request, reply) => {
    var text = request.body && request.body.text;
    var persona = (request.body && request.body.persona) || 'Luna';
    if (!text) return reply.code(400).send({ error: 'text required' });
    if (text.length > 2000) text = text.slice(0, 2000);
    try {
      var audio = await generateAudioResponse(text, persona);
      if (!audio) return reply.code(503).send({ error: 'Audio unavailable' });
      return { audio: audio };
    } catch (err) {
      request.log.error(err, 'on-demand tts error');
      return reply.code(500).send({ error: 'Could not generate audio' });
    }
  });

  app.post('/game/start', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { gameId, persona } = request.body;
    const game = GAME_DATA[gameId];
    if (!game) return reply.code(400).send({ error: 'Unknown game' });

    return {
      game: gameId,
      name: game.name,
      rounds: game.rounds || game.statements || null,
      instruction: game.instruction || null,
    };
  });

  // ═══ Cancel subscription ═══
  app.post('/cancel', { preHandler: [app.authenticate] }, async (request) => {
    await prisma.user.update({
      where: { id: request.user.id },
      data: { botConnectionPlan: null, botConnectionExpiresAt: null },
    });
    return { status: 'cancelled' };
  });


  // ═══ Save bot chat message ═══
  app.post('/save-message', { preHandler: [app.authenticate] }, async (request) => {
    var { persona, role, text } = request.body;
    if (!persona || !text) return { error: 'persona and text required' };
    await prisma.message.create({
      data: { senderId: request.user.id, circleId: 'bot_' + persona, type: role === 'user' ? 'bot_user' : 'bot_reply', content: text },
    });
    return { saved: true };
  });

  // ═══ Load bot chat history ═══
  app.get('/history/:persona', { preHandler: [app.authenticate] }, async (request) => {
    var messages = await prisma.message.findMany({
      where: { senderId: request.user.id, circleId: 'bot_' + request.params.persona },
      orderBy: { createdAt: 'desc' }, take: 200,
      select: { id: true, type: true, content: true, createdAt: true },
    });
    messages.reverse(); // desc fetch (newest 200) -> chronological order for display
    return { messages: messages.map(function(m) { return { id: m.id, role: m.type === 'bot_user' ? 'user' : 'bot', text: m.content, timestamp: m.createdAt.getTime() }; }) };
  });

  // ═══ List bot conversations ═══
  app.get('/conversations', { preHandler: [app.authenticate] }, async (request) => {
    var msgs = await prisma.message.findMany({
      where: { senderId: request.user.id, circleId: { startsWith: 'bot_' } },
      orderBy: { createdAt: 'desc' },
      select: { circleId: true, content: true, createdAt: true, type: true },
    });
    var convos = {};
    msgs.forEach(function(m) {
      var p = m.circleId.replace('bot_', '');
      if (!convos[p]) convos[p] = { persona: p, lastMessage: m.content, lastAt: m.createdAt, messageCount: 0 };
      convos[p].messageCount++;
    });
    return { conversations: Object.values(convos) };
  });



  // ═══ Buy message credits (one-time purchase) ═══
  app.post('/buy-credits', { preHandler: [app.authenticate] }, async (request, reply) => {
    var pack = request.body.pack;
    var PACKS = {
      pack100: { messages: 100, priceKey: 'STRIPE_PRICE_CREDITS_100' },
      pack200: { messages: 200, priceKey: 'STRIPE_PRICE_CREDITS_200' },
      pack300: { messages: 300, priceKey: 'STRIPE_PRICE_CREDITS_300' },
      pack400: { messages: 400, priceKey: 'STRIPE_PRICE_CREDITS_400' },
      pack500: { messages: 500, priceKey: 'STRIPE_PRICE_CREDITS_500' },
    };
    var selected = PACKS[pack];
    if (!selected) return reply.code(400).send({ error: 'Invalid pack' });
    if (!process.env.STRIPE_SECRET_KEY) {
      return reply.code(503).send({ error: 'Purchases are temporarily unavailable.' });
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
      cancel_url: 'riff://bot-connection',
      metadata: { userId: request.user.id, type: 'message_credits', messages: String(selected.messages) },
    });
    return { checkoutUrl: session.url, sessionId: session.id };
  });


  // ═══ Public web demo (no auth — for marketing website) ═══
  var webDemoHits = {};
  app.post('/web-demo', async (request, reply) => {
    var ip = request.headers['x-forwarded-for'] || request.ip || 'unknown';
    var now = Date.now();
    if (!webDemoHits[ip]) webDemoHits[ip] = [];
    webDemoHits[ip] = webDemoHits[ip].filter(function(t) { return now - t < 3600000; });
    if (webDemoHits[ip].length >= 30) {
      return reply.code(429).send({ response: "thanks for trying the demo! download the app to keep chatting with me.", rateLimited: true });
    }
    webDemoHits[ip].push(now);
    var message = request.body.message;
    var persona = request.body.persona;
    var conversationHistory = request.body.conversationHistory || [];
    if (!message) return reply.code(400).send({ error: 'Message required' });
    var personaRecord = persona ? await prisma.botPersona.findFirst({ where: { alias: persona } }) : await prisma.botPersona.findFirst({ where: { alias: 'Luna' } });
    var response = await generateKimiResponse(personaRecord || { alias: persona || 'Luna' }, message, conversationHistory, 'chat', null);
    return { response: response.text, persona: personaRecord ? personaRecord.alias : (persona || 'Luna') };
  });

}
module.exports = botConnectionRoutes;
