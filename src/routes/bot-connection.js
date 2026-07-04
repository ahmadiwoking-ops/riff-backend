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
      select: { botConnectionPlan: true, botConnectionExpiresAt: true },
    });

    const usage = await checkUsage(request.user.id);
    const limit = 500;
    const remaining = Math.max(0, limit - usage.messageCount);

    return {
      plan: user.botConnectionPlan || 'none',
      expiresAt: user.botConnectionExpiresAt,
      usage: { used: usage.messageCount, limit, remaining },
      active: user.botConnectionPlan === 'bot_connection' && (!user.botConnectionExpiresAt || user.botConnectionExpiresAt > new Date()),
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
    if (usage.messageCount >= 500) {
      return reply.code(429).send({ error: 'Monthly message limit reached (500/500). Resets on the 1st.', code: 'LIMIT_REACHED' });
    }

    // Get persona from DB or use requested one
    const personaRecord = persona
      ? await prisma.botPersona.findFirst({ where: { alias: persona } })
      : await prisma.botPersona.findFirst({ where: { alias: 'Luna' } });

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
      usage: { used: usage.messageCount + 1, limit: 500, remaining: Math.max(0, 499 - usage.messageCount) },
    };
  });

  // ═══ Demo chat (no subscription required, limited) ═══
  app.post('/demo', async (request, reply) => {
    const { message, conversationHistory, persona, mode } = request.body;

    if (!message) return reply.code(400).send({ error: 'Message required' });

    const personaRecord = persona
      ? await prisma.botPersona.findFirst({ where: { alias: persona } })
      : await prisma.botPersona.findFirst({ where: { alias: 'Luna' } });

    const response = await generateKimiResponse(
      personaRecord,
      message,
      conversationHistory || [],
      (mode || 'chat'),
      null
    );

    // Demo includes one audio sample to show the feature
    let audio = null;
    if (response.text) {
      audio = await generateAudioResponse(response.text, personaRecord?.alias || 'Luna');
    }

    return {
      response: response.text,
      source: response.source,
      persona: personaRecord?.alias || 'Luna',
      audio: audio || null,
      isDemo: true,
    };
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
}

module.exports = botConnectionRoutes;
