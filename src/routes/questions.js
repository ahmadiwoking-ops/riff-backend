const prisma = require('../db');

async function questionRoutes(app) {
  // ═══ GET QUESTION POOL ═══
  app.get('/pool', { preHandler: [app.authenticate] }, async () => {
    return { questions: QUESTION_POOL };
  });

  // ═══ SUBMIT ANSWERS ═══
  app.post('/submit', { preHandler: [app.authenticate] }, async (request) => {
    try {
      var answers = request.body.answers;
      if (!answers || !Array.isArray(answers) || answers.length === 0) {
        return { error: 'No answers provided' };
      }
      // Build answer map
      var answerMap = {};
      for (var i = 0; i < answers.length; i++) {
        answerMap[answers[i].questionId] = { layer: answers[i].layer, answer: answers[i].answer };
      }
      // Derive zodiac
      var zodiacAnswer = answers.find(function(a) { return a.questionId === 'q21'; });
      var zodiacSign = zodiacAnswer ? zodiacAnswer.answer : null;
      if (zodiacSign === "I don't know") zodiacSign = null;
      // Store everything in matchVector
      await prisma.user.update({
        where: { id: request.user.id },
        data: {
          matchVector: {
            answers: answerMap,
            zodiacSign: zodiacSign,
            answeredAt: new Date().toISOString(),
            questionCount: answers.length,
          },
        },
      });
      return { status: 'saved', answersCount: answers.length };
    } catch (err) {
      console.log('[questions] Submit error:', err.message);
      return { error: 'Failed to save answers: ' + err.message };
    }
  });

  // ═══ GET MY ANSWERS ═══
  app.get('/my-answers', { preHandler: [app.authenticate] }, async (request) => {
    try {
      var user = await prisma.user.findUnique({ where: { id: request.user.id }, select: { matchVector: true } });
      var answers = user && user.matchVector && user.matchVector.answers ? user.matchVector.answers : {};
      return { answers: answers };
    } catch (err) { return { answers: {} }; }
  });

  // ═══ GET MATCHES ═══
  app.get('/matches', { preHandler: [app.authenticate] }, async (request) => {
    try {
      var me = await prisma.user.findUnique({ where: { id: request.user.id }, select: { matchVector: true, connectionType: true } });
      if (!me || !me.matchVector || !me.matchVector.answers) return { matches: [] };
      var myAnswers = vectorToArray(me.matchVector.answers);
      // Get all users with answers
      var allUsers = await prisma.user.findMany({
        where: { id: { not: request.user.id } },
        select: { id: true, alias: true, connectionType: true, matchVector: true },
      });
      var scored = [];
      for (var i = 0; i < allUsers.length; i++) {
        var other = allUsers[i];
        if (!other.matchVector || !other.matchVector.answers) continue;
        var otherAnswers = vectorToArray(other.matchVector.answers);
        var score = calculateMatchScore(myAnswers, otherAnswers, me.connectionType || 'all');
        if (score.overall >= 50) {
          scored.push({ userId: other.id, alias: other.alias, score: score.overall, breakdown: score.breakdown });
        }
      }
      scored.sort(function(a, b) { return b.score - a.score; });
      return { matches: scored.slice(0, 10) };
    } catch (err) {
      console.log('[questions] Match error:', err.message);
      return { matches: [] };
    }
  });

  // ═══ COMPARE WITH SPECIFIC USER ═══
  app.get('/compare/:otherId', { preHandler: [app.authenticate] }, async (request) => {
    try {
      var me = await prisma.user.findUnique({ where: { id: request.user.id }, select: { matchVector: true, connectionType: true } });
      var them = await prisma.user.findUnique({ where: { id: request.params.otherId }, select: { matchVector: true } });
      if (!me?.matchVector?.answers || !them?.matchVector?.answers) return { error: 'Both users must complete questions' };
      var score = calculateMatchScore(vectorToArray(me.matchVector.answers), vectorToArray(them.matchVector.answers), me.connectionType || 'all');
      return { compatibility: score };
    } catch (err) { return { error: err.message }; }
  });
}

