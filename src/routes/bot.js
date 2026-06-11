const prisma = require('../db');
const { generateResponse } = require('../services/bot');
async function botRoutes(app) {
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
