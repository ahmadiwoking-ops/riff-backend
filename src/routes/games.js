const prisma = require('../db');
const { generateGame } = require('../services/games');

// Bot auto-response helpers
var BOT_RESPONSES = {
  would_you_rather: function(data) { return { text: data.options[Math.floor(Math.random() * 2)] }; },
  hot_takes: function(data) { return { text: data.options[Math.floor(Math.random() * data.options.length)] }; },
  this_or_that: function(data) { return { text: data.options[Math.floor(Math.random() * 2)] }; },
  two_truths: function() {
    var sets = [
      { truth1: 'I once met a celebrity at a grocery store', truth2: 'I can solve a Rubik\'s cube in under a minute', lie: 'I have been skydiving three times' },
      { truth1: 'I speak three languages', truth2: 'I broke my arm falling off a trampoline', lie: 'I have never eaten sushi' },
      { truth1: 'I was on TV as a kid', truth2: 'I can juggle', lie: 'I have climbed Mount Kilimanjaro' },
    ];
    return sets[Math.floor(Math.random() * sets.length)];
  },
  desert_island: function() {
    var answers = ['A good knife, a waterproof tarp, and a photo of my family', 'My guitar, a fishing rod, and sunscreen', 'A hammock, a book of survival tips, and matches'];
    return { text: answers[Math.floor(Math.random() * answers.length)] };
  },
  deeper_questions: function() {
    var answers = ['Honestly, I think the moment I realised I did not have to be perfect to be loved.', 'When my best friend showed up at 3am when I called crying. No questions asked.', 'I think people misunderstand my quietness for not caring, when actually I feel everything deeply.'];
    return { text: answers[Math.floor(Math.random() * answers.length)] };
  },
  scenario_challenge: function() {
    var answers = ['I would be honest even if it hurt. I would rather someone know where I stand.', 'I would give them space but check in after a few days. Everyone processes differently.', 'I would pull them aside privately. Public confrontation helps no one.'];
    return { text: answers[Math.floor(Math.random() * answers.length)] };
  },
  memory_lane: function() {
    var answers = ['My friend once drove 4 hours just to bring me soup when I was sick. Never forgot that.', 'We got lost in a foreign city with no phone signal and it turned into the best night ever.', 'The time my friend defended me to someone I did not even know was talking about me behind my back.'];
    return { text: answers[Math.floor(Math.random() * answers.length)] };
  },
};

async function autoRespondBots(game, currentRound) {
  var circle = await prisma.circle.findUnique({
    where: { id: game.circleId },
    include: { members: { where: { isActive: true }, include: { user: true } } },
  });
  if (!circle) return;

  var existingResponses = await prisma.gameResponse.findMany({
    where: { gameId: game.id, roundNum: currentRound },
  });
  var respondedUserIds = existingResponses.map(function(r) { return r.userId; });

  for (var i = 0; i < circle.members.length; i++) {
    var member = circle.members[i];
    // Bot users have passwordHash === 'bot-no-login'
    if (member.user.passwordHash === 'bot-no-login' && respondedUserIds.indexOf(member.userId) === -1) {
      var generator = BOT_RESPONSES[game.gameType] || function() { return { text: 'Interesting question! Let me think...' }; };
      var botResponse = generator(game.data);
      await prisma.gameResponse.create({
        data: { gameId: game.id, userId: member.userId, roundNum: currentRound, response: botResponse },
      });
    }
  }
}

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
        circle: { include: { members: { where: { isActive: true }, include: { user: { select: { id: true, alias: true, passwordHash: true } } } } } },
      },
    });
    if (!game || game.status !== 'active') return { error: 'Game not active', done: true };
    const currentRound = game.data.roundNum || 1;
    const totalRounds = game.data.totalRounds || 5;
    const memberCount = game.circle.members.length;

    // Check if user already responded this round
    const existing = game.responses.find(function(r) { return r.userId === request.user.id && r.roundNum === currentRound; });
    if (existing) {
      const roundResponses = game.responses.filter(function(r) { return r.roundNum === currentRound; });
      const allIn = roundResponses.length >= memberCount;
      const revealed = allIn ? roundResponses.map(function(r) {
        const member = game.circle.members.find(function(m) { return m.userId === r.userId; });
        return { alias: member ? member.user.alias : 'Unknown', response: r.response, isYou: r.userId === request.user.id };
      }) : null;
      return { alreadyResponded: true, responses: revealed, waiting: allIn ? 0 : memberCount - roundResponses.length, responded: roundResponses.length, total: memberCount };
    }

    // Save response
    await prisma.gameResponse.create({ data: { gameId: game.id, userId: request.user.id, roundNum: currentRound, response: response || {} } });

    // Auto-respond for bot members
    await autoRespondBots(game, currentRound);

    // Re-fetch responses after bot auto-responses
    const allResponses = await prisma.gameResponse.findMany({ where: { gameId: game.id, roundNum: currentRound } });
    const allIn = allResponses.length >= memberCount;

    var revealed = null;
    if (allIn) {
      revealed = allResponses.map(function(r) {
        const member = game.circle.members.find(function(m) { return m.userId === r.userId; });
        return { alias: member ? member.user.alias : 'Unknown', response: r.response, isYou: r.userId === request.user.id };
      });
    }

    return {
      submitted: true,
      round: currentRound,
      totalRounds: totalRounds,
      responded: allResponses.length,
      total: memberCount,
      waiting: allIn ? 0 : memberCount - allResponses.length,
      allIn: allIn,
      responses: revealed,
      gameType: game.gameType,
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
