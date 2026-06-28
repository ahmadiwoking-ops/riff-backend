const prisma = require('../db');
const { generateGame, generateAllRounds } = require('../services/games');

var BOT_POOL = {
  would_you_rather: function(data) { return { text: data.options[Math.floor(Math.random() * 2)] }; },
  hot_takes: function(data) { return { text: data.options[Math.floor(Math.random() * data.options.length)] }; },
  this_or_that: function(data) { return { text: data.options[Math.floor(Math.random() * 2)] }; },
  two_truths_submit: function() {
    var sets = [
      { truth1: 'I once met a celebrity at a grocery store', truth2: 'I can solve a Rubiks cube in under a minute', lie: 'I have been skydiving three times' },
      { truth1: 'I speak three languages', truth2: 'I broke my arm falling off a trampoline', lie: 'I have never eaten sushi' },
      { truth1: 'I was on TV as a kid', truth2: 'I taught myself to play piano', lie: 'I have climbed Mount Kilimanjaro' },
      { truth1: 'I once won a dance competition', truth2: 'I have a birthmark shaped like a star', lie: 'I have swum with dolphins' },
    ];
    return sets[Math.floor(Math.random() * sets.length)];
  },
  two_truths_guess: function(submissions, botUserId) {
    // Bot randomly guesses one of the 3 statements for each other player
    var guesses = {};
    submissions.forEach(function(s) {
      if (s.userId !== botUserId) {
        guesses[s.userId] = Math.floor(Math.random() * 3);
      }
    });
    return { guesses: guesses };
  },
  desert_island: function() { return { text: ['A knife, tarp, and family photo', 'Guitar, fishing rod, and sunscreen', 'Notebook, lighter, and a hammock'][Math.floor(Math.random() * 3)] }; },
  deeper_questions: function() { return { text: ['The moment I realised I did not have to be perfect.', 'When my best friend showed up at 3am.', 'People mistake my quietness for not caring.'][Math.floor(Math.random() * 3)] }; },
  scenario_challenge: function() { return { text: ['I would be honest even if it hurt.', 'Give them space but check in later.', 'Pull them aside privately.'][Math.floor(Math.random() * 3)] }; },
  memory_lane: function() { return { text: ['My friend drove 4 hours to bring me soup.', 'Got lost in a foreign city - best night ever.', 'When my friend defended me behind my back.'][Math.floor(Math.random() * 3)] }; },
};

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

async function autoRespondBots(gameId, circleId, currentRound, gameType, roundData) {
  try {
    var circle = await prisma.circle.findUnique({ where: { id: circleId }, include: { members: { where: { isActive: true }, include: { user: true } } } });
    if (!circle) return;
    var existing = await prisma.gameResponse.findMany({ where: { gameId: gameId, roundNum: currentRound } });
    var responded = existing.map(function(r) { return r.userId; });
    for (var i = 0; i < circle.members.length; i++) {
      var m = circle.members[i];
      if (m.user.passwordHash === 'bot-no-login' && responded.indexOf(m.userId) === -1) {
        var gen = BOT_POOL[gameType] || function() { return { text: 'Interesting question!' }; };
        await prisma.gameResponse.create({ data: { gameId: gameId, userId: m.userId, roundNum: currentRound, response: gen(roundData || {}) } });
      }
    }
  } catch (err) { console.log('[games] Bot auto-respond error:', err.message); }
}

async function autoRespondBotsGuess(gameId, circleId, currentRound, submissions) {
  try {
    var circle = await prisma.circle.findUnique({ where: { id: circleId }, include: { members: { where: { isActive: true }, include: { user: true } } } });
    if (!circle) return;
    // Use roundNum + 0.5 to differentiate guess responses from submit responses
    var guessRound = currentRound + 0.5;
    var existing = await prisma.gameResponse.findMany({ where: { gameId: gameId, roundNum: guessRound } });
    var responded = existing.map(function(r) { return r.userId; });
    for (var i = 0; i < circle.members.length; i++) {
      var m = circle.members[i];
      if (m.user.passwordHash === 'bot-no-login' && responded.indexOf(m.userId) === -1) {
        var botGuess = BOT_POOL.two_truths_guess(submissions, m.userId);
        await prisma.gameResponse.create({ data: { gameId: gameId, userId: m.userId, roundNum: guessRound, response: botGuess } });
      }
    }
  } catch (err) { console.log('[games] Bot guess error:', err.message); }
}

