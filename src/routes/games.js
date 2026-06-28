const prisma = require('../db');
const { generateGame } = require('../services/games');

// ═══ BOT AUTO-RESPONSES ═══
var BOT_RESPONSES = {
  would_you_rather: function(data) { return { text: data.options[Math.floor(Math.random() * 2)] }; },
  hot_takes: function(data) { return { text: data.options[Math.floor(Math.random() * data.options.length)] }; },
  this_or_that: function(data) { return { text: data.options[Math.floor(Math.random() * 2)] }; },
  two_truths: function() {
    var sets = [
      { truth1: 'I once met a celebrity at a grocery store', truth2: 'I can solve a Rubiks cube in under a minute', lie: 'I have been skydiving three times' },
      { truth1: 'I speak three languages', truth2: 'I broke my arm falling off a trampoline', lie: 'I have never eaten sushi' },
      { truth1: 'I was on TV as a kid', truth2: 'I can juggle', lie: 'I have climbed Mount Kilimanjaro' },
    ];
    return sets[Math.floor(Math.random() * sets.length)];
  },
  desert_island: function() {
    var a = ['A good knife, a waterproof tarp, and a photo of my family', 'My guitar, a fishing rod, and sunscreen', 'A hammock, survival tips book, and matches'];
    return { text: a[Math.floor(Math.random() * a.length)] };
  },
  deeper_questions: function() {
    var a = ['The moment I realised I did not have to be perfect to be loved.', 'When my best friend showed up at 3am no questions asked.', 'People mistake my quietness for not caring.'];
    return { text: a[Math.floor(Math.random() * a.length)] };
  },
  scenario_challenge: function() {
    var a = ['I would be honest even if it hurt.', 'Give them space but check in after a few days.', 'Pull them aside privately.'];
    return { text: a[Math.floor(Math.random() * a.length)] };
  },
  memory_lane: function() {
    var a = ['My friend drove 4 hours to bring me soup when I was sick.', 'Got lost in a foreign city - turned into the best night ever.', 'When my friend defended me behind my back.'];
    return { text: a[Math.floor(Math.random() * a.length)] };
  },
};

async function autoRespondBots(gameId, circleId, currentRound, gameType, gameData) {
  var circle = await prisma.circle.findUnique({
    where: { id: circleId },
    include: { members: { where: { isActive: true }, include: { user: true } } },
  });
  if (!circle) return;
  var existing = await prisma.gameResponse.findMany({ where: { gameId: gameId, roundNum: currentRound } });
  var responded = existing.map(function(r) { return r.userId; });
  for (var i = 0; i < circle.members.length; i++) {
    var m = circle.members[i];
    if (m.user.passwordHash === 'bot-no-login' && responded.indexOf(m.userId) === -1) {
      var gen = BOT_RESPONSES[gameType] || function() { return { text: 'Interesting question!' }; };
      await prisma.gameResponse.create({ data: { gameId: gameId, userId: m.userId, roundNum: currentRound, response: gen(gameData) } });
    }
  }
}

// ═══ COMPATIBILITY SCORING ═══
function calculateCompatibility(allResponses, members, gameType) {
  var scores = {};
  // Build per-user response map: { roundNum: response }
  var userResponses = {};
  for (var i = 0; i < members.length; i++) { userResponses[members[i].userId] = {}; }
  for (var j = 0; j < allResponses.length; j++) {
    var r = allResponses[j];
    if (!userResponses[r.userId]) userResponses[r.userId] = {};
    userResponses[r.userId][r.roundNum] = r.response;
  }
  var userIds = Object.keys(userResponses);
  // Compare each pair
  for (var a = 0; a < userIds.length; a++) {
    for (var b = a + 1; b < userIds.length; b++) {
      var matches = 0; var total = 0;
      var rounds = Object.keys(userResponses[userIds[a]]);
      for (var k = 0; k < rounds.length; k++) {
        var rn = rounds[k];
        var ra = userResponses[userIds[a]][rn];
        var rb = userResponses[userIds[b]][rn];
        if (!ra || !rb) continue;
        total++;
        if (gameType === 'would_you_rather' || gameType === 'this_or_that') {
          if (ra.text === rb.text) matches++;
        } else if (gameType === 'hot_takes') {
          if (ra.text === rb.text) matches++;
          else if ((ra.text.indexOf('agree') !== -1 && rb.text.indexOf('agree') !== -1) || (ra.text.indexOf('disagree') !== -1 && rb.text.indexOf('disagree') !== -1)) matches += 0.5;
        } else {
          // Open responses: give partial credit for participation
          matches += 0.6;
        }
      }
      var pct = total > 0 ? Math.round((matches / total) * 100) : 50;
      var key = userIds[a] + ':' + userIds[b];
      scores[key] = { userA: userIds[a], userB: userIds[b], percentage: pct, roundsPlayed: total };
    }
  }
  return scores;
}

