const prisma = require('../db');

async function questionRoutes(app) {
  app.get('/pool', { preHandler: [app.authenticate] }, async () => {
    return { questions: QUESTION_POOL };
  });

  app.post('/submit', { preHandler: [app.authenticate] }, async (request) => {
    try {
      var answers = request.body.answers;
      if (!answers || !Array.isArray(answers) || answers.length === 0) return { error: 'No answers provided' };
      var answerMap = {};
      for (var i = 0; i < answers.length; i++) {
        answerMap[answers[i].questionId] = { layer: answers[i].layer, answer: answers[i].answer };
      }
      var zodiacAnswer = answers.find(function(a) { return a.questionId === 'q21'; });
      var zodiacSign = zodiacAnswer ? zodiacAnswer.answer : null;
      if (zodiacSign === "I don't know") zodiacSign = null;
      var topics = answerMap.q6 ? (Array.isArray(answerMap.q6.answer) ? answerMap.q6.answer : [answerMap.q6.answer]) : [];
      await prisma.user.update({
        where: { id: request.user.id },
        data: { matchVector: { answers: answerMap, zodiacSign: zodiacSign, answeredAt: new Date().toISOString(), questionCount: answers.length, filterKeys: { topics: topics } } },
      });
      runMatchingAsync(request.user.id).catch(function(e) { console.log('[matching] Async error:', e.message); });
      return { status: 'saved', answersCount: answers.length };
    } catch (err) { console.log('[questions] Submit error:', err.message); return { error: 'Failed to save: ' + err.message }; }
  });

  app.get('/my-answers', { preHandler: [app.authenticate] }, async (request) => {
    var user = await prisma.user.findUnique({ where: { id: request.user.id }, select: { matchVector: true } });
    return { answers: user && user.matchVector ? user.matchVector.answers || {} : {} };
  });

  app.get('/matches', { preHandler: [app.authenticate] }, async (request) => {
    var user = await prisma.user.findUnique({ where: { id: request.user.id }, select: { matchVector: true } });
    if (!user || !user.matchVector || !user.matchVector.answers) return { matches: [] };
    if (user.matchVector.cachedMatches && user.matchVector.cachedAt) {
      var cacheAge = Date.now() - new Date(user.matchVector.cachedAt).getTime();
      if (cacheAge < 15 * 60 * 1000) return { matches: user.matchVector.cachedMatches, cached: true };
    }
    var matches = await runMatching(request.user.id);
    return { matches: matches };
  });

  app.post('/refresh-matches', { preHandler: [app.authenticate] }, async (request) => {
    var matches = await runMatching(request.user.id);
    return { matches: matches, refreshed: true };
  });

  app.get('/compare/:otherId', { preHandler: [app.authenticate] }, async (request) => {
    try {
      var me = await prisma.user.findUnique({ where: { id: request.user.id }, select: { matchVector: true, connectionType: true } });
      var them = await prisma.user.findUnique({ where: { id: request.params.otherId }, select: { matchVector: true } });
      if (!me || !me.matchVector || !me.matchVector.answers || !them || !them.matchVector || !them.matchVector.answers) return { error: 'Both users must complete questions' };
      var score = calculateMatchScore(toArr(me.matchVector.answers), toArr(them.matchVector.answers), me.connectionType || 'all');
      return { compatibility: score };
    } catch (err) { return { error: err.message }; }
  });
}

async function runMatching(userId) {
  var st = Date.now();
  var me = await prisma.user.findUnique({ where: { id: userId }, select: { matchVector: true, connectionType: true } });
  if (!me || !me.matchVector || !me.matchVector.answers) return [];
  var myAnswers = toArr(me.matchVector.answers);
  var myTopics = me.matchVector.filterKeys ? me.matchVector.filterKeys.topics || [] : [];
  var candidates = await prisma.user.findMany({ where: { id: { not: userId } }, select: { id: true, alias: true, connectionType: true, matchVector: true } });
  var filtered = candidates.filter(function(c) {
    if (!c.matchVector || !c.matchVector.answers) return false;
    if (myTopics.length === 0) return true;
    var tt = c.matchVector.filterKeys ? c.matchVector.filterKeys.topics || [] : [];
    if (tt.length === 0) return true;
    return myTopics.some(function(t) { return tt.indexOf(t) !== -1; });
  });
  console.log('[matching] ' + candidates.length + ' total, ' + filtered.length + ' after filter');
  var scored = [];
  for (var i = 0; i < filtered.length; i++) {
    var o = filtered[i];
    var score = calculateMatchScore(myAnswers, toArr(o.matchVector.answers), me.connectionType || 'all');
    if (score.overall >= 40) scored.push({ userId: o.id, alias: o.alias, score: score.overall, breakdown: score.breakdown });
  }
  scored.sort(function(a, b) { return b.score - a.score; });
  var top = scored.slice(0, 10);
  var mv = JSON.parse(JSON.stringify(me.matchVector));
  mv.cachedMatches = top; mv.cachedAt = new Date().toISOString();
  await prisma.user.update({ where: { id: userId }, data: { matchVector: mv } });
  console.log('[matching] ' + filtered.length + ' scored in ' + (Date.now() - st) + 'ms, ' + top.length + ' matches');
  return top;
}
async function runMatchingAsync(userId) { await runMatching(userId); }
function toArr(m) { return Object.keys(m).map(function(k) { return { questionId: k, answer: m[k].answer || m[k] }; }); }

