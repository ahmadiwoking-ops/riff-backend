const prisma = require('../db');
async function subscriptionRoutes(app) {
  app.get('/plans', async () => ({
    plans: {
      free: { name: 'Free', price: 0, currency: 'gbp', deepConnections: 1, circles: 1, idVerification: false },
      explorer: { name: 'Explorer', priceMonthly: 599, priceYearly: 3799, currency: 'gbp', deepConnections: 2, circles: 3, idVerification: true },
      inner_circle: { name: 'Inner Circle', priceMonthly: 1199, priceYearly: 7499, currency: 'gbp', deepConnections: -1, circles: -1, idVerification: true },
    },
  }));
  app.get('/current', { preHandler: [app.authenticate] }, async (request) => {
    return { subscription: await prisma.user.findUnique({ where: { id: request.user.id }, select: { plan: true, planExpiresAt: true } }) };
  });
  app.post('/checkout', { preHandler: [app.authenticate] }, async (request) => {
    const { plan, billing } = request.body;
    const user = await prisma.user.update({
      where: { id: request.user.id },
      data: { plan, planExpiresAt: new Date(Date.now() + (billing === 'yearly' ? 365 : 30) * 86400000) },
    });
    // If paid plan, auto-verify ID
    if (plan === 'explorer' || plan === 'inner_circle') {
      await prisma.user.update({
        where: { id: request.user.id },
        data: { idVerified: true, phoneVerified: true, selfieVerified: true, trustScore: 'green' },
      });
    }
    return { status: 'upgraded', plan };
  });
  app.post('/cancel', { preHandler: [app.authenticate] }, async (request) => {
    await prisma.user.update({ where: { id: request.user.id }, data: { plan: 'free', planExpiresAt: null } });
    return { status: 'cancelled', plan: 'free' };
  });
}
module.exports = subscriptionRoutes;