// Convert answer map to array format for scoring
function vectorToArray(answerMap) {
  return Object.keys(answerMap).map(function(qId) {
    return { questionId: qId, answer: answerMap[qId].answer || answerMap[qId] };
  });
}

// ═══ MATCHING ALGORITHM ═══

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
  return ZODIAC_MATRIX[a+'-'+b] || ZODIAC_MATRIX[b+'-'+a] || 50;
}

var WEIGHT_PROFILES = {
  deep:   { direct: 0.35, mutual: 0.30, communication: 0.20, zodiac: 0.15 },
  circle: { direct: 0.40, mutual: 0.15, communication: 0.30, zodiac: 0.15 },
  bot:    { direct: 0.35, mutual: 0.30, communication: 0.20, zodiac: 0.15 },
  all:    { direct: 0.35, mutual: 0.30, communication: 0.20, zodiac: 0.15 },
};

function calculateMatchScore(answersA, answersB, connectionType) {
  var weights = WEIGHT_PROFILES[connectionType] || WEIGHT_PROFILES.all;
  var mapA = {}; var mapB = {};
  answersA.forEach(function(a) { mapA[a.questionId] = a.answer; });
  answersB.forEach(function(a) { mapB[a.questionId] = a.answer; });

  // LAYER A: DIRECT COMPATIBILITY
  var directScore = 0; var directTotal = 0;
  ['q1','q2','q3','q5','q7','q10','q11','q12','q13','q15','q16','q17','q18','q20','q22','q23','q24'].forEach(function(qId) {
    if (mapA[qId] && mapB[qId]) {
      directTotal++;
      if (mapA[qId] === mapB[qId]) directScore += 1;
      else if (['q16','q17','q18','q20'].indexOf(qId) !== -1) directScore += 0.3;
    }
  });
  ['q6','q19'].forEach(function(qId) {
    var a = Array.isArray(mapA[qId]) ? mapA[qId] : typeof mapA[qId] === 'string' ? [mapA[qId]] : [];
    var b = Array.isArray(mapB[qId]) ? mapB[qId] : typeof mapB[qId] === 'string' ? [mapB[qId]] : [];
    if (a.length > 0 && b.length > 0) {
      directTotal++;
      var shared = a.filter(function(x) { return b.indexOf(x) !== -1; });
      var unique = a.concat(b.filter(function(x) { return a.indexOf(x) === -1; }));
      directScore += unique.length > 0 ? shared.length / unique.length : 0;
    }
  });
  var directPct = directTotal > 0 ? (directScore / directTotal) * 100 : 50;

  // LAYER B: MUTUAL BENEFIT
  var mutualScore = 0; var mutualChecks = 0;
  var aTeach = (mapA['q8'] || '').toLowerCase();
  var bLearn = (mapB['q9'] || '').toLowerCase();
  var bTeach = (mapB['q8'] || '').toLowerCase();
  var aLearn = (mapA['q9'] || '').toLowerCase();
  if (aTeach && bLearn) { mutualChecks++; mutualScore += textSimilarity(aTeach, bLearn); }
  if (bTeach && aLearn) { mutualChecks++; mutualScore += textSimilarity(bTeach, aLearn); }
  if (mapA['q1'] && mapB['q1']) {
    mutualChecks++;
    var sA = goalStage(mapA['q1']); var sB = goalStage(mapB['q1']);
    if (Math.abs(sA - sB) === 1) mutualScore += 0.9;
    else if (sA === sB) mutualScore += 0.6;
    else mutualScore += 0.3;
  }
  var mutualPct = mutualChecks > 0 ? (mutualScore / mutualChecks) * 100 : 50;

  // LAYER C: COMMUNICATION
  var commScore = 0; var commTotal = 0;
  ['q7','q11','q12','q13'].forEach(function(qId) {
    if (mapA[qId] && mapB[qId]) {
      commTotal++;
      if (qId === 'q11') commScore += complementaryComm(mapA[qId], mapB[qId]);
      else commScore += mapA[qId] === mapB[qId] ? 1 : 0.3;
    }
  });
  // Rank comparison for q14
  var rA = Array.isArray(mapA['q14']) ? mapA['q14'].slice(0,2) : [];
  var rB = Array.isArray(mapB['q14']) ? mapB['q14'].slice(0,2) : [];
  if (rA.length > 0 && rB.length > 0) {
    commTotal++;
    var rShared = rA.filter(function(x) { return rB.indexOf(x) !== -1; });
    commScore += rShared.length > 0 ? 0.8 : 0.2;
  }
  var commPct = commTotal > 0 ? (commScore / commTotal) * 100 : 50;

  // LAYER D: ZODIAC
  var zodiacPct = getZodiacScore(mapA['q21'], mapB['q21']);
  if (mapA['q22'] === mapB['q22']) zodiacPct = Math.min(100, zodiacPct + 10);
  if (mapA['q24'] && mapB['q24'] && mapA['q24'] !== mapB['q24']) zodiacPct = Math.min(100, zodiacPct + 5);

  var composite = Math.round(directPct * weights.direct + mutualPct * weights.mutual + commPct * weights.communication + zodiacPct * weights.zodiac);
  composite = Math.min(100, Math.max(10, composite));

  return { overall: composite, breakdown: { direct: Math.round(directPct), mutualBenefit: Math.round(mutualPct), communication: Math.round(commPct), zodiac: Math.round(zodiacPct) } };
}

