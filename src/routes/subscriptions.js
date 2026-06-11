const prisma = require('../db');
async function subscriptionRoutes(app) {
  app.get('/plans', async () => ({ plans: { free: { name: 'Free', deepConnections: 1, circles: 1 }, explorer: { name: 'Explorer', priceMonthly: 799, priceYearly: 4999, deepConnections: 2, circles: 3 }, inner_circle: { name: 'Inner Circle', priceMonthly: 1499, priceYearly: 9999, deepConnections: -1, circles: -1 } } }));
  app.get('/current', { preHandler: [app.authenticate] }, async (request) => {
    return { subscription: await prisma.user.findUnique({ where: { id: request.user.id }, select: { plan: true, planExpiresAt: true } }) };
  });
  app.post('/checkout', { preHandler: [app.authenticate] }, async (request) => {
    const { plan, billing } = request.body;
    await prisma.user.update({ where: { id: request.user.id }, data: { plan, planExpiresAt: new Date(Date.now() + (billing === 'yearly' ? 365 : 30) * 86400000) } });
    return { status: 'upgraded', plan };
  });
  app.post('/cancel', { preHandler: [app.authenticate] }, async (request) => {
    await prisma.user.update({ where: { id: request.user.id }, data: { plan: 'free', planExpiresAt: null } });
    return { status: 'cancelled', plan: 'free' };
  });
}
module.exports = subscriptionRoutes;
