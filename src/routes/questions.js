const prisma = require('../db');
const { calculateMatchScore, findMatches, findCircleGroup } = require('../services/matching');

async function questionRoutes(app) {
  // ═══ GET QUESTION POOL ═══
  app.get('/pool', { preHandler: [app.authenticate] }, async () => {
    return { questions: QUESTION_POOL };
  });

  // ═══ SUBMIT ANSWERS ═══
  app.post('/submit', { preHandler: [app.authenticate] }, async (request) => {
    const { answers } = request.body;
    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      return { error: 'No answers provided' };
    }

    // Delete existing answers for this user (re-submission allowed)
    await prisma.questionAnswer.deleteMany({ where: { userId: request.user.id } });

    // Store all answers in user's matchVector as JSON
    var answerMap = {};
    for (const ans of answers) {
      answerMap[ans.questionId] = { layer: ans.layer, answer: ans.answer };
    }

    // Derive zodiac from answers
    var zodiacAnswer = answers.find(function(a) { return a.questionId === 'q21'; });
    var zodiacSign = zodiacAnswer ? zodiacAnswer.answer : null;
    if (zodiacSign === "I don't know") zodiacSign = null;

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

    // Find initial matches
    try {
      var matches = await findMatches(prisma, request.user.id, 5);
      return { status: 'saved', answersCount: answers.length, topMatches: matches };
    } catch (err) {
      console.log('[questions] Match finding error:', err.message);
      return { status: 'saved', answersCount: answers.length, topMatches: [] };
    }
  });

  // ═══ GET MY ANSWERS ═══
  app.get('/my-answers', { preHandler: [app.authenticate] }, async (request) => {
    const answers = await prisma.questionAnswer.findMany({ where: { userId: request.user.id }, orderBy: { questionId: 'asc' } });
    return { answers: answers };
  });

  // ═══ GET MATCHES ═══
  app.get('/matches', { preHandler: [app.authenticate] }, async (request) => {
    try {
      var matches = await findMatches(prisma, request.user.id, 10);
      return { matches: matches };
    } catch (err) {
      console.log('[questions] Match error:', err.message);
      return { matches: [] };
    }
  });

  // ═══ GET CIRCLE GROUP ═══
  app.get('/circle-match', { preHandler: [app.authenticate] }, async (request) => {
    try {
      var group = await findCircleGroup(prisma, request.user.id);
      return { group: group };
    } catch (err) {
      console.log('[questions] Circle match error:', err.message);
      return { group: null };
    }
  });

  // ═══ COMPARE WITH SPECIFIC USER ═══
  app.get('/compare/:otherId', { preHandler: [app.authenticate] }, async (request) => {
    try {
      var myData = await prisma.user.findUnique({ where: { id: request.user.id }, select: { matchVector: true } });
  var myAnswers = myData && myData.matchVector && myData.matchVector.answers ? Object.keys(myData.matchVector.answers).map(function(qId) { return { questionId: qId, answer: myData.matchVector.answers[qId].answer }; }) : [];
  var theirData = await prisma.user.findUnique({ where: { id: request.params.otherId }, select: { matchVector: true } });
  var theirAnswers = theirData && theirData.matchVector && theirData.matchVector.answers ? Object.keys(theirData.matchVector.answers).map(function(qId) { return { questionId: qId, answer: theirData.matchVector.answers[qId].answer }; }) : [];
      var user = await prisma.user.findUnique({ where: { id: request.user.id }, select: { connectionType: true } });
      if (myAnswers.length === 0 || theirAnswers.length === 0) return { error: 'Both users must complete questions' };
      var score = calculateMatchScore(myAnswers, theirAnswers, user.connectionType || 'all');
      return { compatibility: score };
    } catch (err) {
      return { error: err.message };
    }
  });
}