var ZM = {'Aries-Aries':65,'Aries-Taurus':45,'Aries-Gemini':80,'Aries-Cancer':35,'Aries-Leo':90,'Aries-Virgo':40,'Aries-Libra':75,'Aries-Scorpio':50,'Aries-Sagittarius':95,'Aries-Capricorn':45,'Aries-Aquarius':80,'Aries-Pisces':55,'Taurus-Taurus':70,'Taurus-Gemini':40,'Taurus-Cancer':85,'Taurus-Leo':55,'Taurus-Virgo':90,'Taurus-Libra':50,'Taurus-Scorpio':88,'Taurus-Sagittarius':35,'Taurus-Capricorn':95,'Taurus-Aquarius':40,'Taurus-Pisces':82,'Gemini-Gemini':60,'Gemini-Cancer':45,'Gemini-Leo':75,'Gemini-Virgo':55,'Gemini-Libra':90,'Gemini-Scorpio':35,'Gemini-Sagittarius':80,'Gemini-Capricorn':40,'Gemini-Aquarius':92,'Gemini-Pisces':50,'Cancer-Cancer':70,'Cancer-Leo':45,'Cancer-Virgo':80,'Cancer-Libra':40,'Cancer-Scorpio':95,'Cancer-Sagittarius':30,'Cancer-Capricorn':75,'Cancer-Aquarius':35,'Cancer-Pisces':92,'Leo-Leo':60,'Leo-Virgo':45,'Leo-Libra':78,'Leo-Scorpio':55,'Leo-Sagittarius':90,'Leo-Capricorn':40,'Leo-Aquarius':72,'Leo-Pisces':50,'Virgo-Virgo':65,'Virgo-Libra':50,'Virgo-Scorpio':82,'Virgo-Sagittarius':40,'Virgo-Capricorn':90,'Virgo-Aquarius':42,'Virgo-Pisces':70,'Libra-Libra':60,'Libra-Scorpio':55,'Libra-Sagittarius':78,'Libra-Capricorn':45,'Libra-Aquarius':88,'Libra-Pisces':50,'Scorpio-Scorpio':65,'Scorpio-Sagittarius':45,'Scorpio-Capricorn':82,'Scorpio-Aquarius':40,'Scorpio-Pisces':90,'Sagittarius-Sagittarius':70,'Sagittarius-Capricorn':45,'Sagittarius-Aquarius':85,'Sagittarius-Pisces':50,'Capricorn-Capricorn':65,'Capricorn-Aquarius':50,'Capricorn-Pisces':72,'Aquarius-Aquarius':60,'Aquarius-Pisces':48,'Pisces-Pisces':68};
var WP = {deep:{direct:0.35,mutual:0.30,communication:0.20,zodiac:0.15},circle:{direct:0.40,mutual:0.15,communication:0.30,zodiac:0.15},bot:{direct:0.35,mutual:0.30,communication:0.20,zodiac:0.15},all:{direct:0.35,mutual:0.30,communication:0.20,zodiac:0.15}};

