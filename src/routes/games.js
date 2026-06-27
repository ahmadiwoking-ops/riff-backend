const prisma = require('../db');
const { generateGame } = require('../services/games');
async function gameRoutes(app) {
  app.post('/start', { preHandler: [app.authenticate] }, async (request) => {
    const { circleId, gameType } = request.body;
    await prisma.circleGame.updateMany({
      where: { circleId, status: 'active', createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      data: { status: 'expired', completedAt: new Date() },
    });
    await prisma.circleGame.updateMany({
      where: { circleId, status: 'active' },
      data: { status: 'completed', completedAt: new Date() },
    });
    const gameData = generateGame(gameType);
    gameData.roundNum = 1;
    gameData.totalRounds = 5;
    const game = await prisma.circleGame.create({ data: { circleId, gameType, data: gameData, startedBy: request.user.id } });
    return { game };
  });

  app.post('/:gameId/respond', { preHandler: [app.authenticate] }, async (request) => {
    const { response } = request.body;
    const game = await prisma.circleGame.findUnique({ where: { id: request.params.gameId }, include: { responses: true } });
    if (!game || game.status !== 'active') return { error: 'Game not active', done: true };
    const currentRound = game.data.roundNum || 1;
    const totalRounds = game.data.totalRounds || 5;
    // Check if user already responded this round
    const existing = game.responses.find(function(r) { return r.userId === request.user.id && r.roundNum === currentRound; });
    if (existing) return { error: 'Already responded this round', alreadyResponded: true };
    // Save response
    await prisma.gameResponse.create({ data: { gameId: game.id, userId: request.user.id, roundNum: currentRound, response: response || {} } });
    // Advance to next round
    if (currentRound >= totalRounds) {
      // Game complete
      await prisma.circleGame.update({
        where: { id: game.id },
        data: { status: 'completed', completedAt: new Date() },
      });
      return { submitted: true, done: true, round: currentRound, totalRounds: totalRounds, message: 'Game complete!' };
    } else {
      // Generate next question
      const nextData = generateGame(game.gameType);
      nextData.roundNum = currentRound + 1;
      nextData.totalRounds = totalRounds;
      await prisma.circleGame.update({
        where: { id: game.id },
        data: { data: nextData },
      });
      return { submitted: true, done: false, round: currentRound + 1, totalRounds: totalRounds, nextQuestion: nextData };
    }
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