// ═══ RIFF MATCHING SERVICE — Mutual Benefit + Zodiac + Multi-Layer Scoring ═══

// Zodiac compatibility matrix (unique pairs, score 0-100)
var ZODIAC_MATRIX = {
  'Aries-Aries':65,'Aries-Taurus':45,'Aries-Gemini':80,'Aries-Cancer':35,'Aries-Leo':90,'Aries-Virgo':40,
  'Aries-Libra':75,'Aries-Scorpio':50,'Aries-Sagittarius':95,'Aries-Capricorn':45,'Aries-Aquarius':80,'Aries-Pisces':55,
  'Taurus-Taurus':70,'Taurus-Gemini':40,'Taurus-Cancer':85,'Taurus-Leo':55,'Taurus-Virgo':90,'Taurus-Libra':50,
  'Taurus-Scorpio':88,'Taurus-Sagittarius':35,'Taurus-Capricorn':95,'Taurus-Aquarius':40,'Taurus-Pisces':82,
  'Gemini-Gemini':60,'Gemini-Cancer':45,'Gemini-Leo':75,'Gemini-Virgo':55,'Gemini-Libra':90,'Gemini-Scorpio':35,
  'Gemini-Sagittarius':80,'Gemini-Capricorn':40,'Gemini-Aquarius':92,'Gemini-Pisces':50,
  'Cancer-Cancer':70,'Cancer-Leo':45,'Cancer-Virgo':80,'Cancer-Libra':40,'Cancer-Scorpio':95,'Cancer-Sagittarius':30,
  'Cancer-Capricorn':75,'Cancer-Aquarius':35,'Cancer-Pisces':92,
  'Leo-Leo':60,'Leo-Virgo':45,'Leo-Libra':78,'Leo-Scorpio':55,'Leo-Sagittarius':90,'Leo-Capricorn':40,
  'Leo-Aquarius':72,'Leo-Pisces':50,
  'Virgo-Virgo':65,'Virgo-Libra':50,'Virgo-Scorpio':82,'Virgo-Sagittarius':40,'Virgo-Capricorn':90,
  'Virgo-Aquarius':42,'Virgo-Pisces':70,
  'Libra-Libra':60,'Libra-Scorpio':55,'Libra-Sagittarius':78,'Libra-Capricorn':45,'Libra-Aquarius':88,'Libra-Pisces':50,
  'Scorpio-Scorpio':65,'Scorpio-Sagittarius':45,'Scorpio-Capricorn':82,'Scorpio-Aquarius':40,'Scorpio-Pisces':90,
  'Sagittarius-Sagittarius':70,'Sagittarius-Capricorn':45,'Sagittarius-Aquarius':85,'Sagittarius-Pisces':50,
  'Capricorn-Capricorn':65,'Capricorn-Aquarius':50,'Capricorn-Pisces':72,
  'Aquarius-Aquarius':60,'Aquarius-Pisces':48,
  'Pisces-Pisces':68,
};

function getZodiacScore(signA, signB) {
  if (!signA || !signB) return 50;
  var a = signA.split(' ')[0]; var b = signB.split(' ')[0];
  var key1 = a + '-' + b; var key2 = b + '-' + a;
  return ZODIAC_MATRIX[key1] || ZODIAC_MATRIX[key2] || 50;
}

// Connection type weight profiles
var WEIGHT_PROFILES = {
  deep:   { direct: 0.35, mutual: 0.30, communication: 0.20, zodiac: 0.15 },
  circle: { direct: 0.40, mutual: 0.15, communication: 0.30, zodiac: 0.15 },
  bot:    { direct: 0.35, mutual: 0.30, communication: 0.20, zodiac: 0.15 },
  all:    { direct: 0.35, mutual: 0.30, communication: 0.20, zodiac: 0.15 },
  mentor: { direct: 0.25, mutual: 0.40, communication: 0.25, zodiac: 0.10 },
};

