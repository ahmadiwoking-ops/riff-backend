const prisma = require('../db');
const OpenAI = require('openai').default || require('openai');

// gpt-4o-mini, not Kimi: kimi-k2.6 narrates before answering, truncates mid-
// object, hedges ('or something Manchester-related') and ignores format
// instructions — roughly 1 usable branch in 3 even with retries and guards.
// Kimi remains the right choice for the AI companions.
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const PL_MODEL = 'gpt-4o-mini';

// Two-stage generation. kimi-k2.6 CANNOT return structured output: it reasons
// until the token budget is gone and never starts the answer — content is
// always empty, finish_reason always 'length', even with thinking disabled,
// JSON mode, or an assistant prefill (all three tested). But its prose is far
// better than mini's. So: Kimi writes the life as free text (read out of
// reasoning_content, which is where everything lands), then mini structures it.
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
  // Reject template echoes — the model sometimes repeats the field description
  // instead of filling it in ('3-5 words', 'one line', '2-3 sentences').
  var echoes = /^(a )?\d[-–]\d (words?|sentences?)|^one line$|^approx|^the decision that|^what they (do|gave up)$/i;
  if (!out.title || !out.today) return null;
  if (echoes.test(out.title) || echoes.test(out.today) || echoes.test(out.divergence || '')) return null;
  // Reject reasoning leakage — the model sometimes thinks aloud into a field
  // ('Need a vivid scene', "Let's think", 'I should make it sound...').
  var thinking = /\b(need a |let'?s think|i should|maybe they|since (they|no)|presumably|or something evocative|explores that)\b/i;
  var vals = [out.title, out.today, out.divergence, out.cost].filter(Boolean).join(' ');
  if (thinking.test(vals)) return null;
  if (out.title && out.title.length > 60) return null;
  // Reject bracketed placeholders — the model sometimes returns the template
  // itself: '[Something]', '[Year]', '[Specific decision]'.
  if (/\[[^\]]+\]/.test(vals)) return null;
  // Reject hedging: '(or something Manchester-related)', 'maybe', "let's say".
  if (/\(or something|\bmaybe\b|let'?s say|something evocative|or similar\)/i.test(vals)) return null;
  // Reject unfilled filler that trails off into questions.
  if (/\?\s*(the|specific)/i.test(out.cost || '')) return null;
  return out;
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

// Stage one: Kimi, free prose. No format demands — that is what breaks it.
async function writeBranchProse(lifeLines, focus) {
  if (!kimi) return null;
  const system = [
    'You imagine a parallel life: the same real person, but one decision went differently.',
    'Write it as a short vivid paragraph. Be specific — a neighbourhood, a job, a smell, a habit.',
    'Say what they gave up for it. Warm and curious, never fatalistic, never a judgement on',
    'the life they actually chose. No mysticism, no destiny. Alternative relationships are',
    'fine, but never predict bad outcomes for a real named person from their actual life.',
  ].join('\n');
  const res = await kimi.chat.completions.create({
    model: KIMI_MODEL,
    temperature: 1,
    max_tokens: 2048,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: 'Their life, in their own words:\n\n' + lifeLines +
        '\n\nWrite ONE parallel life, diverging from ' + focus + '.' },
    ],
  });
  const msg = res.choices && res.choices[0] ? res.choices[0].message : null;
  if (!msg) return null;
  // content is reliably empty on this model; the writing is in reasoning_content.
  return (msg.content && msg.content.trim()) || (msg.reasoning_content && msg.reasoning_content.trim()) || null;
}

// Stage two: mini turns that prose into the fields. Trivial extraction task.
async function structureBranch(prose) {
  if (!openai || !prose) return null;
  const system = [
    'You are given a writer\'s notes describing one parallel life. The notes may include',
    'false starts, deliberation or several attempts. Take the BEST, most complete version',
    'described and express it as JSON. Do not invent new facts; use what is there.',
    'Return exactly these keys:',
    '{"title":"2-5 word noun phrase","divergence":"the decision that went differently, one sentence",',
    '"year":"the year","today":"2-3 sentences on their life now","work":"job","place":"where",',
    '"texture":"one sensory detail","cost":"what they gave up, one sentence",',
    '"mood":"one of: ember, tide, neon, dust, frost, bloom"}',
    'Keep the writer\'s own phrasing and specific details wherever you can.',
    'No placeholders, no brackets, no hedging, no alternatives.',
  ].join('\n');
  const res = await openai.chat.completions.create({
    model: PL_MODEL,
    temperature: 0.3,
    max_tokens: 700,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: prose.slice(0, 6000) }],
  });
  const msg = res.choices && res.choices[0] ? res.choices[0].message : null;
  return msg && msg.content ? msg.content.trim() : null;
}

async function askModel(system, user, maxTokens) {
  if (!openai) throw new Error('No OPENAI_API_KEY configured');
  const res = await openai.chat.completions.create({
    model: PL_MODEL,
    temperature: 0.9,
    max_tokens: maxTokens || 900,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  const msg = res.choices && res.choices[0] ? res.choices[0].message : null;
  return msg && msg.content ? msg.content.trim() : null;
}

const BRANCH_SYSTEM = [
  'You imagine a parallel life: the same real person, but one of their decisions went differently.',
  'Think superposition — same starting material, a different branch taken.',
  '',
  'Be specific and vivid. Real street-level detail beats grand abstraction.',
  'Invent concrete particulars: a neighbourhood, a job title, a smell, a habit.',
  'Alternative relationships and family are fair game — a different branch means different people.',
  'But never predict bad outcomes for a real named person from their actual life.',
  'Warm and curious. Never fatalistic, never a judgement on the life they actually chose.',
  'No mysticism, no destiny, no "the universe". A thought experiment, not a prophecy.',
  '',
  'Return a JSON object with exactly these keys:',
  '{"title":"2-5 word concrete noun phrase","divergence":"the decision that went differently, one sentence",',
  '"year":"the year it diverged","today":"2-3 sentences on their life in this branch now",',
  '"work":"what they do","place":"where they live","texture":"one sensory detail of an ordinary day",',
  '"cost":"what they gave up, one sentence","mood":"one of: ember, tide, neon, dust, frost, bloom"}',
  '',
  'Example of the register expected (write your own, do not reuse this):',
  '{"title":"The Rotterdam Drawings","divergence":"Took the architecture place at Sheffield instead of computer science.",',
  '"year":"2009","today":"They run a four-person studio in Rotterdam doing social housing competitions. The work is slower and poorer than the life they actually have, but the buildings outlast them.",',
  '"work":"Architect, small practice, public commissions","place":"Rotterdam",',
  '"texture":"Tracing paper curling in the radiator heat, coffee going cold on the drawing board.",',
  '"cost":"The money, and the friends they would have made in London.","mood":"dust"}',
  '',
  'Every value must be filled in with real invented detail. No placeholders, no brackets,',
  'no hedging like "or something similar", no alternatives, no questions.',
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
        // Stage one: Kimi writes it as prose (its strength).
        const prose = await writeBranchProse(lines, FOCUS[i]);
        if (!prose) { request.log.warn({ i: i }, 'parallel: no prose from kimi'); continue; }
        if (!_dbgRaw) _dbgRaw = 'prose len=' + prose.length + ' | ' + prose.slice(0, 200);
        // Stage two: mini structures it (its strength).
        const json = await structureBranch(prose);
        let b = parseBranch(json);
        if (!b) {
          // One retry of the structuring step only — the prose is usually fine.
          const json2 = await structureBranch(prose);
          b = parseBranch(json2);
        }
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
        const raw = await askModel(CROSS_SYSTEM, payload, 1800);
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
