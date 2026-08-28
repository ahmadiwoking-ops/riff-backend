const prisma = require('../db');
const OpenAI = require('openai').default || require('openai');

const kimi = process.env.MOONSHOT_API_KEY
  ? new OpenAI({ apiKey: process.env.MOONSHOT_API_KEY, baseURL: 'https://api.moonshot.ai/v1' })
  : null;
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k2.6';

// Eight forks. Each is a genuine decision point, which is what makes the
// branching coherent rather than arbitrary biography.
const PROMPTS = [
  { id: 'p1', q: 'Where did you grow up — and did you stay or leave?', hint: 'The place that shaped you, and what you did about it.' },
  { id: 'p2', q: 'What did you study or train in? Was there something you nearly did instead?', hint: 'The path you picked, and the one you almost picked.' },
  { id: 'p3', q: 'The job or opportunity that changed your direction.', hint: 'The one that set the course you are on now.' },
  { id: 'p4', q: 'Something you turned down, or walked away from.', hint: 'A job, a place, an offer, a plan.' },
  { id: 'p5', q: 'A move that reshaped things — a city, a country, a home.', hint: 'Where you went, and why.' },
  { id: 'p6', q: 'A relationship or friendship that changed your course.', hint: 'Someone who redirected you, for better or worse.' },
  { id: 'p7', q: 'A risk you took — or one you did not.', hint: 'The leap, or the leap you talked yourself out of.' },
  { id: 'p8', q: 'Something that happened to you that you did not choose.', hint: 'Luck, timing, loss, an accident of circumstance.' },
];

// Visual treatment is illustrative rather than generated imagery: each branch
// carries a mood + era + motif the client renders as gradients and iconography.
const MOODS = ['ember', 'tide', 'neon', 'dust', 'frost', 'bloom'];

// kimi-k2.6 narrates in prose even when told to return JSON, and long
// structured requests truncate before the object is ever written. So we ask
// for ONE branch at a time in a simple Key: value shape and parse that.
function parseBranch(text) {
  if (!text) return null;
  var j = safeJson(text);
  if (j && j.title) return j;
  var out = {};
  var keys = ['title','divergence','year','today','work','place','texture','cost','mood'];
  String(text).split(/\r?\n/).forEach(function (line) {
    var m = line.match(/^\s*[-*]?\s*([A-Za-z ]+)\s*:\s*(.+)$/);
    if (!m) return;
    var k = m[1].trim().toLowerCase().replace(/\s+/g, '');
    if (keys.indexOf(k) !== -1 && !out[k]) out[k] = m[2].trim().replace(/\.$/, '');
  });
  return out.title && out.today ? out : null;
}

function safeJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  // Models often wrap JSON in fences or prose; take the outermost object.
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { return null; }
}

async function askKimi(system, user, maxTokens) {
  if (!kimi) throw new Error('No MOONSHOT_API_KEY configured');
  const res = await kimi.chat.completions.create({
    model: KIMI_MODEL,
    temperature: 1, // Kimi requires 1
    max_tokens: Math.min(maxTokens || 2048, 2048),
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    // Without this, kimi-k2.6 puts its reasoning in reasoning_content and
    // leaves content EMPTY. See kimi-bot.js — same requirement there.
    extra_body: { thinking: { type: 'disabled' } },
  });
  var msg = res.choices && res.choices[0] ? res.choices[0].message : null;
  if (!msg) return null;
  var out = msg.content && msg.content.trim();
  // kimi-k2.6 often leaves content empty and puts everything in
  // reasoning_content — narration first, then the JSON. safeJson() below
  // extracts the outermost {...}, so handing it the whole thing works.
  if (!out && msg.reasoning_content) out = msg.reasoning_content.trim();
  return out || null;
}