function calculateMatchScore(aA, aB, ct) {
  var w = WP[ct] || WP.all; var mA = {}; var mB = {};
  aA.forEach(function(a) { mA[a.questionId] = a.answer; });
  aB.forEach(function(a) { mB[a.questionId] = a.answer; });
  var dS=0,dT=0;
  ['q1','q2','q3','q5','q7','q10','q11','q12','q13','q15','q16','q17','q18','q20','q22','q23','q24'].forEach(function(q){if(mA[q]&&mB[q]){dT++;if(mA[q]===mB[q])dS+=1;else if(['q16','q17','q18','q20'].indexOf(q)!==-1)dS+=0.3;}});
  ['q6','q19'].forEach(function(q){var a=Array.isArray(mA[q])?mA[q]:typeof mA[q]==='string'?[mA[q]]:[];var b=Array.isArray(mB[q])?mB[q]:typeof mB[q]==='string'?[mB[q]]:[];if(a.length>0&&b.length>0){dT++;var sh=a.filter(function(x){return b.indexOf(x)!==-1});var un=a.concat(b.filter(function(x){return a.indexOf(x)===-1}));dS+=un.length>0?sh.length/un.length:0;}});
  var dP=dT>0?(dS/dT)*100:50;
  var muS=0,muT=0;var aT=(mA.q8||'').toLowerCase(),bL=(mB.q9||'').toLowerCase(),bT=(mB.q8||'').toLowerCase(),aL=(mA.q9||'').toLowerCase();
  if(aT&&bL){muT++;muS+=txS(aT,bL);}if(bT&&aL){muT++;muS+=txS(bT,aL);}
  if(mA.q1&&mB.q1){muT++;var s1=gS(mA.q1),s2=gS(mB.q1);if(Math.abs(s1-s2)===1)muS+=0.9;else if(s1===s2)muS+=0.6;else muS+=0.3;}
  var muP=muT>0?(muS/muT)*100:50;
  var cS=0,cT=0;['q7','q11','q12','q13'].forEach(function(q){if(mA[q]&&mB[q]){cT++;if(q==='q11')cS+=cC(mA[q],mB[q]);else cS+=mA[q]===mB[q]?1:0.3;}});
  var r1=Array.isArray(mA.q14)?mA.q14.slice(0,2):[],r2=Array.isArray(mB.q14)?mB.q14.slice(0,2):[];
  if(r1.length>0&&r2.length>0){cT++;cS+=r1.filter(function(x){return r2.indexOf(x)!==-1}).length>0?0.8:0.2;}
  var cP=cT>0?(cS/cT)*100:50;
  var zA=mA.q21,zB=mB.q21,zP=50;
  if(zA&&zB){var a2=zA.split(' ')[0],b2=zB.split(' ')[0];zP=ZM[a2+'-'+b2]||ZM[b2+'-'+a2]||50;}
  if(mA.q22===mB.q22)zP=Math.min(100,zP+10);if(mA.q24&&mB.q24&&mA.q24!==mB.q24)zP=Math.min(100,zP+5);
  var comp=Math.round(dP*w.direct+muP*w.mutual+cP*w.communication+zP*w.zodiac);
  return{overall:Math.min(100,Math.max(10,comp)),breakdown:{direct:Math.round(dP),mutualBenefit:Math.round(muP),communication:Math.round(cP),zodiac:Math.round(zP)}};
}
function txS(a,b){var wa=a.split(/\s+/).filter(function(w){return w.length>3}),wb=b.split(/\s+/).filter(function(w){return w.length>3});var sh=wa.filter(function(w){return wb.indexOf(w)!==-1});if(sh.length>=3)return 0.9;if(sh.length>=2)return 0.7;if(sh.length>=1)return 0.5;var cs={business:['business','startup','company','entrepreneur','marketing','brand'],tech:['code','software','developer','app','data','ai','tech'],creative:['design','art','music','write','creative'],finance:['finance','money','invest','budget','accounting'],health:['health','fitness','mental','exercise','nutrition'],education:['teach','learn','education','study','research']};var cA=null,cB=null;Object.keys(cs).forEach(function(c){if(cs[c].some(function(w){return a.indexOf(w)!==-1}))cA=c;if(cs[c].some(function(w){return b.indexOf(w)!==-1}))cB=c;});if(cA&&cB&&cA===cB)return 0.6;return 0.3;}
function gS(g){var m={'Finding my direction':0,'Learning something new':1,'Growing my career':2,'Starting a business':3,'Building a community':4};return m[g]!==undefined?m[g]:2;}
function cC(a,b){var c={'Ask lots of questions':['Share something about yourself','Find common ground fast'],'Share something about yourself':['Ask lots of questions','Observe quietly first'],'Observe quietly first':['Make them laugh','Share something about yourself'],'Make them laugh':['Observe quietly first','Ask lots of questions'],'Find common ground fast':['Ask lots of questions','Share something about yourself']};if(a===b)return 0.7;if(c[a]&&c[a].indexOf(b)!==-1)return 0.9;return 0.4;}

