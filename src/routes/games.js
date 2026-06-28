const prisma = require('../db');
const { generateGame, generateAllRounds } = require('../services/games');

// ═══ BOT AUTO-RESPONSES ═══
var BOT_POOL = {
  would_you_rather: function(data) { return { text: data.options[Math.floor(Math.random() * 2)] }; },
  hot_takes: function(data) { return { text: data.options[Math.floor(Math.random() * data.options.length)] }; },
  this_or_that: function(data) { return { text: data.options[Math.floor(Math.random() * 2)] }; },
  two_truths: function() {
    var sets = [
      { truth1: 'I once met a celebrity at a grocery store', truth2: 'I can solve a Rubiks cube in under a minute', lie: 'I have been skydiving three times' },
      { truth1: 'I speak three languages', truth2: 'I broke my arm falling off a trampoline', lie: 'I have never eaten sushi' },
      { truth1: 'I was on TV as a kid', truth2: 'I taught myself to play piano', lie: 'I have climbed Mount Kilimanjaro' },
      { truth1: 'I once won a dance competition', truth2: 'I have a birthmark shaped like a star', lie: 'I have swum with dolphins' },
    ];
    return sets[Math.floor(Math.random() * sets.length)];
  },
  desert_island: function(data) {
    var responses = {
      'skill': ['I would bring medical knowledge', 'Definitely fire-making', 'Navigation — I can read the stars'],
      'items': ['A good knife, tarp, and family photo', 'Guitar, fishing rod, and sunscreen', 'Notebook, lighter, and a hammock'],
      'default': ['That is such a hard question. I think I would go with something practical but also something to keep spirits up', 'I love this question. Honestly my answer changes every time I think about it', 'My instinct says one thing but my heart says another'],
    };
    var q = (data.question || '').toLowerCase();
    var pool = q.indexOf('skill') !== -1 ? responses.skill : q.indexOf('item') !== -1 || q.indexOf('bring') !== -1 ? responses.items : responses['default'];
    return { text: pool[Math.floor(Math.random() * pool.length)] };
  },
  deeper_questions: function() {
    var a = ['I think the moment I realised I did not have to be perfect to be loved changed everything for me.', 'Honestly when my best friend showed up at 3am no questions asked. That taught me what real friendship looks like.', 'People mistake my quietness for not caring, but I actually feel everything deeply. I just process internally.', 'I think I need people to be patient with me more than anything. I am not always quick to open up but when I do I mean it.'];
    return { text: a[Math.floor(Math.random() * a.length)] };
  },
  scenario_challenge: function() {
    var a = ['I would be honest even if it hurt. I would rather someone know where I stand than wonder.', 'I would give them space but check in after a few days. Not everyone wants to be pushed.', 'Pull them aside privately. Public confrontation helps no one and usually makes things worse.', 'This is tough. I think I would try to understand their perspective first before reacting.'];
    return { text: a[Math.floor(Math.random() * a.length)] };
  },
  memory_lane: function() {
    var a = ['My friend once drove 4 hours just to bring me soup when I was sick. Small thing but I never forgot it.', 'We got lost in a foreign city with no phone signal and it turned into the best night ever. Sometimes the unplanned moments are the best.', 'The time my friend defended me to someone I did not even know was talking behind my back. Found out months later.', 'Just sitting in comfortable silence with someone. Not needing to fill every gap with words. That is when you know.'];
    return { text: a[Math.floor(Math.random() * a.length)] };
  },
};

async function autoRespondBots(gameId, circleId, currentRound, gameType, roundData) {
  var circle = await prisma.circle.findUnique({ where: { id: circleId }, include: { members: { where: { isActive: true }, include: { user: true } } } });
  if (!circle) return;
  var existing = await prisma.gameResponse.findMany({ where: { gameId: gameId, roundNum: currentRound } });
  var responded = existing.map(function(r) { return r.userId; });
  for (var i = 0; i < circle.members.length; i++) {
    var m = circle.members[i];
    if (m.user.passwordHash === 'bot-no-login' && responded.indexOf(m.userId) === -1) {
      var gen = BOT_POOL[gameType] || function() { return { text: 'Interesting question. Let me think...' }; };
      await prisma.gameResponse.create({ data: { gameId: gameId, userId: m.userId, roundNum: currentRound, response: gen(roundData) } });
    }
  }
}

