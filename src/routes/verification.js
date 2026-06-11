const prisma = require('../db');

async function verificationRoutes(app) {
  // Get verification status
  app.get('/status', { preHandler: [app.authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { phoneVerified: true, selfieVerified: true, idVerified: true, trustScore: true, plan: true },
    });
    return {
      verification: user,
      tier: user.idVerified ? 'full' : user.selfieVerified ? 'basic' : 'none',
      badgeColor: user.idVerified ? 'green' : user.selfieVerified ? 'yellow' : 'red',
    };
  });

  // Complete free verification (selfie liveness - on device)
  app.post('/selfie-complete', { preHandler: [app.authenticate] }, async (request) => {
    await prisma.user.update({
      where: { id: request.user.id },
      data: { selfieVerified: true, trustScore: 'yellow' },
    });
    return { status: 'verified', tier: 'basic', badgeColor: 'yellow' };
  });

  // Complete phone verification (included in £2.99)
  app.post('/phone-complete', { preHandler: [app.authenticate] }, async (request) => {
    await prisma.user.update({
      where: { id: request.user.id },
      data: { phoneVerified: true },
    });
    return { status: 'verified' };
  });

  // Purchase full ID verification (£2.99)
  app.post('/purchase-full', { preHandler: [app.authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.id } });

    // Check if already verified
    if (user.idVerified) return { status: 'already_verified', tier: 'full' };

    // Check if user has paid subscription (included free for paid users)
    if (user.plan === 'explorer' || user.plan === 'inner_circle') {
      await prisma.user.update({
        where: { id: request.user.id },
        data: { idVerified: true, phoneVerified: true, selfieVerified: true, trustScore: 'green' },
      });
      return { status: 'verified_via_subscription', tier: 'full', badgeColor: 'green', charged: false };
    }

    // Demo mode - process immediately (real Stripe integration later)
    if (!process.env.STRIPE_SECRET_KEY) {
      await prisma.user.update({
        where: { id: request.user.id },
        data: { idVerified: true, phoneVerified: true, selfieVerified: true, trustScore: 'green' },
      });
      return { status: 'verified', tier: 'full', badgeColor: 'green', charged: true, amount: 299, currency: 'gbp' };
    }

    // Real Stripe payment
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 299,
      currency: 'gbp',
      metadata: { userId: request.user.id, type: 'id_verification' },
    });

    return { clientSecret: paymentIntent.client_secret, amount: 299, currency: 'gbp' };
  });

  // Confirm payment and complete verification
  app.post('/confirm-payment', { preHandler: [app.authenticate] }, async (request) => {
    await prisma.user.update({
      where: { id: request.user.id },
      data: { idVerified: true, phoneVerified: true, selfieVerified: true, trustScore: 'green' },
    });
    return { status: 'verified', tier: 'full', badgeColor: 'green' };
  });
}

module.exports = verificationRoutes;