function analyseOpenResponses(textA, textB) {
  if (!textA || !textB) return 0.5;
  var a = textA.toLowerCase(); var b = textB.toLowerCase();
  var score = 0.4;
  var lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  score += lenRatio * 0.1;
  var positiveWords = ['love', 'happy', 'amazing', 'great', 'beautiful', 'best', 'favourite', 'grateful', 'kind', 'warm', 'laugh', 'smile'];
  var reflectiveWords = ['think', 'believe', 'feel', 'understand', 'realise', 'learn', 'grow', 'change', 'remember', 'wonder', 'hope'];
  var vulnerableWords = ['afraid', 'scared', 'worry', 'struggle', 'hard', 'difficult', 'hurt', 'lost', 'alone', 'miss', 'cry'];
  function countM(text, words) { var c = 0; words.forEach(function(w) { if (text.indexOf(w) !== -1) c++; }); return c; }
  if (countM(a, positiveWords) > 0 && countM(b, positiveWords) > 0) score += 0.1;
  if (countM(a, reflectiveWords) > 0 && countM(b, reflectiveWords) > 0) score += 0.1;
  if (countM(a, vulnerableWords) > 0 && countM(b, vulnerableWords) > 0) score += 0.15;
  var aW = a.split(/\s+/).filter(function(w) { return w.length > 4; });
  var bW = b.split(/\s+/).filter(function(w) { return w.length > 4; });
  var shared = aW.filter(function(w) { return bW.indexOf(w) !== -1; });
  if (shared.length > 0) score += Math.min(shared.length * 0.03, 0.15);
  return Math.min(score, 1.0);
}

function calculateCompatibility(allResponses, members, gameType) {
  var userResponses = {};
  members.forEach(function(m) { userResponses[m.userId] = []; });
  allResponses.forEach(function(r) { if (userResponses[r.userId] && Math.floor(r.roundNum) === r.roundNum) userResponses[r.userId].push(r); });
  var userIds = Object.keys(userResponses);
  var scores = {};
  for (var a = 0; a < userIds.length; a++) {
    for (var b = a + 1; b < userIds.length; b++) {
      var matchPoints = 0; var totalPoints = 0;
      var rA = userResponses[userIds[a]]; var rB = userResponses[userIds[b]];
      for (var k = 0; k < rA.length; k++) {
        var ra = rA[k]; var rb = rB.find(function(x) { return x.roundNum === ra.roundNum; });
        if (!ra || !rb) continue;
        totalPoints++;
        if (gameType === 'would_you_rather' || gameType === 'this_or_that') {
          if (ra.response.text === rb.response.text) matchPoints += 1;
        } else if (gameType === 'hot_takes') {
          if (ra.response.text === rb.response.text) matchPoints += 1;
          else { var aA = (ra.response.text || '').indexOf('agree') !== -1; var bA = (rb.response.text || '').indexOf('agree') !== -1; if (aA === bA) matchPoints += 0.7; }
        } else {
          var tA = ra.response.text || ra.response.truth1 || ''; var tB = rb.response.text || rb.response.truth1 || '';
          matchPoints += analyseOpenResponses(tA, tB);
        }
      }
      var pct = totalPoints > 0 ? Math.round((matchPoints / totalPoints) * 100) : 50;
      pct = Math.min(100, Math.max(10, pct + Math.floor(Math.random() * 11) - 5));
      scores[userIds[a] + ':' + userIds[b]] = { userA: userIds[a], userB: userIds[b], percentage: pct, roundsPlayed: totalPoints };
    }
  }
  return scores;
}