// ═══ AI-POWERED COMPATIBILITY SCORING ═══
async function calculateSmartCompatibility(allResponses, members, gameType) {
  var userResponses = {};
  members.forEach(function(m) { userResponses[m.userId] = []; });
  allResponses.forEach(function(r) {
    if (!userResponses[r.userId]) userResponses[r.userId] = [];
    userResponses[r.userId].push(r);
  });
  var userIds = Object.keys(userResponses);
  var scores = {};

  for (var a = 0; a < userIds.length; a++) {
    for (var b = a + 1; b < userIds.length; b++) {
      var matchPoints = 0; var totalPoints = 0;
      var responsesA = userResponses[userIds[a]];
      var responsesB = userResponses[userIds[b]];

      // Match responses round by round
      for (var k = 0; k < responsesA.length; k++) {
        var ra = responsesA[k];
        var rb = responsesB.find(function(x) { return x.roundNum === ra.roundNum; });
        if (!ra || !rb) continue;
        totalPoints++;
        var respA = ra.response; var respB = rb.response;

        if (gameType === 'would_you_rather' || gameType === 'this_or_that') {
          // Direct choice match
          if (respA.text === respB.text) matchPoints += 1;
        } else if (gameType === 'hot_takes') {
          // Opinion alignment — same answer = full, same direction = partial
          if (respA.text === respB.text) { matchPoints += 1; }
          else {
            var aAgree = (respA.text || '').toLowerCase().indexOf('agree') !== -1 && (respA.text || '').toLowerCase().indexOf('disagree') === -1;
            var bAgree = (respB.text || '').toLowerCase().indexOf('agree') !== -1 && (respB.text || '').toLowerCase().indexOf('disagree') === -1;
            var aDisagree = (respA.text || '').toLowerCase().indexOf('disagree') !== -1;
            var bDisagree = (respB.text || '').toLowerCase().indexOf('disagree') !== -1;
            if ((aAgree && bAgree) || (aDisagree && bDisagree)) matchPoints += 0.7;
          }
        } else {
          // Open-ended: analyse tone, values, perspective alignment
          var textA = respA.text || respA.truth1 || JSON.stringify(respA);
          var textB = respB.text || respB.truth1 || JSON.stringify(respB);
          matchPoints += analyseOpenResponses(textA, textB);
        }
      }

      var pct = totalPoints > 0 ? Math.round((matchPoints / totalPoints) * 100) : 50;
      // Add slight randomness to avoid identical scores (feels more real)
      pct = Math.min(100, Math.max(5, pct + Math.floor(Math.random() * 11) - 5));
      scores[userIds[a] + ':' + userIds[b]] = { userA: userIds[a], userB: userIds[b], percentage: pct, roundsPlayed: totalPoints };
    }
  }

  // Try AI analysis for open-ended games if Kimi is available
  if (['desert_island', 'deeper_questions', 'scenario_challenge', 'memory_lane', 'two_truths'].indexOf(gameType) !== -1) {
    try {
      scores = await aiEnhanceScores(scores, userResponses, members, gameType);
    } catch (err) { console.log('[games] AI scoring failed, using text analysis:', err.message); }
  }

  return scores;
}

