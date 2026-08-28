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

// Fixed set: each maps to an illustration in the app's library. The model must
// pick one of these, never invent a new one, or the image lookup misses.
const CATEGORIES = [
  'carpenter','potter','maker','restorer','architect','designer','illustrator','chef','baker','cafe_owner',
  'doctor','nurse','veterinarian','paramedic','police_officer','firefighter','teacher','social_worker','researcher','scientist',
  'lecturer','musician','actor','writer','performer','developer','product_manager','startup_founder','office_professional','finance_analyst',
  'manager','farmer','outdoor_guide','conservationist','sailor','fisherman','nomad','tour_guide','expat','community_builder',
  'parent','family_life','community_worker','mechanic','builder','electrician','remote_worker','monastic_life','off_grid_living','writer_in_nature',
];

// kimi-k2.6 narrates in prose even when told to return JSON, and long
// structured requests truncate before the object is ever written. So we ask
// for ONE branch at a time in a simple Key: value shape and parse that.
function parseBranch(text) {
  if (!text) return null;
  var j = safeJson(text);
  if (j && j.title) return j;
  var out = {};
  var keys = ['title','divergence','year','moment','after','led','today','work','place','texture','cost','mood','category'];
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
    'Write it in FIRST PERSON, as that person looking back. Use "I", never "they".',
    '',
    'Tell it as four beats, in order:',
    '1. THE MOMENT — the decision itself, the day it turned. Concrete: a room, a letter, a phone call.',
    '2. THE YEARS AFTER — what the first few years looked like. What was hard, what surprised me.',
    '3. WHERE IT LED — the shape my life took. Work, people, the place I ended up.',
    '4. TODAY — an ordinary present-day moment, in sensory detail. What I can smell, hear, see right now.',
    '',
    'Two or three sentences per beat. Be specific — a neighbourhood, a job, a smell, a habit.',
    'Say plainly what I gave up for this life. Warm and curious, never fatalistic, never a',
    'judgement on the life I actually chose. No mysticism, no destiny. Alternative relationships',
    'are fine, but never predict bad outcomes for a real named person from my actual life.',
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
    'You are given a writer\'s notes describing one parallel life, told in first person.',
    'The notes may include false starts or several attempts. Take the BEST, most complete',
    'version and express it as JSON. Do not invent new facts; use what is there.',
    'Keep the writer\'s own phrasing and specific details — quote them wherever you can.',
    'Keep everything in FIRST PERSON ("I"), exactly as written.',
    'Return exactly these keys:',
    '{"title":"2-5 word noun phrase","divergence":"the decision that went differently, ONE complete sentence",',
    '"year":"four-digit year the decision was made",',
    '"moment":"beat 1 — the day it turned, 2-3 sentences",',
    '"after":"beat 2 — the years just after, 2-3 sentences",',
    '"led":"beat 3 — the shape my life took, 2-3 sentences",',
    '"today":"beat 4 — an ordinary present-day moment, 2-3 sentences",',
    '"work":"my job","place":"where I live",',
    '"cost":"what I gave up, one complete sentence",',
    '"mood":"one of: ember, tide, neon, dust, frost, bloom",',
    '"category":"one of: craft, design, food, medicine, service, academic, stage, tech,',
    'corporate, land, sea, travel, care, trade, solitary"}',
    'category: whichever best describes the WORK or shape of this life. craft=making things',
    'by hand, design=architecture and design, food=cooking and hospitality, medicine=health',
    'and animals, service=police fire teaching social work, academic=research and teaching at',
    'a university, stage=music acting writing performing, tech=software and startups,',
    'corporate=office and management, land=farming and outdoors, sea=coastal and sailing,',
    'travel=nomadic and guiding, care=family and community, trade=building and mechanics,',
    'solitary=remote or off-grid. Pick the closest — never invent a new one.',
    'mood: ember=warm and driven, tide=steady and calm, neon=fast and urban,',
    'dust=quiet and craft-like, frost=austere or solitary, bloom=growing and hopeful.',
    'Do not default to bloom. Never truncate a sentence mid-clause. No placeholders,',
    'no brackets, no hedging, no alternatives.',
].join('\n');
  const res = await openai.chat.completions.create({
    model: PL_MODEL,
    temperature: 0.3,
    max_tokens: 1100,
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

var CATEGORY_HINTS = [
  ['carpenter', ['carpenter','joiner','woodwork','cabinet']],
  ['potter', ['potter','ceramic','pottery','kiln']],
  ['restorer', ['restorer','restoration','conservator','antique']],
  ['architect', ['architect','architecture']],
  ['illustrator', ['illustrator','illustration']],
  ['designer', ['designer','design studio','graphic']],
  ['chef', ['chef','cook','kitchen','restaurant']],
  ['baker', ['baker','bakery','sourdough','bread']],
  ['cafe_owner', ['cafe','coffee shop','barista','roaster']],
  ['doctor', ['doctor','gp','physician','surgeon','consultant']],
  ['nurse', ['nurse','midwife']],
  ['veterinarian', ['vet','veterinar']],
  ['paramedic', ['paramedic','ambulance']],
  ['police_officer', ['police','constable','detective']],
  ['firefighter', ['firefighter','fire service']],
  ['teacher', ['teacher','teaching','schoolteacher','classroom']],
  ['social_worker', ['social work','support worker','caseworker']],
  ['researcher', ['researcher','research fellow','phd','laboratory']],
  ['scientist', ['scientist','physicist','biologist','chemist']],
  ['lecturer', ['lecturer','professor','academic','university']],
  ['musician', ['musician','guitar','band','composer','songwriter']],
  ['actor', ['actor','acting','theatre company']],
  ['performer', ['performer','dancer','circus','stage']],
  ['writer', ['writer','author','novelist','journalist','poet']],
  ['developer', ['developer','engineer','programmer','coding','software']],
  ['product_manager', ['product manager','product lead','product owner']],
  ['startup_founder', ['founder','startup','co-founder','own company']],
  ['finance_analyst', ['finance','analyst','accountant','banking']],
  ['manager', ['manager','managing','team lead','director']],
  ['farmer', ['farmer','farm','smallholding','beekeep','orchard']],
  ['outdoor_guide', ['guide','mountain','climbing instructor','ranger']],
  ['conservationist', ['conservation','ecolog','wildlife','rewilding']],
  ['sailor', ['sailor','sailing','skipper','yacht']],
  ['fisherman', ['fisherman','fishing','trawler']],
  ['nomad', ['nomad','van life','travelling','itinerant']],
  ['tour_guide', ['tour guide','tours','guiding visitors']],
  ['expat', ['expat','abroad','overseas']],
  ['community_builder', ['community project','community garden','organiser']],
  ['community_worker', ['community worker','charity','volunteer','food bank']],
  ['parent', ['parent','raising','stay-at-home','father','mother']],
  ['family_life', ['family life','family']],
  ['mechanic', ['mechanic','garage','engines']],
  ['builder', ['builder','construction','site manager']],
  ['electrician', ['electrician','electrical']],
  ['remote_worker', ['remote','freelance','consultant','contractor']],
  ['monastic_life', ['monastic','monk','retreat','contemplative']],
  ['off_grid_living', ['off-grid','off grid','self-sufficient','cabin']],
  ['writer_in_nature', ['writing cabin','writes in the hills']],
  ['maker', ['maker','workshop','hand-built','craftsman']],
];
function deriveCategory(b) {
  var hay = [b.work, b.title, b.place, b.led].filter(Boolean).join(' ').toLowerCase();
  for (var i = 0; i < CATEGORY_HINTS.length; i++) {
    var key = CATEGORY_HINTS[i][0], words = CATEGORY_HINTS[i][1];
    for (var j = 0; j < words.length; j++) {
      if (hay.indexOf(words[j]) !== -1) return key;
    }
  }
  return 'office_professional';
}

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
    // Deliberately distinct so the three branches do not collapse into one idea.
    // Five distinct forks so the set feels worth browsing.
    const FOCUS = [
      'the education or training path they nearly took instead',
      'the place they did not move to, or the move they did not make',
      'the professional risk they talked themselves out of taking',
      'the opportunity or offer they turned down',
      'the person or relationship that redirected them, going the other way',
    ];
    // The three branches are independent, so generate them concurrently.
    // Sequentially this was six model calls back to back and ran past three
    // minutes; in parallel it is bounded by the slowest single branch.
    let _plErr = null;
    const settled = await Promise.all(FOCUS.map(async function (focus, i) {
      try {
        const prose = await writeBranchProse(lines, focus);   // Kimi: the writing
        if (!prose) { request.log.warn({ i: i }, 'parallel: no prose'); return null; }
        const json = await structureBranch(prose);            // mini: the fields
        let b = parseBranch(json);
        if (!b) { b = parseBranch(await structureBranch(prose)); }  // one retry of structuring only
        return b;
      } catch (err) {
        if (!_plErr) _plErr = (err && (err.message || String(err))) + ' | ' + (err && err.stack ? err.stack.split('\n')[1] : '');
        request.log.error(err, 'parallel: branch ' + i + ' failed');
        return null;
      }
    }));
    branches = settled.filter(Boolean).map(function (b) {
      // The model ignores a 50-item list buried in a prompt, so derive the
      // category from the `work` and `place` text it does produce reliably.
      if (!b.category || CATEGORIES.indexOf(b.category) === -1) b.category = deriveCategory(b);
      if (!b.mood || MOODS.indexOf(b.mood) === -1) b.mood = MOODS[Math.floor(Math.random() * MOODS.length)];
      return b;
    });
    if (!branches.length) {
      return reply.code(502).send({ error: 'Could not generate your parallel lives just now. Please try again.', _e: _plErr });
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