async function gameRoutes(app) {
  // ═══ START GAME ═══
  app.post('/start', { preHandler: [app.authenticate] }, async (request) => {
    const { circleId, gameType } = request.body;
    await prisma.circleGame.updateMany({ where: { circleId, status: 'active', createdAt: { lt: new Date(Date.now() - 24 * 3600000) } }, data: { status: 'expired', completedAt: new Date() } });
    await prisma.circleGame.updateMany({ where: { circleId, status: 'active' }, data: { status: 'completed', completedAt: new Date() } });
    const circle = await prisma.circle.findUnique({ where: { id: circleId }, include: { members: { where: { isActive: true } } } });
    const gameData = generateGame(gameType);
    gameData.roundNum = 1;
    gameData.totalRounds = 5;
    gameData.memberCount = circle ? circle.members.length : 4;
    const game = await prisma.circleGame.create({ data: { circleId, gameType, data: gameData, startedBy: request.user.id } });
    return { game };
  });

  // ═══ RESPOND TO GAME ═══
  app.post('/:gameId/respond', { preHandler: [app.authenticate] }, async (request) => {
    const { response } = request.body;
    const game = await prisma.circleGame.findUnique({
      where: { id: request.params.gameId },
      include: { circle: { include: { members: { where: { isActive: true }, include: { user: { select: { id: true, alias: true, passwordHash: true } } } } } } },
    });
    if (!game || game.status !== 'active') return { error: 'Game not active', done: true };
    const currentRound = game.data.roundNum || 1;
    const totalRounds = game.data.totalRounds || 5;
    const memberCount = game.circle.members.length;

    // Check duplicate
    const existing = await prisma.gameResponse.findFirst({ where: { gameId: game.id, userId: request.user.id, roundNum: currentRound } });
    if (existing) {
      // Still return current state
      await autoRespondBots(game.id, game.circleId, currentRound, game.gameType, game.data);
      const all = await prisma.gameResponse.findMany({ where: { gameId: game.id, roundNum: currentRound } });
      const allIn = all.length >= memberCount;
      const revealed = allIn ? all.map(function(r) { const m = game.circle.members.find(function(mm) { return mm.userId === r.userId; }); return { alias: m ? m.user.alias : 'Unknown', response: r.response, isYou: r.userId === request.user.id }; }) : null;
      return { alreadyResponded: true, allIn: allIn, responses: revealed, waiting: allIn ? 0 : memberCount - all.length };
    }

    // Save response
    await prisma.gameResponse.create({ data: { gameId: game.id, userId: request.user.id, roundNum: currentRound, response: response || {} } });

    // Bot auto-respond
    await autoRespondBots(game.id, game.circleId, currentRound, game.gameType, game.data);

    // Fetch ALL responses after bots
    const allResponses = await prisma.gameResponse.findMany({ where: { gameId: game.id, roundNum: currentRound } });
    const allIn = allResponses.length >= memberCount;
    var revealed = null;
    if (allIn) {
      revealed = allResponses.map(function(r) { const m = game.circle.members.find(function(mm) { return mm.userId === r.userId; }); return { alias: m ? m.user.alias : 'Unknown', response: r.response, isYou: r.userId === request.user.id }; });
    }
    return { submitted: true, round: currentRound, totalRounds: totalRounds, allIn: allIn, responses: revealed, waiting: allIn ? 0 : memberCount - allResponses.length, gameType: game.gameType };
  });

  // ═══ NEXT ROUND ═══
  app.post('/:gameId/next-round', { preHandler: [app.authenticate] }, async (request) => {
    const game = await prisma.circleGame.findUnique({
      where: { id: request.params.gameId },
      include: { responses: true, circle: { include: { members: { where: { isActive: true }, include: { user: { select: { id: true, alias: true } } } } } } },
    });
    if (!game || game.status !== 'active') return { error: 'Game not active', done: true };
    const currentRound = game.data.roundNum || 1;
    const totalRounds = game.data.totalRounds || 5;

    if (currentRound >= totalRounds) {
      // Calculate compatibility scores
      var scores = calculateCompatibility(game.responses, game.circle.members, game.gameType);
      // Build readable results
      var results = { scores: scores, completedRounds: totalRounds, gameType: game.gameType };
      // Add alias mapping for display
      var aliasMap = {};
      game.circle.members.forEach(function(m) { aliasMap[m.userId] = m.user.alias; });
      results.aliases = aliasMap;

      await prisma.circleGame.update({ where: { id: game.id }, data: { status: 'completed', completedAt: new Date(), results: results } });

      // Build per-user compatibility for the requesting user
      var myScores = [];
      Object.keys(scores).forEach(function(key) {
        var s = scores[key];
        if (s.userA === request.user.id || s.userB === request.user.id) {
          var otherId = s.userA === request.user.id ? s.userB : s.userA;
          myScores.push({ userId: otherId, alias: aliasMap[otherId] || 'Unknown', percentage: s.percentage, roundsPlayed: s.roundsPlayed });
        }
      });

      return { done: true, message: 'Game complete!', compatibility: myScores };
    }

    const nextData = generateGame(game.gameType);
    nextData.roundNum = currentRound + 1;
    nextData.totalRounds = totalRounds;
    nextData.memberCount = game.data.memberCount;
    await prisma.circleGame.update({ where: { id: game.id }, data: { data: nextData } });
    return { done: false, round: currentRound + 1, totalRounds: totalRounds, nextQuestion: nextData };
  });

  // ═══ END GAME ═══
  app.post('/:gameId/end', { preHandler: [app.authenticate] }, async (request) => {
    const game = await prisma.circleGame.update({ where: { id: request.params.gameId }, data: { status: 'completed', completedAt: new Date() } });
    return { game };
  });

  // ═══ GET GAME ═══
  app.get('/:gameId', { preHandler: [app.authenticate] }, async (request) => {
    return { game: await prisma.circleGame.findUnique({ where: { id: request.params.gameId }, include: { responses: true } }) };
  });

  // ═══ MATCH HISTORY ═══
  app.get('/history/:circleId', { preHandler: [app.authenticate] }, async (request) => {
    const games = await prisma.circleGame.findMany({
      where: { circleId: request.params.circleId, status: 'completed', results: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { id: true, gameType: true, completedAt: true, results: true },
    });
    // Extract this user's scores from each game
    var history = games.map(function(g) {
      var results = g.results;
      if (!results || !results.scores) return null;
      var myScores = [];
      Object.keys(results.scores).forEach(function(key) {
        var s = results.scores[key];
        if (s.userA === request.user.id || s.userB === request.user.id) {
          var otherId = s.userA === request.user.id ? s.userB : s.userA;
          myScores.push({ userId: otherId, alias: (results.aliases && results.aliases[otherId]) || 'Unknown', percentage: s.percentage });
        }
      });
      return { gameId: g.id, gameType: g.gameType, completedAt: g.completedAt, scores: myScores };
    }).filter(function(x) { return x !== null; });

    // Calculate overall averages per person
    var totals = {};
    history.forEach(function(h) {
      h.scores.forEach(function(sc) {
        if (!totals[sc.userId]) totals[sc.userId] = { alias: sc.alias, total: 0, count: 0 };
        totals[sc.userId].total += sc.percentage;
        totals[sc.userId].count++;
      });
    });
    var overallScores = Object.keys(totals).map(function(uid) {
      return { userId: uid, alias: totals[uid].alias, averageMatch: Math.round(totals[uid].total / totals[uid].count), gamesPlayed: totals[uid].count };
    }).sort(function(a, b) { return b.averageMatch - a.averageMatch; });

    return { history: history, overall: overallScores };
  });
}
module.exports = gameRoutes;