// Text-based open response analysis (no AI needed)
function analyseOpenResponses(textA, textB) {
  if (!textA || !textB) return 0.5;
  var a = textA.toLowerCase(); var b = textB.toLowerCase();

  var score = 0.4; // Base participation score

  // Length similarity (people who write similar amounts tend to be similar)
  var lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  score += lenRatio * 0.1;

  // Emotional tone matching
  var positiveWords = ['love', 'happy', 'amazing', 'great', 'beautiful', 'wonderful', 'best', 'favourite', 'grateful', 'lucky', 'blessed', 'kind', 'warm', 'gentle', 'laugh', 'smile', 'joy'];
  var reflectiveWords = ['think', 'believe', 'feel', 'understand', 'realise', 'learn', 'grow', 'change', 'remember', 'wonder', 'hope', 'wish', 'imagine', 'dream'];
  var directWords = ['definitely', 'absolutely', 'always', 'never', 'must', 'should', 'need', 'important', 'honestly', 'clearly', 'obviously'];
  var vulnerableWords = ['afraid', 'scared', 'worry', 'struggle', 'hard', 'difficult', 'hurt', 'pain', 'lost', 'alone', 'miss', 'cry', 'sorry', 'regret'];

  function countMatches(text, words) { var c = 0; words.forEach(function(w) { if (text.indexOf(w) !== -1) c++; }); return c; }

  var aPos = countMatches(a, positiveWords); var bPos = countMatches(b, positiveWords);
  var aRef = countMatches(a, reflectiveWords); var bRef = countMatches(b, reflectiveWords);
  var aDir = countMatches(a, directWords); var bDir = countMatches(b, directWords);
  var aVul = countMatches(a, vulnerableWords); var bVul = countMatches(b, vulnerableWords);

  // Tone alignment: if both are positive, reflective, direct, or vulnerable
  if (aPos > 0 && bPos > 0) score += 0.1;
  if (aRef > 0 && bRef > 0) score += 0.1;
  if (aDir > 0 && bDir > 0) score += 0.05;
  if (aVul > 0 && bVul > 0) score += 0.15; // Vulnerability alignment is strong signal

  // Shared specific words (beyond common ones)
  var aWords = a.split(/\s+/).filter(function(w) { return w.length > 4; });
  var bWords = b.split(/\s+/).filter(function(w) { return w.length > 4; });
  var shared = aWords.filter(function(w) { return bWords.indexOf(w) !== -1; });
  if (shared.length > 0) score += Math.min(shared.length * 0.03, 0.15);

  // Value-based keyword matching
  var valueGroups = [
    ['family', 'home', 'parent', 'child', 'sibling', 'mother', 'father'],
    ['friend', 'friendship', 'loyalty', 'trust', 'honest'],
    ['adventure', 'travel', 'explore', 'discover', 'new'],
    ['creative', 'art', 'music', 'write', 'design', 'create'],
    ['nature', 'outdoor', 'mountain', 'ocean', 'forest', 'beach'],
    ['career', 'work', 'ambition', 'goal', 'success', 'achieve'],
    ['peace', 'calm', 'quiet', 'simple', 'mindful', 'present'],
  ];
  valueGroups.forEach(function(group) {
    var aHas = group.some(function(w) { return a.indexOf(w) !== -1; });
    var bHas = group.some(function(w) { return b.indexOf(w) !== -1; });
    if (aHas && bHas) score += 0.08;
  });

  return Math.min(score, 1.0);
}

