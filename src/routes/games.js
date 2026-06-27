const prisma = require('../db');
const { generateGame } = require('../services/games');
async function gameRoutes(app) {
  app.post('/start', { preHandler: [app.authenticate] }, async (request) => {
    const { circleId, gameType } = request.body;
    // Auto-complete any active games older than 24 hours
    await prisma.circleGame.updateMany({
      where: { circleId, status: 'active', createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      data: { status: 'expired', completedAt: new Date() },
    });
    // Complete any other active games in this circle
    await prisma.circleGame.updateMany({
      where: { circleId, status: 'active' },
      data: { status: 'completed', completedAt: new Date() },
    });
    const gameData = generateGame(gameType);
    const game = await prisma.circleGame.create({ data: { circleId, gameType, data: gameData, startedBy: request.user.id } });
    return { game };
  });
  app.post('/:gameId/respond', { preHandler: [app.authenticate] }, async (request) => {
    const { roundNum, response } = request.body;
    const gameResponse = await prisma.gameResponse.create({ data: { gameId: request.params.gameId, userId: request.user.id, roundNum: roundNum || 0, response } });
    return { response: gameResponse };
  });
  app.post('/:gameId/end', { preHandler: [app.authenticate] }, async (request) => {
    const game = await prisma.circleGame.update({
      where: { id: request.params.gameId },
      data: { status: 'completed', completedAt: new Date() },
    });
    return { game };
  });
  app.get('/:gameId', { preHandler: [app.authenticate] }, async (request) => {
    return { game: await prisma.circleGame.findUnique({ where: { id: request.params.gameId }, include: { responses: true } }) };
  });
}
module.exports = gameRoutes;