var QUESTION_POOL=[{id:'q1',layer:'goals',question:'What are you most focused on right now?',type:'choice',options:['Starting a business','Growing my career','Learning something new','Finding my direction','Building a community']},{id:'q2',layer:'goals',question:'Where do you see yourself in 2 years?',type:'choice',options:['Running my own thing','Leading a team','Mastering a craft','Living differently','Making an impact']},{id:'q3',layer:'goals',question:'What is the biggest thing holding you back?',type:'choice',options:['Confidence','Knowledge gaps','No network','Time management','Fear of failure','Financial constraints']},{id:'q4',layer:'goals',question:'What would you do if you could not fail?',type:'text'},{id:'q5',layer:'goals',question:'Which would change your life most right now?',type:'choice',options:['A mentor who has been there','A partner to build with','Friends who push me forward','Someone to talk things through with']},{id:'q6',layer:'interests',question:'Pick 3 topics',type:'multi',max:3,options:['Business & entrepreneurship','Technology & AI','Psychology & mindset','Health & fitness','Creative arts','Finance & investing','Education & teaching','Social impact','Science & research','Law & policy','Food & culture','Fashion & design']},{id:'q7',layer:'interests',question:'How do you learn?',type:'choice',options:['Reading and research','Watching and listening','Doing and experimenting','Talking it through']},{id:'q8',layer:'interests',question:'What could you teach someone?',type:'text'},{id:'q9',layer:'interests',question:'What do you wish someone would teach you?',type:'text'},{id:'q10',layer:'interests',question:'What content draws you in?',type:'choice',options:['Practical how-to guides','Deep philosophical ideas','Real stories from real people','Data and evidence','Creative inspiration']},{id:'q11',layer:'communication',question:'When you meet someone new...',type:'choice',options:['Ask lots of questions','Share something about yourself','Observe quietly first','Make them laugh','Find common ground fast']},{id:'q12',layer:'communication',question:'In a disagreement...',type:'choice',options:['Say what I think directly','Listen first then respond','Avoid conflict','Find middle ground','Need time to process']},{id:'q13',layer:'communication',question:'What matters most in conversation?',type:'choice',options:['Being heard','Learning something','Genuine connection','Being challenged','Having fun']},{id:'q14',layer:'communication',question:'How do you prefer to communicate?',type:'rank',options:['Voice calls','Video calls','Text messaging','Voice notes','In person']},{id:'q15',layer:'communication',question:'Which word best describes you?',type:'choice',options:['Ambitious','Thoughtful','Creative','Loyal','Curious','Resilient']},{id:'q16',layer:'values',question:'Honesty means...',type:'choice',options:['Always the full truth','Truthful but timed','Protect from pain','Honest on big things']},{id:'q17',layer:'values',question:'How is the world changing?',type:'choice',options:['Optimistic','Cautious','Concerned','Excited']},{id:'q18',layer:'values',question:'AI in daily life?',type:'choice',options:['Embrace fully','Useful with boundaries','Somewhat cautious','Human-first']},{id:'q19',layer:'values',question:'What do you value most?',type:'multi',max:3,options:['Integrity','Ambition','Empathy','Intelligence','Humour','Reliability','Creativity','Courage']},{id:'q20',layer:'values',question:'Success means...',type:'choice',options:['Financial freedom','Making a difference','Mastering something','People I love','My own terms']},{id:'q21',layer:'personality',question:'Your star sign?',type:'choice',options:['Aries ♈','Taurus ♉','Gemini ♊','Cancer ♋','Leo ♌','Virgo ♍','Libra ♎','Scorpio ♏','Sagittarius ♐','Capricorn ♑','Aquarius ♒','Pisces ♓',"I don't know"]},{id:'q22',layer:'personality',question:'When stressed you recharge by...',type:'choice',options:['Being alone','Talking to someone','Physical activity','Creating something','Going somewhere new']},{id:'q23',layer:'personality',question:'At your best people say...',type:'choice',options:['Inspiring','Calming','Energising','Wise','Supportive','Entertaining']},{id:'q24',layer:'personality',question:'Your group energy?',type:'choice',options:['Lead and organise','Support and encourage','Challenge and push','Observe and contribute','Bring fun and lightness']},{id:'q25',layer:'personality',question:'One sentence to remember',type:'text'}];

module.exports = questionRoutes;