// AI-enhanced scoring using Kimi (optional enhancement)
async function aiEnhanceScores(scores, userResponses, members, gameType) {
  try {
    var OpenAI = require('openai');
    var kimiClient = new OpenAI({ apiKey: process.env.KIMI_API_KEY, baseURL: 'https://api.moonshot.ai/v1' });

    var aliasMap = {};
    members.forEach(function(m) { aliasMap[m.userId] = m.user ? m.user.alias : m.alias; });

    // Build summary of all responses for AI analysis
    var summary = 'Game type: ' + gameType + '\n\n';
    Object.keys(userResponses).forEach(function(uid) {
      summary += 'Player ' + (aliasMap[uid] || 'Unknown') + ':\n';
      userResponses[uid].forEach(function(r) {
        var text = r.response.text || r.response.truth1 || JSON.stringify(r.response);
        summary += '  Round ' + r.roundNum + ': ' + text.substring(0, 150) + '\n';
      });
      summary += '\n';
    });

    var prompt = 'Analyse these game responses from a friend group. For each pair of players, rate their compatibility from 0-100 based on:\n' +
      '- Similar values and priorities\n- Matching emotional tone and depth\n- Aligned perspectives and worldview\n- Communication style similarity\n\n' +
      'Respond ONLY with valid JSON, no explanation. Format: {"pairs": [{"a": "Name1", "b": "Name2", "score": 75, "reason": "brief reason"}]}\n\n' + summary;

    var res = await kimiClient.chat.completions.create({
      model: process.env.KIMI_MODEL || 'kimi-k2.6',
      max_tokens: 500,
      temperature: 1,
      messages: [{ role: 'user', content: prompt }],
      extra_body: { thinking: { type: 'disabled' } },
    });

    var content = (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || '';
    content = content.replace(/```json|```/g, '').trim();
    var parsed = JSON.parse(content);

    if (parsed.pairs) {
      // Merge AI scores with text-analysis scores (weighted blend)
      var reverseAlias = {};
      Object.keys(aliasMap).forEach(function(uid) { reverseAlias[aliasMap[uid]] = uid; });

      parsed.pairs.forEach(function(p) {
        var uidA = reverseAlias[p.a]; var uidB = reverseAlias[p.b];
        if (!uidA || !uidB) return;
        var key = scores[uidA + ':' + uidB] ? uidA + ':' + uidB : uidB + ':' + uidA;
        if (scores[key]) {
          // Blend: 40% text analysis + 60% AI
          var blended = Math.round(scores[key].percentage * 0.4 + p.score * 0.6);
          scores[key].percentage = Math.min(100, Math.max(5, blended));
          scores[key].aiReason = p.reason;
        }
      });
      console.log('[games] AI compatibility scoring applied');
    }
  } catch (err) {
    console.log('[games] AI scoring unavailable:', err.message);
  }
  return scores;
}

// ═══ ROUTES ═══
async function gameRoutes(app) {
  // START GAME — pre-generate all rounds
  app.post('/start', { preHandler: [app.authenticate] }, async (request) => {
    const { circleId, gameType } = request.body;
    await prisma.circleGame.updateMany({ where: { circleId, status: 'active', createdAt: { lt: new Date(Date.now() - 24 * 3600000) } }, data: { status: 'expired', completedAt: new Date() } });
    await prisma.circleGame.updateMany({ where: { circleId, status: 'active' }, data: { status: 'completed', completedAt: new Date() } });
    const circle = await prisma.circle.findUnique({ where: { id: circleId }, include: { members: { where: { isActive: true } } } });
    const totalRounds = 5;
    const allRounds = generateAllRounds(gameType, totalRounds);
    const gameData = Object.assign({}, allRounds[0] || {}, {
      roundNum: 1, totalRounds: totalRounds, memberCount: circle ? circle.members.length : 4,
      allRounds: allRounds,
    });
    const game = await prisma.circleGame.create({ data: { circleId, gameType, data: gameData, startedBy: request.user.id } });
    return { game };
  });

  // RESPOND
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

    var existing = await prisma.gameResponse.findFirst({ where: { gameId: game.id, userId: request.user.id, roundNum: currentRound } });
    if (existing) {
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
  });

  // NEXT ROUND — pull from pre-generated rounds
  app.post('/:gameId/next-round', { preHandler: [app.authenticate] }, async (request) => {
  try {
    const game = await prisma.circleGame.findUnique({
      where: { id: request.params.gameId },
      include: { responses: true, circle: { include: { members: { where: { isActive: true }, include: { user: { select: { id: true, alias: true } } } } } } },
    });
    if (!game || game.status !== 'active') return { error: 'Game not active', done: true };
    var currentRound = game.data.roundNum || 1;
    var totalRounds = game.data.totalRounds || 5;

    if (currentRound >= totalRounds) {
      var scores = await calculateSmartCompatibility(game.responses, game.circle.members, game.gameType);
      var aliasMap = {};
      game.circle.members.forEach(function(m) { aliasMap[m.userId] = m.user.alias; });
      var results = { scores: scores, completedRounds: totalRounds, gameType: game.gameType, aliases: aliasMap };
      await prisma.circleGame.update({ where: { id: game.id }, data: { status: 'completed', completedAt: new Date(), results: results } });
      var myScores = [];
      Object.keys(scores).forEach(function(key) {
        var s = scores[key];
        if (s.userA === request.user.id || s.userB === request.user.id) {
          var otherId = s.userA === request.user.id ? s.userB : s.userA;
          myScores.push({ userId: otherId, alias: aliasMap[otherId] || 'Unknown', percentage: s.percentage, roundsPlayed: s.roundsPlayed, reason: s.aiReason || null });
        }
      });
      return { done: true, message: 'Game complete!', compatibility: myScores };
    }

    // Pull next pre-generated round
    var allRounds = game.data.allRounds || [];
    var nextRoundData = allRounds[currentRound] || generateGame(game.gameType);
    nextRoundData.roundNum = currentRound + 1;
    nextRoundData.totalRounds = totalRounds;
    nextRoundData.memberCount = game.data.memberCount;
    nextRoundData.allRounds = allRounds;
    await prisma.circleGame.update({ where: { id: game.id }, data: { data: nextRoundData } });
    return { done: false, round: currentRound + 1, totalRounds: totalRounds, nextQuestion: nextRoundData };
  });

  // END GAME
  app.post('/:gameId/end', { preHandler: [app.authenticate] }, async (request) => {
    return { game: await prisma.circleGame.update({ where: { id: request.params.gameId }, data: { status: 'completed', completedAt: new Date() } }) };
  });
} catch (err) {
      request.log.error(err);
      return { error: 'Failed to advance round: ' + (err.message || 'unknown error'), done: false };
    }

  // GET GAME
  app.get('/:gameId', { preHandler: [app.authenticate] }, async (request) => {
    return { game: await prisma.circleGame.findUnique({ where: { id: request.params.gameId }, include: { responses: true } }) };
  });

  // MATCH HISTORY
  app.get('/history/:circleId', { preHandler: [app.authenticate] }, async (request) => {
    var games = await prisma.circleGame.findMany({
      where: { circleId: request.params.circleId, status: 'completed', results: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { id: true, gameType: true, completedAt: true, results: true },
    });
    var history = games.map(function(g) {
      if (!g.results || !g.results.scores) return null;
      var myScores = [];
      Object.keys(g.results.scores).forEach(function(key) {
        var s = g.results.scores[key];
        if (s.userA === request.user.id || s.userB === request.user.id) {
          var otherId = s.userA === request.user.id ? s.userB : s.userA;
          myScores.push({ userId: otherId, alias: (g.results.aliases && g.results.aliases[otherId]) || 'Unknown', percentage: s.percentage, reason: s.aiReason || null });
        }
      });
      return { gameId: g.id, gameType: g.gameType, completedAt: g.completedAt, scores: myScores };
    }).filter(function(x) { return x !== null; });
    var totals = {};
    history.forEach(function(h) { h.scores.forEach(function(sc) {
      if (!totals[sc.userId]) totals[sc.userId] = { alias: sc.alias, total: 0, count: 0, reasons: [] };
      totals[sc.userId].total += sc.percentage; totals[sc.userId].count++;
      if (sc.reason) totals[sc.userId].reasons.push(sc.reason);
    }); });
    var overall = Object.keys(totals).map(function(uid) {
      return { userId: uid, alias: totals[uid].alias, averageMatch: Math.round(totals[uid].total / totals[uid].count), gamesPlayed: totals[uid].count, topReason: totals[uid].reasons[0] || null };
    }).sort(function(a, b) { return b.averageMatch - a.averageMatch; });
    return { history: history, overall: overall };
  });
}
module.exports = gameRoutes;
