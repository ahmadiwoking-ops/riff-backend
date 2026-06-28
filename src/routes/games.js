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
    const circle = await prisma.circle.findUnique({ where: { id: circleId }, include: { members: { where: { isActive: true } } } });
    const memberCount = circle ? circle.members.length : 4;
    const gameData = generateGame(gameType);
    gameData.roundNum = 1;
    gameData.totalRounds = 5;
    gameData.memberCount = memberCount;
    const game = await prisma.circleGame.create({ data: { circleId, gameType, data: gameData, startedBy: request.user.id } });
    return { game };
  });

  app.post('/:gameId/respond', { preHandler: [app.authenticate] }, async (request) => {
    const { response } = request.body;
    const game = await prisma.circleGame.findUnique({
      where: { id: request.params.gameId },
      include: {
        responses: true,
        circle: { include: { members: { where: { isActive: true }, include: { user: { select: { id: true, alias: true } } } } } },
      },
    });
    if (!game || game.status !== 'active') return { error: 'Game not active', done: true };
    const currentRound = game.data.roundNum || 1;
    const totalRounds = game.data.totalRounds || 5;
    const memberCount = game.circle.members.length;
    // Check if user already responded this round
    const existing = game.responses.find(function(r) { return r.userId === request.user.id && r.roundNum === currentRound; });
    if (existing) {
      // Return current state instead of error
      const roundResponses = game.responses.filter(function(r) { return r.roundNum === currentRound; });
      const allIn = roundResponses.length >= memberCount;
      const revealed = roundResponses.map(function(r) {
        const member = game.circle.members.find(function(m) { return m.userId === r.userId; });
        return { alias: member ? member.user.alias : member ? member.alias : 'Unknown', response: r.response, isYou: r.userId === request.user.id };
      });
      return { alreadyResponded: true, responses: allIn ? revealed : null, waiting: allIn ? 0 : memberCount - roundResponses.length, responded: roundResponses.length, total: memberCount };
    }
    // Save response
    await prisma.gameResponse.create({ data: { gameId: game.id, userId: request.user.id, roundNum: currentRound, response: response || {} } });
    // Check how many have responded this round
    const roundResponses = await prisma.gameResponse.findMany({ where: { gameId: game.id, roundNum: currentRound } });
    const allIn = roundResponses.length >= memberCount;
    // Build revealed responses if all are in
    var revealed = null;
    if (allIn) {
      revealed = roundResponses.map(function(r) {
        const member = game.circle.members.find(function(m) { return m.userId === r.userId; });
        return { alias: member ? member.user.alias : member ? member.alias : 'Unknown', response: r.response, isYou: r.userId === request.user.id };
      });
    }
    return {
      submitted: true,
      round: currentRound,
      totalRounds: totalRounds,
      responded: roundResponses.length,
      total: memberCount,
      waiting: allIn ? 0 : memberCount - roundResponses.length,
      allIn: allIn,
      responses: revealed,
    };
  });

  app.post('/:gameId/next-round', { preHandler: [app.authenticate] }, async (request) => {
    const game = await prisma.circleGame.findUnique({ where: { id: request.params.gameId } });
    if (!game || game.status !== 'active') return { error: 'Game not active', done: true };
    const currentRound = game.data.roundNum || 1;
    const totalRounds = game.data.totalRounds || 5;
    if (currentRound >= totalRounds) {
      await prisma.circleGame.update({ where: { id: game.id }, data: { status: 'completed', completedAt: new Date() } });
      return { done: true, message: 'Game complete!' };
    }
    const nextData = generateGame(game.gameType);
    nextData.roundNum = currentRound + 1;
    nextData.totalRounds = totalRounds;
    nextData.memberCount = game.data.memberCount;
    await prisma.circleGame.update({ where: { id: game.id }, data: { data: nextData } });
    return { done: false, round: currentRound + 1, totalRounds: totalRounds, nextQuestion: nextData };
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