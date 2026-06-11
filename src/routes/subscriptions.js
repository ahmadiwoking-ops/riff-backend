const prisma = require('../db');

async function subscriptionRoutes(app) {
  app.get('/plans', async () => ({
    plans: {
      free: { name: 'Free', priceMonthly: 0, priceYearly: 0, currency: 'gbp', deepConnections: 1, circles: 1, verification: 'basic', badge: 'yellow' },
      explorer: { name: 'Explorer', priceMonthly: 599, priceYearly: 3799, currency: 'gbp', deepConnections: 2, circles: 3, verification: 'full', badge: 'green' },
      inner_circle: { name: 'Inner Circle', priceMonthly: 1199, priceYearly: 7499, currency: 'gbp', deepConnections: -1, circles: -1, verification: 'full', badge: 'green' },
    },
  }));

  app.get('/current', { preHandler: [app.authenticate] }, async (request) => {
    return { subscription: await prisma.user.findUnique({ where: { id: request.user.id }, select: { plan: true, planExpiresAt: true } }) };
  });

  app.post('/checkout', { preHandler: [app.authenticate] }, async (request) => {
    const { plan, billing } = request.body;

    if (!process.env.STRIPE_SECRET_KEY) {
      const user = await prisma.user.update({
        where: { id: request.user.id },
        data: { plan, planExpiresAt: new Date(Date.now() + (billing === 'yearly' ? 365 : 30) * 86400000), idVerified: true, selfieVerified: true, phoneVerified: true, trustScore: 'green' },
      });
      return { status: 'upgraded', plan, demo: true };
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let user = await prisma.user.findUnique({ where: { id: request.user.id } });
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
      customerId = customer.id;
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }

    const priceMap = {
      explorer_monthly: process.env.STRIPE_EXPLORER_MONTHLY_PRICE_ID,
      explorer_yearly: process.env.STRIPE_EXPLORER_YEARLY_PRICE_ID,
      inner_circle_monthly: process.env.STRIPE_INNER_MONTHLY_PRICE_ID,
      inner_circle_yearly: process.env.STRIPE_INNER_YEARLY_PRICE_ID,
    };
    const priceId = priceMap[plan + '_' + billing];

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://riff-app.co.uk/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://riff-app.co.uk/cancel',
      metadata: { userId: user.id, plan, billing },
    });

    return { checkoutUrl: session.url, sessionId: session.id };
  });

  app.post('/cancel', { preHandler: [app.authenticate] }, async (request) => {
    await prisma.user.update({ where: { id: request.user.id }, data: { plan: 'free', planExpiresAt: null } });
    return { status: 'cancelled', plan: 'free' };
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
