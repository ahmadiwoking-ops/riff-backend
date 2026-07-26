const prisma = require('../db');
const { generateKimiResponse, generateAudioResponse, GAME_DATA } = require('../services/kimi-bot');

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
      select: { plan: true, planExpiresAt: true, botConnectionPlan: true, botConnectionExpiresAt: true },
    });

    const usage = await checkUsage(request.user.id);
    const limit = 500 + (usage.bonusMessages || 0);
    const remaining = Math.max(0, limit - usage.messageCount);

    return {
      plan: user.botConnectionPlan || user.plan || 'none',
      expiresAt: user.botConnectionExpiresAt,
      usage: { used: usage.messageCount, limit, remaining },
      active: (user.botConnectionPlan === 'bot_connection' && (!user.botConnectionExpiresAt || user.botConnectionExpiresAt > new Date())) || (['bot_connection','explorer','inner_circle'].includes(user.plan) && (!user.planExpiresAt || user.planExpiresAt > new Date())),
    };
  });

  // ═══ Subscribe to Bot Connection (demo mode for now) ═══
  app.post('/subscribe', { preHandler: [app.authenticate] }, async (request) => {
    const { billing } = request.body || {};

    if (!process.env.STRIPE_SECRET_KEY) {
      // Demo mode: instant activation
      await prisma.user.update({
        where: { id: request.user.id },
        data: {
          botConnectionPlan: 'bot_connection',
          botConnectionExpiresAt: new Date(Date.now() + (billing === 'yearly' ? 365 : 30) * 86400000),
        },
      });
      return { status: 'activated', plan: 'bot_connection', demo: true };
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const user = await prisma.user.findUnique({ where: { id: request.user.id } });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
      customerId = customer.id;
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }

    const priceId = billing === 'yearly'
      ? process.env.STRIPE_BOT_CONNECTION_YEARLY_PRICE_ID
      : process.env.STRIPE_BOT_CONNECTION_MONTHLY_PRICE_ID;

    if (!priceId) {
      // Fallback to demo mode if price IDs not configured
      await prisma.user.update({
        where: { id: request.user.id },
        data: {
          botConnectionPlan: 'bot_connection',
          botConnectionExpiresAt: new Date(Date.now() + (billing === 'yearly' ? 365 : 30) * 86400000),
        },
      });
      return { status: 'activated', plan: 'bot_connection', demo: true };
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://riff-app.co.uk/get-started?bot_connection=success',
      cancel_url: 'https://riff-app.co.uk/get-started?bot_connection=cancel',
      metadata: { userId: user.id, type: 'bot_connection', billing },
    });

    return { checkoutUrl: session.url, sessionId: session.id };
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
    const paidPlans = ['bot_connection', 'explorer', 'inner_circle', 'single'];
    const hasBotPlan = user.botConnectionPlan === 'bot_connection' && (!user.botConnectionExpiresAt || user.botConnectionExpiresAt > new Date());
    const hasAppPlan = paidPlans.includes(user.plan) && (!user.planExpiresAt || user.planExpiresAt > new Date());
    if (!hasBotPlan && !hasAppPlan) {
      return reply.code(403).send({ error: 'Bot Connection subscription required', code: 'NO_SUBSCRIPTION' });
    }

    // Check usage limit
    const usage = await checkUsage(request.user.id);
    const effectiveLimit = 500 + (usage.bonusMessages || 0);
    if (usage.messageCount >= effectiveLimit) {
      return reply.code(429).send({ error: 'Message limit reached (' + usage.messageCount + '/' + effectiveLimit + '). Buy more credits or wait for reset.', code: 'LIMIT_REACHED' });
    }

    // Get persona from DB or use requested one
    var personaRecord = persona
      ? await prisma.botPersona.findFirst({ where: { alias: persona } })
      : await prisma.botPersona.findFirst({ where: { alias: 'Luna' } });
    if (!personaRecord && persona) personaRecord = { alias: persona };

    // Generate text response via Kimi
    const response = await generateKimiResponse(
      personaRecord,
      message,
      conversationHistory || [],
      mode || (mode || 'chat'),
      gameContext
    );

    // Generate audio if requested
    let audio = null;
    if (withAudio && response.text) {
      audio = await generateAudioResponse(response.text, personaRecord?.alias || 'Luna');
    }

    // Increment usage
    await prisma.botConnectionUsage.update({
      where: { id: usage.id },
      data: { messageCount: { increment: 1 } },
    });

    return {
      response: response.text,
      source: response.source,
      persona: personaRecord?.alias || 'Luna',
      audio: audio || null,
      usage: { used: usage.messageCount + 1, limit: effectiveLimit, remaining: Math.max(0, effectiveLimit - usage.messageCount - 1) },
    };
  });

  // ═══ Demo chat (free users, 10 messages tracked server-side) ═══
  app.post('/demo', { preHandler: [app.authenticate] }, async (request, reply) => {
    const DEMO_LIMIT = 10;
    const { message, conversationHistory, persona, mode } = request.body;
    if (!message) return reply.code(400).send({ error: 'Message required' });
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let usage = await prisma.botConnectionUsage.findFirst({ where: { userId: request.user.id, monthStart: monthStart } });
    if (!usage) { usage = await prisma.botConnectionUsage.create({ data: { userId: request.user.id, monthStart: monthStart, messageCount: 0, bonusMessages: 0 } }); }
    if (usage.messageCount >= DEMO_LIMIT) { return reply.code(429).send({ error: 'Demo limit reached. Subscribe to continue.', remaining: 0, limit: DEMO_LIMIT, used: usage.messageCount }); }
    const personaRecord = persona ? await prisma.botPersona.findFirst({ where: { alias: persona } }) : await prisma.botPersona.findFirst({ where: { alias: 'Luna' } });
    const response = await generateKimiResponse(personaRecord || { alias: persona || 'Luna' }, message, conversationHistory || [], (mode || 'chat'), null);
    let audio = null;
    if (response.text) { audio = await generateAudioResponse(response.text, personaRecord?.alias || 'Luna'); }
    await prisma.botConnectionUsage.update({ where: { id: usage.id }, data: { messageCount: usage.messageCount + 1 } });
    return { response: response.text, source: response.source, persona: personaRecord?.alias || 'Luna', audio: audio || null, isDemo: true, usage: { used: usage.messageCount + 1, limit: DEMO_LIMIT, remaining: Math.max(0, DEMO_LIMIT - usage.messageCount - 1) } };
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
      orderBy: { createdAt: 'asc' }, take: 100,
      select: { id: true, type: true, content: true, createdAt: true },
    });
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
    var now = new Date();
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    if (!process.env.STRIPE_SECRET_KEY) {
      var usage = await prisma.botConnectionUsage.findFirst({ where: { userId: request.user.id, monthStart: monthStart } });
      if (!usage) usage = await prisma.botConnectionUsage.create({ data: { userId: request.user.id, monthStart: monthStart, messageCount: 0, bonusMessages: 0 } });
      await prisma.botConnectionUsage.update({ where: { id: usage.id }, data: { bonusMessages: { increment: selected.messages } } });
      return { status: 'added', messages: selected.messages, demo: true };
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

}
module.exports = botConnectionRoutes;