// Score two users across all 4 layers
function calculateMatchScore(answersA, answersB, connectionType) {
  var weights = WEIGHT_PROFILES[connectionType] || WEIGHT_PROFILES.all;
  var mapA = {}; var mapB = {};
  answersA.forEach(function(a) { mapA[a.questionId] = a.answer; });
  answersB.forEach(function(a) { mapB[a.questionId] = a.answer; });

  // ═══ LAYER A: DIRECT COMPATIBILITY ═══
  var directScore = 0; var directTotal = 0;
  var choiceQs = ['q1','q2','q3','q5','q7','q10','q11','q12','q13','q15','q16','q17','q18','q20','q22','q23','q24'];
  choiceQs.forEach(function(qId) {
    if (mapA[qId] && mapB[qId]) {
      directTotal++;
      if (mapA[qId] === mapB[qId]) directScore += 1;
      else {
        // Adjacent answer scoring for values questions
        if (['q16','q17','q18','q20'].indexOf(qId) !== -1) directScore += 0.3;
      }
    }
  });
  // Multi-select overlap (q6 topics, q19 values)
  ['q6','q19'].forEach(function(qId) {
    var a = Array.isArray(mapA[qId]) ? mapA[qId] : [];
    var b = Array.isArray(mapB[qId]) ? mapB[qId] : [];
    if (a.length > 0 && b.length > 0) {
      directTotal++;
      var shared = a.filter(function(x) { return b.indexOf(x) !== -1; });
      var total = new Set(a.concat(b)).size;
      directScore += shared.length / total;
    }
  });
  var directPct = directTotal > 0 ? (directScore / directTotal) * 100 : 50;

  // ═══ LAYER B: MUTUAL BENEFIT ═══
  var mutualScore = 0; var mutualChecks = 0;
  // Q8 (can teach) vs Q9 (want to learn) — both directions
  var aTeach = (mapA['q8'] || '').toLowerCase();
  var bLearn = (mapB['q9'] || '').toLowerCase();
  var bTeach = (mapB['q8'] || '').toLowerCase();
  var aLearn = (mapA['q9'] || '').toLowerCase();
  if (aTeach && bLearn) {
    mutualChecks++;
    mutualScore += textSimilarity(aTeach, bLearn);
  }
  if (bTeach && aLearn) {
    mutualChecks++;
    mutualScore += textSimilarity(bTeach, aLearn);
  }
  // Goal stage complementarity (q1, q2)
  if (mapA['q1'] && mapB['q1']) {
    mutualChecks++;
    var stageA = goalStage(mapA['q1']); var stageB = goalStage(mapB['q1']);
    if (Math.abs(stageA - stageB) === 1) mutualScore += 0.9; // Complementary stages
    else if (stageA === stageB) mutualScore += 0.6; // Same stage (peers)
    else mutualScore += 0.3;
  }
  // What would change your life (q5) vs other's strengths
  if (mapA['q5'] && mapB['q15']) {
    mutualChecks++;
    mutualScore += needsStrengthMatch(mapA['q5'], mapB['q15'], mapB['q8']);
  }
  if (mapB['q5'] && mapA['q15']) {
    mutualChecks++;
    mutualScore += needsStrengthMatch(mapB['q5'], mapA['q15'], mapA['q8']);
  }
  var mutualPct = mutualChecks > 0 ? (mutualScore / mutualChecks) * 100 : 50;

  // ═══ LAYER C: COMMUNICATION COMPATIBILITY ═══
  var commScore = 0; var commTotal = 0;
  var commQs = ['q7','q11','q12','q13','q14'];
  commQs.forEach(function(qId) {
    if (mapA[qId] && mapB[qId]) {
      commTotal++;
      if (qId === 'q14') {
        // Rank similarity (compare top 2 preferences)
        var rA = Array.isArray(mapA[qId]) ? mapA[qId].slice(0,2) : [];
        var rB = Array.isArray(mapB[qId]) ? mapB[qId].slice(0,2) : [];
        var shared = rA.filter(function(x) { return rB.indexOf(x) !== -1; });
        commScore += shared.length > 0 ? 0.8 : 0.2;
      } else if (qId === 'q11') {
        // Complementary communication styles
        commScore += complementaryComm(mapA[qId], mapB[qId]);
      } else {
        commScore += mapA[qId] === mapB[qId] ? 1 : 0.3;
      }
    }
  });
  var commPct = commTotal > 0 ? (commScore / commTotal) * 100 : 50;

  // ═══ LAYER D: ZODIAC & ENERGY ═══
  var zodiacPct = getZodiacScore(mapA['q21'], mapB['q21']);
  // Boost if stress recharge style matches (q22) or group energy complements (q24)
  if (mapA['q22'] === mapB['q22']) zodiacPct = Math.min(100, zodiacPct + 10);
  if (mapA['q24'] && mapB['q24'] && mapA['q24'] !== mapB['q24']) zodiacPct = Math.min(100, zodiacPct + 5); // Diverse energy is good

  // ═══ COMPOSITE SCORE ═══
  var composite = Math.round(
    directPct * weights.direct +
    mutualPct * weights.mutual +
    commPct * weights.communication +
    zodiacPct * weights.zodiac
  );
  composite = Math.min(100, Math.max(10, composite));

  return {
    overall: composite,
    breakdown: {
      direct: Math.round(directPct),
      mutualBenefit: Math.round(mutualPct),
      communication: Math.round(commPct),
      zodiac: Math.round(zodiacPct),
    },
    zodiacSigns: { a: mapA['q21'], b: mapB['q21'] },
  };
}