function textSimilarity(a, b) {
  if (!a || !b) return 0.3;
  var wa = a.split(/\s+/).filter(function(w) { return w.length > 3; });
  var wb = b.split(/\s+/).filter(function(w) { return w.length > 3; });
  var shared = wa.filter(function(w) { return wb.indexOf(w) !== -1; });
  if (shared.length >= 3) return 0.9;
  if (shared.length >= 2) return 0.7;
  if (shared.length >= 1) return 0.5;
  var cats = { business:['business','startup','company','entrepreneur','marketing','sales','brand'], tech:['code','software','developer','programming','app','data','ai','tech'], creative:['design','art','music','write','creative','film','photo'], finance:['finance','money','invest','budget','accounting','trading'], health:['health','fitness','mental','exercise','nutrition','wellness'], education:['teach','learn','education','study','research','knowledge'] };
  var cA = null; var cB = null;
  Object.keys(cats).forEach(function(c) { if (cats[c].some(function(w) { return a.indexOf(w) !== -1; })) cA = c; if (cats[c].some(function(w) { return b.indexOf(w) !== -1; })) cB = c; });
  if (cA && cB && cA === cB) return 0.6;
  return 0.3;
}

function goalStage(g) {
  var m = { 'Finding my direction':0, 'Learning something new':1, 'Growing my career':2, 'Starting a business':3, 'Building a community':4 };
  return m[g] !== undefined ? m[g] : 2;
}

function complementaryComm(a, b) {
  var c = { 'Ask lots of questions':['Share something about yourself','Find common ground fast'], 'Share something about yourself':['Ask lots of questions','Observe quietly first'], 'Observe quietly first':['Make them laugh','Share something about yourself'], 'Make them laugh':['Observe quietly first','Ask lots of questions'], 'Find common ground fast':['Ask lots of questions','Share something about yourself'] };
  if (a === b) return 0.7;
  if (c[a] && c[a].indexOf(b) !== -1) return 0.9;
  return 0.4;
}