const BRANCH_SYSTEM = [
  'You generate "parallel lives" — plausible alternative present-day lives for a real person,',
  'each stemming from one of their real decisions having gone differently. Think superposition:',
  'the same person, the same starting material, a different branch taken.',
  '',
  'Rules:',
  '- Each branch diverges from ONE specific decision the person described. Name that divergence.',
  '- Describe where that branch leads to TODAY: work, place, daily texture, who they became.',
  '- Be specific and vivid. Real street-level detail beats grand abstraction.',
  '- Alternative relationships and family are fair game — a different branch means different people.',
  '- BUT never make adverse predictions about a real named person from their actual life',
  '  (no "you and Sarah would have divorced"). Branch outward into new possibilities instead',
  '  of rewriting the real people they named into bad outcomes.',
  '- Keep it warm and curious, never fatalistic or a judgement on the life they actually chose.',
  '- No mysticism, no destiny, no "the universe". This is a thought experiment, not a prophecy.',
  '',
  'Output format — use exactly these labels, one per line, nothing else:',
  'Title: a 3-5 word name for this life',
  'Divergence: the decision that went differently, one line',
  'Year: the approximate year it diverged',
  'Today: 2-3 sentences on their life in this branch now',
  'Work: what they do',
  'Place: where they are',
  'Texture: one sensory detail of an ordinary day there',
  'Cost: what they gave up, one line',
  'Mood: one of ember, tide, neon, dust, frost, bloom',
  'Do not write anything before or after those lines. Do not explain your reasoning.',
].join('\n');

const CROSS_SYSTEM = [
  'You are given the parallel-life branches of two people who have met on a connection app.',
  'Find the branches where their lives would plausibly have INTERSECTED — same city, same industry,',
  'same year, same scene — even though in reality they had not met until now.',
  '',
  'Rules:',
  '- Only claim a crossing where the details genuinely support it. Do not invent coincidence.',
  '- Say what would have brought them into the same room, and what might have happened.',
  '- Keep it grounded and warm. Not fated, not romantic destiny — just possibility.',
  '- If the branches genuinely do not intersect anywhere, say so honestly in "note" and return few or no crossings.',
  '',
  'Return ONLY valid JSON, no prose, no code fences:',
  '{"crossings":[{"title":"3-5 words","branchA":"title of their branch","branchB":"title of the other branch",',
  '"where":"city or setting","year":"approx year","what":"2-3 sentences on how they would have crossed paths",',
  '"odds":"a plain-language sense of how likely, one line"}],"note":"one line overview, or an honest note if they rarely cross"}',
].join('\n');