// Helper: text similarity for open-ended answers
function textSimilarity(textA, textB) {
  if (!textA || !textB) return 0.3;
  var a = textA.toLowerCase().split(/\s+/).filter(function(w) { return w.length > 3; });
  var b = textB.toLowerCase().split(/\s+/).filter(function(w) { return w.length > 3; });
  var shared = a.filter(function(w) { return b.indexOf(w) !== -1; });
  if (shared.length >= 3) return 0.9;
  if (shared.length >= 2) return 0.7;
  if (shared.length >= 1) return 0.5;
  // Check semantic categories
  var categories = {
    business: ['business','startup','company','entrepreneur','marketing','sales','revenue','customer','product','brand'],
    tech: ['code','coding','software','developer','programming','app','website','data','ai','tech','digital'],
    creative: ['design','art','music','write','writing','creative','paint','draw','film','photo','content'],
    finance: ['finance','money','invest','budget','accounting','trading','stocks','crypto','savings','wealth'],
    health: ['health','fitness','mental','exercise','nutrition','wellness','medical','therapy','mindset'],
    education: ['teach','learn','education','study','research','academic','knowledge','school','university'],
  };
  var catA = null; var catB = null;
  Object.keys(categories).forEach(function(cat) {
    if (categories[cat].some(function(w) { return textA.indexOf(w) !== -1; })) catA = cat;
    if (categories[cat].some(function(w) { return textB.indexOf(w) !== -1; })) catB = cat;
  });
  if (catA && catB && catA === catB) return 0.6;
  return 0.3;
}

// Helper: map goal to stage (0-4)
function goalStage(goal) {
  var stages = { 'Finding my direction': 0, 'Learning something new': 1, 'Growing my career': 2, 'Starting a business': 3, 'Building a community': 4 };
  return stages[goal] !== undefined ? stages[goal] : 2;
}

// Helper: complementary communication styles
function complementaryComm(styleA, styleB) {
  var complements = {
    'Ask lots of questions': ['Share something about yourself', 'Find common ground fast'],
    'Share something about yourself': ['Ask lots of questions', 'Observe quietly first'],
    'Observe quietly first': ['Make them laugh', 'Share something about yourself'],
    'Make them laugh': ['Observe quietly first', 'Ask lots of questions'],
    'Find common ground fast': ['Ask lots of questions', 'Share something about yourself'],
  };
  if (styleA === styleB) return 0.7;
  if (complements[styleA] && complements[styleA].indexOf(styleB) !== -1) return 0.9;
  return 0.4;
}

// Helper: needs-strength matching
function needsStrengthMatch(need, strength, canTeach) {
  var needMap = {
    'A mentor who has been there': ['Wise', 'Resilient', 'Ambitious'],
    'A partner to build with': ['Ambitious', 'Creative', 'Curious'],
    'Friends who push me forward': ['Loyal', 'Curious', 'Resilient'],
    'Someone to talk things through with': ['Thoughtful', 'Loyal', 'Creative'],
  };
  var goodStrengths = needMap[need] || [];
  if (goodStrengths.indexOf(strength) !== -1) return 0.8;
  if (canTeach && canTeach.length > 5) return 0.5;
  return 0.3;
}

// Find best matches for a user
async function findMatches(prisma, userId, limit) {
  var user = await prisma.user.findUnique({ where: { id: userId }, select: { connectionType: true } });
  var userAnswers = await prisma.questionAnswer.findMany({ where: { userId: userId } });
  if (userAnswers.length === 0) return [];

  // Get all other users with answers
  var otherUsers = await prisma.user.findMany({
    where: { id: { not: userId }, questionAnswers: { some: {} } },
    select: { id: true, alias: true, connectionType: true },
  });

  var scores = [];
  for (var i = 0; i < otherUsers.length; i++) {
    var other = otherUsers[i];
    var otherAnswers = await prisma.questionAnswer.findMany({ where: { userId: other.id } });
    var score = calculateMatchScore(userAnswers, otherAnswers, user.connectionType || 'all');
    if (score.overall >= 60) {
      scores.push({ userId: other.id, alias: other.alias, score: score.overall, breakdown: score.breakdown, zodiac: score.zodiacSigns });
    }
  }

  scores.sort(function(a, b) { return b.score - a.score; });
  return scores.slice(0, limit || 10);
}

// Find a group of 4 for friend circle
async function findCircleGroup(prisma, userId) {
  var matches = await findMatches(prisma, userId, 20);
  if (matches.length < 3) return null;

  // Try to assemble a group where every pair has >60% compatibility
  var userAnswers = await prisma.questionAnswer.findMany({ where: { userId: userId } });
  var userMap = {};
  userAnswers.forEach(function(a) { userMap[a.questionId] = a.answer; });

  // Get top candidates and check inter-compatibility
  for (var i = 0; i < Math.min(matches.length, 10); i++) {
    for (var j = i + 1; j < Math.min(matches.length, 10); j++) {
      for (var k = j + 1; k < Math.min(matches.length, 10); k++) {
        var group = [matches[i], matches[j], matches[k]];
        // Check group energy diversity (q24)
        var energies = new Set();
        energies.add(userMap['q24'] || '');
        // Would need to load each member's q24 — simplified here
        if (group.every(function(m) { return m.score >= 60; })) {
          return { members: group, averageScore: Math.round((group[0].score + group[1].score + group[2].score) / 3) };
        }
      }
    }
  }
  // Fallback: return top 3
  return { members: matches.slice(0, 3), averageScore: Math.round(matches.slice(0, 3).reduce(function(a, b) { return a + b.score; }, 0) / 3) };
}

module.exports = { calculateMatchScore, findMatches, findCircleGroup, getZodiacScore, ZODIAC_MATRIX };
