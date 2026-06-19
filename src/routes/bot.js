const prisma = require('../db');
const { generateResponse } = require('../services/bot');
async function botRoutes(app) {
  // Public demo endpoint for the marketing website (no auth required)
  // Per-IP daily cap so anonymous visitors can't drain Anthropic credits.
  app.post('/demo', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 day',
        keyGenerator: (req) => req.headers['x-forwarded-for'] || req.ip,
      },
    },
  }, async (request) => {
    const { message, conversationHistory } = request.body;
    const persona = await prisma.botPersona.findFirst({ where: { alias: 'Luna' } })
      || await prisma.botPersona.findFirst({ where: { isActive: true } });
    const response = await generateResponse(persona, message, conversationHistory || [], { maxTokens: 150 });
    return { response: response.text };
  });
  app.post('/respond', { preHandler: [app.authenticate] }, async (request) => {
    const { message, conversationHistory } = request.body;
    const persona = await prisma.botPersona.findFirst({ where: { isActive: true } });
    const response = await generateResponse(persona, message, conversationHistory || []);
    return { response: response.text };
  });
  app.get('/personas', { preHandler: [app.authenticate] }, async () => {
    return { personas: await prisma.botPersona.findMany({ where: { isActive: true }, select: { id: true, alias: true, gender: true, age: true, country: true, archetype: true, bio: true } }) };
  });
}
module.exports = botRoutes;