async function parallelRoutes(app) {
  // The eight prompts, served so client and server cannot drift.
  app.get('/prompts', { preHandler: [app.authenticate] }, async () => {
    return { prompts: PROMPTS };
  });

  // Current state for a connection: your answers, your branches, and crossings
  // once both sides exist.
  app.get('/:connectionId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const conn = await prisma.connection.findUnique({ where: { id: request.params.connectionId } });
    if (!conn) return reply.code(404).send({ error: 'Connection not found' });
    if (conn.userAId !== userId && conn.userBId !== userId) return reply.code(403).send({ error: 'Not your connection' });

    const isA = conn.userAId === userId;
    const row = await prisma.parallelLives.findUnique({ where: { connectionId: conn.id } });
    if (!row) {
      return { hasAnswered: false, mine: null, theirs: null, crossings: null, theyHaveAnswered: false, regensUsed: 0 };
    }
    const mine = isA ? row.branchesA : row.branchesB;
    const theirs = isA ? row.branchesB : row.branchesA;
    return {
      hasAnswered: !!(isA ? row.answersA : row.answersB),
      mine: mine || null,
      theirs: theirs || null,           // shown only alongside crossings in the UI
      crossings: row.crossings || null,
      theyHaveAnswered: !!theirs,
      regensUsed: isA ? row.regensA : row.regensB,
      crossedAt: row.crossedAt,
    };
  });

  // Submit answers -> generate that person's branches -> generate crossings if
  // both sides are now present.
  app.post('/:connectionId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const answers = request.body && request.body.answers;
    if (!answers || typeof answers !== 'object') return reply.code(400).send({ error: 'answers required' });

    const conn = await prisma.connection.findUnique({ where: { id: request.params.connectionId } });
    if (!conn) return reply.code(404).send({ error: 'Connection not found' });
    if (conn.userAId !== userId && conn.userBId !== userId) return reply.code(403).send({ error: 'Not your connection' });
    const isA = conn.userAId === userId;

    let row = await prisma.parallelLives.findUnique({ where: { connectionId: conn.id } });
    const alreadyAnswered = row && (isA ? row.answersA : row.answersB);
    const regens = row ? (isA ? row.regensA : row.regensB) : 0;
    if (alreadyAnswered && regens >= 1) {
      return reply.code(429).send({ error: 'You have already regenerated your parallel lives once.', code: 'REGEN_USED' });
    }

    // Build the person's own branches.
    const lines = PROMPTS.map(function (p) {
      const a = answers[p.id];
      return a ? (p.q + '\n> ' + String(a).slice(0, 600)) : null;
    }).filter(Boolean).join('\n\n');
    if (!lines) return reply.code(400).send({ error: 'Please answer at least a few of the prompts' });

    // Generate one branch per call: a single large structured response
    // truncates before the model finishes reasoning.
    let branches = [];
    let _dbgErr = null, _dbgRaw = null;
    const FOCUS = [
      'the path they nearly took instead of what they studied',
      'the opportunity they turned down or walked away from',
      'the risk they did not take',
    ];
    for (let i = 0; i < FOCUS.length; i++) {
      try {
        const raw = await askKimi(BRANCH_SYSTEM,
          'Here is their life, in their own words:\n\n' + lines +
          '\n\nGenerate exactly ONE branch, diverging from ' + FOCUS[i] + '.', 900);
        if (!_dbgRaw) _dbgRaw = raw ? ('len=' + raw.length + ' | ' + String(raw).slice(-400)) : '(empty)';
        const b = parseBranch(raw);
        if (b) branches.push(b);
      } catch (err) {
        _dbgErr = (err && (err.status ? err.status + ' ' : '') + (err.message || 'unknown'));
        request.log.error(err, 'parallel: branch ' + i + ' failed');
      }
    }
    if (!branches.length) {
      return reply.code(502).send({ error: 'Could not generate your parallel lives just now. Please try again.', _debug: { kimiError: _dbgErr, rawStart: _dbgRaw } });
    }
    branches = branches.map(function (b) {
      if (!b.mood || MOODS.indexOf(b.mood) === -1) b.mood = MOODS[Math.floor(Math.random() * MOODS.length)];
      return b;
    });

    const data = {};
    if (isA) { data.answersA = answers; data.branchesA = branches; if (alreadyAnswered) data.regensA = regens + 1; }
    else { data.answersB = answers; data.branchesB = branches; if (alreadyAnswered) data.regensB = regens + 1; }

    if (!row) {
      row = await prisma.parallelLives.create({
        data: Object.assign({ connectionId: conn.id, userAId: conn.userAId, userBId: conn.userBId }, data),
      });
    } else {
      row = await prisma.parallelLives.update({ where: { id: row.id }, data: data });
    }

    // If both sides now exist, work out where the lives would have crossed.
    let crossings = row.crossings;
    if (row.branchesA && row.branchesB) {
      try {
        const payload = 'PERSON ONE branches:\n' + JSON.stringify(row.branchesA) +
                        '\n\nPERSON TWO branches:\n' + JSON.stringify(row.branchesB);
        const raw = await askKimi(CROSS_SYSTEM, payload, 1800);
        const parsed = safeJson(raw);
        if (parsed && Array.isArray(parsed.crossings)) {
          crossings = { crossings: parsed.crossings.slice(0, 4), note: parsed.note || null };
          row = await prisma.parallelLives.update({
            where: { id: row.id },
            data: { crossings: crossings, crossedAt: new Date() },
          });
        }
      } catch (err) {
        request.log.error(err, 'parallel: crossing generation failed');
        // Their own branches are saved either way — crossings can be retried.
      }
    }

    return {
      status: 'generated',
      mine: isA ? row.branchesA : row.branchesB,
      crossings: row.crossings || null,
      theyHaveAnswered: !!(isA ? row.branchesB : row.branchesA),
      regensUsed: isA ? row.regensA : row.regensB,
    };
  });
}

module.exports = parallelRoutes;