// Question pool (sent to client if needed)
const QUESTION_POOL = [
  { id: 'q1', layer: 'goals', question: 'What are you most focused on right now?', type: 'choice', options: ['Starting a business', 'Growing my career', 'Learning something new', 'Finding my direction', 'Building a community'] },
  { id: 'q2', layer: 'goals', question: 'Where do you see yourself in 2 years?', type: 'choice', options: ['Running my own thing', 'Leading a team', 'Mastering a craft', 'Living differently', 'Making an impact'] },
  { id: 'q3', layer: 'goals', question: 'What is the biggest thing holding you back right now?', type: 'choice', options: ['Confidence', 'Knowledge gaps', 'No network', 'Time management', 'Fear of failure', 'Financial constraints'] },
  { id: 'q4', layer: 'goals', question: 'What would you do if you knew you could not fail?', type: 'text' },
  { id: 'q5', layer: 'goals', question: 'Which of these would change your life most right now?', type: 'choice', options: ['A mentor who has been there', 'A partner to build with', 'Friends who push me forward', 'Someone to talk things through with'] },
  { id: 'q6', layer: 'interests', question: 'Pick the 3 topics you are most drawn to', type: 'multi', max: 3, options: ['Business & entrepreneurship', 'Technology & AI', 'Psychology & mindset', 'Health & fitness', 'Creative arts', 'Finance & investing', 'Education & teaching', 'Social impact', 'Science & research', 'Law & policy', 'Food & culture', 'Fashion & design'] },
  { id: 'q7', layer: 'interests', question: 'How do you prefer to learn new things?', type: 'choice', options: ['Reading and research', 'Watching and listening', 'Doing and experimenting', 'Talking it through with someone'] },
  { id: 'q8', layer: 'interests', question: 'What could you confidently teach someone else?', type: 'text' },
  { id: 'q9', layer: 'interests', question: 'What do you wish someone would teach you?', type: 'text' },
  { id: 'q10', layer: 'interests', question: 'When you consume content, what draws you in?', type: 'choice', options: ['Practical how-to guides', 'Deep philosophical ideas', 'Real stories from real people', 'Data and evidence', 'Creative inspiration'] },
  { id: 'q11', layer: 'communication', question: 'When you meet someone new, you usually...', type: 'choice', options: ['Ask lots of questions', 'Share something about yourself', 'Observe quietly first', 'Make them laugh', 'Find common ground fast'] },
  { id: 'q12', layer: 'communication', question: 'In a disagreement, you tend to...', type: 'choice', options: ['Say what I think directly', 'Listen first then respond carefully', 'Avoid conflict if possible', 'Try to find middle ground', 'Need time to process before responding'] },
  { id: 'q13', layer: 'communication', question: 'What matters most to you in a conversation?', type: 'choice', options: ['Being heard and understood', 'Learning something new', 'Feeling a genuine connection', 'Being challenged to think differently', 'Having fun and being light'] },
  { id: 'q14', layer: 'communication', question: 'How do you prefer to communicate?', type: 'rank', options: ['Voice calls', 'Video calls', 'Text messaging', 'Voice notes', 'In person'] },
  { id: 'q15', layer: 'communication', question: 'Which word best describes you?', type: 'choice', options: ['Ambitious', 'Thoughtful', 'Creative', 'Loyal', 'Curious', 'Resilient'] },
  { id: 'q16', layer: 'values', question: 'Honesty in relationships means...', type: 'choice', options: ['Always telling the full truth even when it hurts', 'Being truthful but choosing your timing', 'Protecting people from things that would only cause pain', 'Being honest about the big things, flexible on the small'] },
  { id: 'q17', layer: 'values', question: 'How do you feel about how the world is changing?', type: 'choice', options: ['Optimistic — technology and progress will solve most problems', 'Cautious — change is good but we are moving too fast', 'Concerned — we are losing important things in the rush forward', 'Excited — the best opportunities are still ahead'] },
  { id: 'q18', layer: 'values', question: 'How do you feel about AI and technology in daily life?', type: 'choice', options: ['I embrace it fully', 'Useful tool but I set boundaries', 'Somewhat cautious', 'I prefer human-first approaches'] },
  { id: 'q19', layer: 'values', question: 'What do you value most in people?', type: 'multi', max: 3, options: ['Integrity', 'Ambition', 'Empathy', 'Intelligence', 'Humour', 'Reliability', 'Creativity', 'Courage'] },
  { id: 'q20', layer: 'values', question: 'Success to me means...', type: 'choice', options: ['Financial freedom', 'Making a difference', 'Mastering something', 'Being surrounded by people I love', 'Living on my own terms'] },
  { id: 'q21', layer: 'personality', question: 'What is your star sign?', type: 'choice', options: ['Aries ♈', 'Taurus ♉', 'Gemini ♊', 'Cancer ♋', 'Leo ♌', 'Virgo ♍', 'Libra ♎', 'Scorpio ♏', 'Sagittarius ♐', 'Capricorn ♑', 'Aquarius ♒', 'Pisces ♓', "I don't know"] },
  { id: 'q22', layer: 'personality', question: 'When you are stressed, you recharge by...', type: 'choice', options: ['Being alone in silence', 'Talking to someone I trust', 'Physical activity', 'Creating something', 'Going somewhere new'] },
  { id: 'q23', layer: 'personality', question: 'At your best, people would describe you as...', type: 'choice', options: ['Inspiring', 'Calming', 'Energising', 'Wise', 'Supportive', 'Entertaining'] },
  { id: 'q24', layer: 'personality', question: 'What energy do you bring to a group?', type: 'choice', options: ['I lead and organise', 'I support and encourage', 'I challenge and push', 'I observe and contribute when it matters', 'I bring fun and lightness'] },
  { id: 'q25', layer: 'personality', question: 'Describe yourself in one sentence a stranger would remember', type: 'text' },
];

module.exports = questionRoutes;
