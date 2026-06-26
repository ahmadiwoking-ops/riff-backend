const prisma = require('../db');

async function subscriptionRoutes(app) {
  app.get('/plans', async () => ({
    plans: {
      free: { name: 'Free', priceMonthly: 0, priceYearly: 0, currency: 'gbp', deepConnections: 1, circles: 1, verification: 'basic', badge: 'yellow' },
      explorer: { name: 'Explorer', priceMonthly: 599, priceYearly: 3799, currency: 'gbp', deepConnections: 2, circles: 3, verification: 'full', badge: 'green' },
      inner_circle: { name: 'Inner Circle', priceMonthly: 1199, priceYearly: 7499, currency: 'gbp', deepConnections: -1, circles: -1, verification: 'full', badge: 'green' },
      bot_connection: { name: 'Bot Connection', priceMonthly: 799, priceYearly: 7188, currency: 'gbp', deepConnections: 0, circles: 0, verification: 'none', badge: 'yellow', botMessages: 500 },
    },
  }));

  app.get('/current', { preHandler: [app.authenticate] }, async (request) => {
    return { subscription: await prisma.user.findUnique({ where: { id: request.user.id }, select: { plan: true, planExpiresAt: true } }) };
  });

  app.post('/checkout', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { plan, billing, source } = request.body;

    // Demo / no-Stripe mode: instant upgrade (used when STRIPE_SECRET_KEY is unset).
    if (!process.env.STRIPE_SECRET_KEY) {
      await prisma.user.update({
        where: { id: request.user.id },
        data: { plan, planExpiresAt: new Date(Date.now() + (billing === 'yearly' ? 365 : 30) * 86400000), idVerified: true, selfieVerified: true, phoneVerified: true, trustScore: 'green' },
      });
      return { status: 'upgraded', plan, demo: true };
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // Resolve the price FIRST so a bad plan/billing combo returns a clear 400
    // instead of a cryptic Stripe "missing price" error. Includes `single`,
    // which your app offers but the old map was missing.
    const priceMap = {
      single_monthly: process.env.STRIPE_PRICE_SINGLE_MONTHLY,
      single_yearly: process.env.STRIPE_PRICE_SINGLE_BIANNUAL,
      single_biannual: process.env.STRIPE_PRICE_SINGLE_BIANNUAL,
      explorer_monthly: process.env.STRIPE_PRICE_EXPLORER_MONTHLY,
      explorer_yearly: process.env.STRIPE_PRICE_EXPLORER_YEARLY,
      inner_circle_monthly: process.env.STRIPE_PRICE_INNER_CIRCLE_MONTHLY,
      inner_circle_yearly: process.env.STRIPE_PRICE_INNER_CIRCLE_YEARLY,
      bot_connection_monthly: process.env.STRIPE_PRICE_BOT_CONNECTION_MONTHLY,
      bot_connection_yearly: process.env.STRIPE_PRICE_BOT_CONNECTION_YEARLY,
    };
    const priceKey = `${plan}_${billing}`;
    const priceId = priceMap[priceKey];
    if (!priceId) {
      request.log.error({ plan, billing, priceKey }, 'No Stripe price configured for this plan/billing');
      return reply.code(400).send({ error: `No price configured for ${priceKey}. Set the matching STRIPE_*_PRICE_ID env var to a test-mode price id.` });
    }

    const user = await prisma.user.findUnique({ where: { id: request.user.id } });

    // Create a fresh Stripe customer and persist it.
    const createCustomer = async () => {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
      return customer.id;
    };

    let customerId = user.stripeCustomerId || (await createCustomer());

    const buildSession = (cust) => stripe.checkout.sessions.create({
      mode: 'subscription', customer: cust,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: source === 'mobile' ? 'riff://verification?onboarding=true' : 'https://riff-app.co.uk/get-started?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: source === 'mobile' ? 'riff://subscription?onboarding=true' : 'https://riff-app.co.uk/get-started',
      metadata: { userId: user.id, plan, billing },
    });

    let session;
    try {
      session = await buildSession(customerId);
    } catch (err) {
      // Self-heal: stored customer doesn't exist in this Stripe mode/account
      // (test/live mismatch or deleted). Recreate once and retry.
      if (err && err.code === 'resource_missing' && err.param === 'customer') {
        request.log.warn({ customerId }, 'Stored Stripe customer missing — recreating and retrying');
        customerId = await createCustomer();
        session = await buildSession(customerId);
      } else {
        throw err;
      }
    }

    return { checkoutUrl: session.url, sessionId: session.id };
  });

  app.post('/cancel', { preHandler: [app.authenticate] }, async (request) => {
    await prisma.user.update({ where: { id: request.user.id }, data: { plan: 'free', planExpiresAt: null } });
    return { status: 'cancelled', plan: 'free' };
  });
// Verify a checkout session and activate the plan (called by mobile after Stripe redirect)
  app.post('/verify-session', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sessionId } = request.body;
    if (!sessionId || !process.env.STRIPE_SECRET_KEY) return reply.status(400).send({ error: 'Missing session' });
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid' && session.metadata?.plan) {
        await prisma.user.update({
          where: { id: request.user.id },
          data: { plan: session.metadata.plan, planExpiresAt: new Date(Date.now() + 30 * 86400000) },
        });
        return { status: 'activated', plan: session.metadata.plan };
      }
      return { status: 'pending' };
    } catch (err) {
      return reply.status(400).send({ error: 'Could not verify session' });
    }
  });
  // Stripe webhook for subscription events
  app.post('/webhook', async (request, reply) => {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return { received: true };

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = request.headers['stripe-signature'];
    let event;
    try { event = stripe.webhooks.constructEvent(request.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET); }
    catch { return reply.status(400).send({ error: 'Invalid signature' }); }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { userId, plan } = session.metadata;
      if (userId && plan) {
        await prisma.user.update({
          where: { id: userId },
          data: { plan, planExpiresAt: new Date(Date.now() + 30 * 86400000), idVerified: true, selfieVerified: true, phoneVerified: true, trustScore: 'green' },
        });
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const customer = await stripe.customers.retrieve(sub.customer);
      if (customer.metadata?.userId) {
        await prisma.user.update({ where: { id: customer.metadata.userId }, data: { plan: 'free', planExpiresAt: null } });
      }
    }

    return { received: true };
  });
}

module.exports = subscriptionRoutes;