async function gameRoutes(app) {
  app.post('/start', { preHandler: [app.authenticate] }, async (request) => {
    var circleId = request.body.circleId; var gameType = request.body.gameType;
    await prisma.circleGame.updateMany({ where: { circleId: circleId, status: 'active', createdAt: { lt: new Date(Date.now() - 86400000) } }, data: { status: 'expired', completedAt: new Date() } });
    await prisma.circleGame.updateMany({ where: { circleId: circleId, status: 'active' }, data: { status: 'completed', completedAt: new Date() } });
    var circle = await prisma.circle.findUnique({ where: { id: circleId }, include: { members: { where: { isActive: true } } } });
    var totalRounds = 5;
    var allRounds = generateAllRounds(gameType, totalRounds);
    var firstRound = allRounds.length > 0 ? JSON.parse(JSON.stringify(allRounds[0])) : generateGame(gameType);
    firstRound.roundNum = 1; firstRound.totalRounds = totalRounds;
    firstRound.memberCount = circle ? circle.members.length : 4;
    if (gameType === 'two_truths') firstRound.phase = 'submit';
    var game = await prisma.circleGame.create({ data: { circleId: circleId, gameType: gameType, data: firstRound, startedBy: request.user.id, results: { allRounds: allRounds } } });
    return { game: game };
  });

  app.post('/:gameId/respond', { preHandler: [app.authenticate] }, async (request) => {
    try {
      var response = request.body.response;
      var game = await prisma.circleGame.findUnique({
        where: { id: request.params.gameId },
        include: { circle: { include: { members: { where: { isActive: true }, include: { user: { select: { id: true, alias: true, passwordHash: true } } } } } } },
      });
      if (!game || game.status !== 'active') return { error: 'Game not active', done: true };
      var currentRound = game.data.roundNum || 1;
      var totalRounds = game.data.totalRounds || 5;
      var memberCount = game.circle.members.length;

      // ═══ TWO TRUTHS: SUBMIT PHASE ═══
      if (game.gameType === 'two_truths' && game.data.phase === 'submit') {
        var existing = await prisma.gameResponse.findFirst({ where: { gameId: game.id, userId: request.user.id, roundNum: currentRound } });
        if (existing) return { alreadyResponded: true, allIn: false, waiting: 0, phase: 'submit' };
        await prisma.gameResponse.create({ data: { gameId: game.id, userId: request.user.id, roundNum: currentRound, response: response || {} } });
        // Bot auto-submit
        await autoRespondBots(game.id, game.circleId, currentRound, 'two_truths_submit', game.data);
        var allSubmissions = await prisma.gameResponse.findMany({ where: { gameId: game.id, roundNum: currentRound } });
        if (allSubmissions.length >= memberCount) {
          // All submitted — build guess phase data
          var submissions = allSubmissions.map(function(r) {
            var member = game.circle.members.find(function(m) { return m.userId === r.userId; });
            var statements = [r.response.truth1, r.response.truth2, r.response.lie];
            var shuffled = shuffle([0, 1, 2]);
            var lieIndex = shuffled.indexOf(2); // index of the lie in shuffled order
            return {
              userId: r.userId,
              alias: member ? member.user.alias : 'Unknown',
              statements: shuffled.map(function(idx) { return statements[idx]; }),
              lieIndex: lieIndex,
            };
          });
          // Update game to guess phase
          var updatedData = JSON.parse(JSON.stringify(game.data));
          updatedData.phase = 'guess';
          updatedData.submissions = submissions;
          await prisma.circleGame.update({ where: { id: game.id }, data: { data: updatedData } });
          return { submitted: true, phase: 'guess', submissions: submissions.map(function(s) {
            return { userId: s.userId, alias: s.alias, statements: s.statements };
          })};
        }
        return { submitted: true, phase: 'submit', waiting: memberCount - allSubmissions.length };
      }

      // ═══ TWO TRUTHS: GUESS PHASE ═══
      if (game.gameType === 'two_truths' && game.data.phase === 'guess') {
        var guessRound = currentRound + 0.5;
        var existingGuess = await prisma.gameResponse.findFirst({ where: { gameId: game.id, userId: request.user.id, roundNum: guessRound } });
        if (existingGuess) return { alreadyResponded: true, phase: 'guess' };
        await prisma.gameResponse.create({ data: { gameId: game.id, userId: request.user.id, roundNum: guessRound, response: response || {} } });
        // Bot auto-guess
        await autoRespondBotsGuess(game.id, game.circleId, currentRound, game.data.submissions || []);
        var allGuesses = await prisma.gameResponse.findMany({ where: { gameId: game.id, roundNum: guessRound } });
        if (allGuesses.length >= memberCount) {
          // All guessed — reveal results
          var submissions = game.data.submissions || [];
          var results = submissions.map(function(sub) {
            var guessResults = allGuesses.map(function(g) {
              if (g.userId === sub.userId) return null; // skip self
              var member = game.circle.members.find(function(m) { return m.userId === g.userId; });
              var theirGuess = g.response.guesses ? g.response.guesses[sub.userId] : -1;
              var correct = theirGuess === sub.lieIndex;
              return { userId: g.userId, alias: member ? member.user.alias : 'Unknown', guessedIndex: theirGuess, correct: correct, isYou: g.userId === request.user.id };
            }).filter(function(x) { return x !== null; });
            return {
              userId: sub.userId,
              alias: sub.alias,
              statements: sub.statements,
              lieIndex: sub.lieIndex,
              lie: sub.statements[sub.lieIndex],
              guessResults: guessResults,
              isYou: sub.userId === request.user.id,
            };
          });
          return { submitted: true, phase: 'reveal', results: results, round: currentRound, totalRounds: totalRounds };
        }
        return { submitted: true, phase: 'guess', waiting: memberCount - allGuesses.length };
      }

      // ═══ ALL OTHER GAMES ═══
      var existing2 = await prisma.gameResponse.findFirst({ where: { gameId: game.id, userId: request.user.id, roundNum: currentRound } });
      if (existing2) {
        await autoRespondBots(game.id, game.circleId, currentRound, game.gameType, game.data);
        var all = await prisma.gameResponse.findMany({ where: { gameId: game.id, roundNum: currentRound } });
        var allIn = all.length >= memberCount;
        var revealed = allIn ? all.map(function(r) { var m = game.circle.members.find(function(mm) { return mm.userId === r.userId; }); return { alias: m ? m.user.alias : 'Unknown', response: r.response, isYou: r.userId === request.user.id }; }) : null;
        return { alreadyResponded: true, allIn: allIn, responses: revealed, waiting: allIn ? 0 : memberCount - all.length };
      }
      await prisma.gameResponse.create({ data: { gameId: game.id, userId: request.user.id, roundNum: currentRound, response: response || {} } });
      await autoRespondBots(game.id, game.circleId, currentRound, game.gameType, game.data);
      var allAfter = await prisma.gameResponse.findMany({ where: { gameId: game.id, roundNum: currentRound } });
      var isAllIn = allAfter.length >= memberCount;
      var revealedAfter = isAllIn ? allAfter.map(function(r) { var m = game.circle.members.find(function(mm) { return mm.userId === r.userId; }); return { alias: m ? m.user.alias : 'Unknown', response: r.response, isYou: r.userId === request.user.id }; }) : null;
      return { submitted: true, round: currentRound, totalRounds: totalRounds, allIn: isAllIn, responses: revealedAfter, waiting: isAllIn ? 0 : memberCount - allAfter.length };
    } catch (err) { request.log.error(err); return { error: 'Failed to submit response', done: false }; }
  });

  app.post('/:gameId/next-round', { preHandler: [app.authenticate] }, async (request) => {
    try {
      var game = await prisma.circleGame.findUnique({
        where: { id: request.params.gameId },
        include: { responses: true, circle: { include: { members: { where: { isActive: true }, include: { user: { select: { id: true, alias: true } } } } } } },
      });
      if (!game || game.status !== 'active') return { error: 'Game not active', done: true };
      var currentRound = game.data.roundNum || 1;
      var totalRounds = game.data.totalRounds || 5;
      if (currentRound >= totalRounds) {
        var scores = calculateCompatibility(game.responses, game.circle.members, game.gameType);
        var aliasMap = {}; game.circle.members.forEach(function(m) { aliasMap[m.userId] = m.user.alias; });
        var finalResults = { scores: scores, completedRounds: totalRounds, gameType: game.gameType, aliases: aliasMap };
        await prisma.circleGame.update({ where: { id: game.id }, data: { status: 'completed', completedAt: new Date(), results: finalResults } });
        var myScores = []; Object.keys(scores).forEach(function(key) {
          var s = scores[key];
          if (s.userA === request.user.id || s.userB === request.user.id) {
            var otherId = s.userA === request.user.id ? s.userB : s.userA;
            myScores.push({ userId: otherId, alias: aliasMap[otherId] || 'Unknown', percentage: s.percentage, roundsPlayed: s.roundsPlayed });
          }
        });
        return { done: true, message: 'Game complete!', compatibility: myScores };
      }
      var allRounds = (game.results && game.results.allRounds) || [];
      var nextRound = allRounds[currentRound] ? JSON.parse(JSON.stringify(allRounds[currentRound])) : generateGame(game.gameType);
      nextRound.roundNum = currentRound + 1; nextRound.totalRounds = totalRounds;
      nextRound.memberCount = game.data.memberCount || 4;
      if (game.gameType === 'two_truths') nextRound.phase = 'submit';
      await prisma.circleGame.update({ where: { id: game.id }, data: { data: nextRound } });
      return { done: false, round: currentRound + 1, totalRounds: totalRounds, nextQuestion: nextRound };
    } catch (err) { request.log.error(err); return { error: 'Failed to advance round: ' + (err.message || ''), done: false }; }
  });

  app.post('/:gameId/end', { preHandler: [app.authenticate] }, async (request) => {
    var game = await prisma.circleGame.update({ where: { id: request.params.gameId }, data: { status: 'completed', completedAt: new Date() } });
    return { game: game };
  });

  app.get('/:gameId', { preHandler: [app.authenticate] }, async (request) => {
    return { game: await prisma.circleGame.findUnique({ where: { id: request.params.gameId }, include: { responses: true } }) };
  });

  app.get('/history/:circleId', { preHandler: [app.authenticate] }, async (request) => {
    var games = await prisma.circleGame.findMany({
      where: { circleId: request.params.circleId, status: 'completed', results: { not: null } },
      orderBy: { completedAt: 'desc' }, select: { id: true, gameType: true, completedAt: true, results: true },
    });
    var history = games.map(function(g) {
      if (!g.results || !g.results.scores) return null;
      var myScores = []; Object.keys(g.results.scores).forEach(function(key) {
        var s = g.results.scores[key];
        if (s.userA === request.user.id || s.userB === request.user.id) {
          var otherId = s.userA === request.user.id ? s.userB : s.userA;
          myScores.push({ userId: otherId, alias: (g.results.aliases && g.results.aliases[otherId]) || 'Unknown', percentage: s.percentage });
        }
      });
      return { gameId: g.id, gameType: g.gameType, completedAt: g.completedAt, scores: myScores };
    }).filter(function(x) { return x !== null; });
    var totals = {};
    history.forEach(function(h) { h.scores.forEach(function(sc) {
      if (!totals[sc.userId]) totals[sc.userId] = { alias: sc.alias, total: 0, count: 0 };
      totals[sc.userId].total += sc.percentage; totals[sc.userId].count++;
    }); });
    var overall = Object.keys(totals).map(function(uid) {
      return { userId: uid, alias: totals[uid].alias, averageMatch: Math.round(totals[uid].total / totals[uid].count), gamesPlayed: totals[uid].count };
    }).sort(function(a, b) { return b.averageMatch - a.averageMatch; });
    return { history: history, overall: overall };
  });
}
module.exports = gameRoutes;
