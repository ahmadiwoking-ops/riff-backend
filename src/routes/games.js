const prisma = require('../db');
const { generateGame } = require('../services/games');
async function gameRoutes(app) {
  app.post('/start', { preHandler: [app.authenticate] }, async (request) => {
    const { circleId, gameType } = request.body;
    const gameData = generateGame(gameType);
    const game = await prisma.circleGame.create({ data: { circleId, gameType, data: gameData, startedBy: request.user.id } });
    return { game };
  });
  app.post('/:gameId/respond', { preHandler: [app.authenticate] }, async (request) => {
    const { roundNum, response } = request.body;
    const gameResponse = await prisma.gameResponse.create({ data: { gameId: request.params.gameId, userId: request.user.id, roundNum: roundNum || 0, response } });
    return { response: gameResponse };
  });
  app.get('/:gameId', { preHandler: [app.authenticate] }, async (request) => {
    return { game: await prisma.circleGame.findUnique({ where: { id: request.params.gameId }, include: { responses: true } }) };
  });
}
module.exports = gameRoutes;