var QUESTION_POOL = [
  { id:'q1',layer:'goals',question:'What are you most focused on right now?',type:'choice',options:['Starting a business','Growing my career','Learning something new','Finding my direction','Building a community'] },
  { id:'q2',layer:'goals',question:'Where do you see yourself in 2 years?',type:'choice',options:['Running my own thing','Leading a team','Mastering a craft','Living differently','Making an impact'] },
  { id:'q3',layer:'goals',question:'What is the biggest thing holding you back?',type:'choice',options:['Confidence','Knowledge gaps','No network','Time management','Fear of failure','Financial constraints'] },
  { id:'q4',layer:'goals',question:'What would you do if you could not fail?',type:'text' },
  { id:'q5',layer:'goals',question:'Which would change your life most right now?',type:'choice',options:['A mentor who has been there','A partner to build with','Friends who push me forward','Someone to talk things through with'] },
  { id:'q6',layer:'interests',question:'Pick 3 topics you are most drawn to',type:'multi',max:3,options:['Business & entrepreneurship','Technology & AI','Psychology & mindset','Health & fitness','Creative arts','Finance & investing','Education & teaching','Social impact','Science & research','Law & policy','Food & culture','Fashion & design'] },
  { id:'q7',layer:'interests',question:'How do you prefer to learn?',type:'choice',options:['Reading and research','Watching and listening','Doing and experimenting','Talking it through'] },
  { id:'q8',layer:'interests',question:'What could you teach someone?',type:'text' },
  { id:'q9',layer:'interests',question:'What do you wish someone would teach you?',type:'text' },
  { id:'q10',layer:'interests',question:'What content draws you in?',type:'choice',options:['Practical how-to guides','Deep philosophical ideas','Real stories from real people','Data and evidence','Creative inspiration'] },
  { id:'q11',layer:'communication',question:'When you meet someone new...',type:'choice',options:['Ask lots of questions','Share something about yourself','Observe quietly first','Make them laugh','Find common ground fast'] },
  { id:'q12',layer:'communication',question:'In a disagreement you...',type:'choice',options:['Say what I think directly','Listen first then respond','Avoid conflict if possible','Find middle ground','Need time to process'] },
  { id:'q13',layer:'communication',question:'What matters most in conversation?',type:'choice',options:['Being heard','Learning something','Genuine connection','Being challenged','Having fun'] },
  { id:'q14',layer:'communication',question:'How do you prefer to communicate?',type:'rank',options:['Voice calls','Video calls','Text messaging','Voice notes','In person'] },
  { id:'q15',layer:'communication',question:'Which word best describes you?',type:'choice',options:['Ambitious','Thoughtful','Creative','Loyal','Curious','Resilient'] },
  { id:'q16',layer:'values',question:'Honesty means...',type:'choice',options:['Always the full truth','Truthful but timed','Protect from unnecessary pain','Honest on big things, flexible on small'] },
  { id:'q17',layer:'values',question:'How is the world changing?',type:'choice',options:['Optimistic — tech will solve problems','Cautious — too fast','Concerned — losing important things','Excited — best is ahead'] },
  { id:'q18',layer:'values',question:'AI and technology in daily life?',type:'choice',options:['Embrace fully','Useful with boundaries','Somewhat cautious','Human-first'] },
  { id:'q19',layer:'values',question:'What do you value most in people?',type:'multi',max:3,options:['Integrity','Ambition','Empathy','Intelligence','Humour','Reliability','Creativity','Courage'] },
  { id:'q20',layer:'values',question:'Success means...',type:'choice',options:['Financial freedom','Making a difference','Mastering something','People I love','My own terms'] },
  { id:'q21',layer:'personality',question:'Your star sign?',type:'choice',options:['Aries ♈','Taurus ♉','Gemini ♊','Cancer ♋','Leo ♌','Virgo ♍','Libra ♎','Scorpio ♏','Sagittarius ♐','Capricorn ♑','Aquarius ♒','Pisces ♓',"I don't know"] },
  { id:'q22',layer:'personality',question:'When stressed you recharge by...',type:'choice',options:['Being alone','Talking to someone','Physical activity','Creating something','Going somewhere new'] },
  { id:'q23',layer:'personality',question:'At your best people say you are...',type:'choice',options:['Inspiring','Calming','Energising','Wise','Supportive','Entertaining'] },
  { id:'q24',layer:'personality',question:'Your group energy?',type:'choice',options:['Lead and organise','Support and encourage','Challenge and push','Observe and contribute','Bring fun and lightness'] },
  { id:'q25',layer:'personality',question:'One sentence a stranger would remember',type:'text' },
];

module.exports = questionRoutes;
