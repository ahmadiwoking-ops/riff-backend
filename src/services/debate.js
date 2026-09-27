// Debate engine.
//
// The whole design problem here is cost. A debate must remember what was
// argued earlier or it is not a debate, but sending 40 exchanges of raw
// transcript on every turn means turn 40 costs roughly eight times turn 5.
//
// So: the last WINDOW exchanges go verbatim, everything older is folded into a
// running summary that is rewritten occasionally. Cost per turn stays flat
// however long the debate runs, and the argument stays sharper too - models
// lose the thread in a long raw transcript.

const OpenAI = require('openai');
const prisma = require('../db');
const { getDebater, buildDebatePrompt, ARBITER_PROMPT } = require('./debate-personas');

const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k2.6';


/** kimi-k2.6 often returns an empty content field with the real output in
 *  reasoning_content. Read whichever actually has something. */
/** Arbiter returns labelled prose rather than JSON - this model reasons in
 *  prose and never finishes a JSON object within any sane token budget.
 *  A missing label degrades one field rather than failing the whole verdict. */
function parseVerdict(text) {
  function field(label) {
    var m = text.match(new RegExp("^" + label + ":\\s*(.+?)(?=\\n[A-Z][A-Z ]{2,}:|$)", "ms"));
    return m ? m[1].trim() : null;
  }
  function scores(label) {
    var line = field(label);
    if (!line) return null;
    var out = {};
    ["engagement", "concession", "progression", "evidence", "conduct"].forEach(function (k) {
      var m = line.match(new RegExp(k + "\\D{0,4}(\\d{1,2})", "i"));
      out[k] = m ? Math.min(10, parseInt(m[1], 10)) : null;
    });
    return out;
  }
  var winner = (field("WINNER") || "").toLowerCase();
  if (winner.indexOf("user") !== -1) winner = "user";
  else if (winner.indexOf("draw") !== -1) winner = "draw";
  else if (winner.indexOf("ai") !== -1) winner = "ai";
  else winner = null;
  if (!winner) return null;
  return {
    winner: winner,
    confidence: (field("CONFIDENCE") || "narrow").toLowerCase().indexOf("clear") !== -1 ? "clear" : "narrow",
    summary: field("SUMMARY"),
    scores: { user: scores("USER SCORES"), ai: scores("AI SCORES") },
    userStrongest: field("USER STRONGEST"),
    aiStrongest: field("AI STRONGEST"),
    reasoning: field("REASONING"),
    improve: field("IMPROVE"),
  };
}
/** The model narrates its own planning before answering. That text must never
 *  reach the user - better to fail and let them retry than to show notes. */
var DELIB_MARKERS = [
  /\bI should (respond|address|argue|acknowledge|point out|concede|note)\b/i,
  /\bI (will|shall) (argue|respond|address|say|make)\b/i,
  /\bthe user('s| is| says| wants| seems| claims| argues)\b/i,
  /\bas (Sameer|Rosa|Dev|Vera|Orin),? I\b/i,
  /\bmy (task|job|goal|response should)\b/i,
  /\b(Wait|Hmm|Okay|Let me think)\s*[-,\u2014]/i,
  /\bI need to (respond|address|be|make|argue)\b/i,
  /\btheir (argument|claim) (seems|appears) to be\b/i,
];
function looksLikeDeliberation(t) {
  if (!t) return true;
  for (var i = 0; i < DELIB_MARKERS.length; i++) {
    if (DELIB_MARKERS[i].test(t)) return true;
  }
  return false;
}
/** Rough script detection, enough to tell the debater which language to
 *  use. Returns null when unsure - a wrong guess is worse than none. */
function detectLanguage(text) {
  if (!text) return null;
  var t = String(text);
  var checks = [
    [/[\u0600-\u06FF\u0750-\u077F]/, "Urdu or Arabic"],
    [/[\u0900-\u097F]/, "Hindi"],
    [/[\u0980-\u09FF]/, "Bengali"],
    [/[\u0A00-\u0A7F]/, "Punjabi"],
    [/[\u0E00-\u0E7F]/, "Thai"],
    [/[\u4E00-\u9FFF]/, "Chinese"],
    [/[\u3040-\u30FF]/, "Japanese"],
    [/[\uAC00-\uD7AF]/, "Korean"],
    [/[\u0400-\u04FF]/, "Russian"],
    [/[\u0370-\u03FF]/, "Greek"],
    [/[\u05D0-\u05EA]/, "Hebrew"],
  ];
  for (var i = 0; i < checks.length; i++) {
    var m = t.match(new RegExp(checks[i][0].source, "g"));
    // A few stray characters are not enough - look for real presence.
    if (m && m.length >= Math.max(3, t.length * 0.1)) return checks[i][1];
  }
  return null;
}
function readReply(res) {
  var m = (res && res.choices && res.choices[0] && res.choices[0].message) || {};
  var t = (m.content || "").trim();
  if (!t && m.reasoning_content) t = m.reasoning_content.trim();
  return t;
}
// If replies still arrive as deliberation, this is the first thing to check
// against Moonshot's documentation - the mechanism is right, the spelling
// may not be.
const THINKING_OFF = { type: 'disabled' };

const WINDOW = 12;          // exchanges sent verbatim
const SUMMARISE_EVERY = 8;  // rewrite the summary this often
const MAX_EXCHANGES = 40;   // hard cap, per the product decision

let kimi = null;
function client() {
  if (kimi) return kimi;
  if (!process.env.MOONSHOT_API_KEY) return null;
  kimi = new OpenAI({
    apiKey: process.env.MOONSHOT_API_KEY,
    baseURL: 'https://api.moonshot.ai/v1',
  });
  return kimi;
}

let openai = null;
function openaiClient() {
  if (openai) return openai;
  if (!process.env.OPENAI_API_KEY) return null;
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

/** Speech to text. The user may speak; the debater always replies in writing. */
async function transcribe(base64Audio) {
  const oa = openaiClient();
  if (!oa) return { ok: false, reason: 'OPENAI_API_KEY is not set' };
  try {
    const buf = Buffer.from(base64Audio, 'base64');
    const file = new File([buf], 'speech.m4a', { type: 'audio/m4a' });
    const res = await oa.audio.transcriptions.create({ file: file, model: 'whisper-1' });
    const text = (res && res.text) ? res.text.trim() : '';
    if (!text) return { ok: false, reason: 'Nothing was heard in that recording.' };
    return { ok: true, text: text };
  } catch (err) {
    return { ok: false, reason: (err && err.message) || 'Could not transcribe that.' };
  }
}

/**
 * Fold older exchanges into the running summary. Called occasionally rather
 * than every turn - rewriting the summary is itself a model call.
 */
async function updateSummary(debate, allMessages) {
  const c = client();
  if (!c) return debate.summary;

  const older = allMessages.slice(0, Math.max(0, allMessages.length - WINDOW * 2));
  if (!older.length) return debate.summary;

  const transcript = older.map(function (m) {
    return (m.role === 'user' ? 'THEM: ' : 'YOU: ') + m.content;
  }).join('\n\n');

  try {
    const res = await c.chat.completions.create({
      model: KIMI_MODEL,
      max_tokens: 2000,
      temperature: 0.6,   // non-thinking mode only accepts 0.6
      thinking: THINKING_OFF,
      messages: [
        {
          role: 'system',
          content:
            'Summarise this section of a debate so the debater can continue without ' +
            'the full transcript. Keep: the arguments each side actually made, anything ' +
            'conceded, and any point left unanswered. Drop pleasantries and repetition. ' +
            'Write it as notes, not prose. Be specific about who argued what.',
        },
        {
          role: 'user',
          content:
            (debate.summary ? ('Existing notes:\n' + debate.summary + '\n\nNew section:\n') : '') +
            transcript,
        },
      ],
    });
    return readReply(res);
  } catch (err) {
    // A failed summary is not worth failing the turn for - the window alone
    // still gives a usable debate.
    console.error('[debate] summary failed:', err && err.message);
    return debate.summary;
  }
}

/** One debate turn. Returns the AI's reply. */
async function debateReply(debate, allMessages, _retry) {
  const c = client();
  if (!c) return { ok: false, reason: 'AI is not configured.' };

  const debater = getDebater(debate.persona);
  if (!debater) return { ok: false, reason: 'Unknown debater.' };

  const system = buildDebatePrompt(
    debater, debate.topic, debate.userPosition, debate.aiPosition, debate.summary
  );

  // Only the recent window goes verbatim; the rest lives in the summary.
  const recent = allMessages.slice(-WINDOW * 2);
  const msgs = [{ role: 'system', content: system }].concat(
    recent.map(function (m) {
      return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content };
    })
  );

  try {
    const res = await c.chat.completions.create({
      model: KIMI_MODEL,
      max_tokens: 3000,
      temperature: 0.6,   // non-thinking mode only accepts 0.6
      thinking: THINKING_OFF,
      messages: msgs,
    });
    var fin = res.choices[0].finish_reason;
    var thought = !!(res.choices[0].message && res.choices[0].message.reasoning_content);
    console.log('[debate] finish=' + fin + ' reasoning=' + (thought ? 'yes' : 'no') + ' contentLen=' + ((res.choices[0].message.content || '').length));
    if (fin === 'length') {
      console.warn('[debate] hit the token ceiling before finishing');
    }
    const text = readReply(res);
    if (!text) return { ok: false, reason: 'No reply came back.' };
    if (looksLikeDeliberation(text) && !_retry) {
      console.warn('[debate] deliberation returned, retrying once');
      return debateReply(debate, allMessages, true);
    }
    if (looksLikeDeliberation(text)) {
      console.error('[debate] got deliberation instead of a reply:', text.slice(0, 160));
      return { ok: false, reason: 'That did not come through properly. Send it again.' };
    }
    return { ok: true, text: text };
  } catch (err) {
    console.error('[debate] reply failed:', err && err.message);
    return { ok: false, reason: 'Could not get a reply just now.' };
  }
}

/**
 * Judge the debate. The expensive call, made once, and the result is stored so
 * it can be re-read without paying again.
 */
async function judgeDebate(debate, allMessages) {
  const c = client();
  if (!c) return { ok: false, reason: 'AI is not configured.' };

  const debater = getDebater(debate.persona);

  // The judge needs the whole argument, but a 40-exchange debate is long, so
  // earlier parts arrive as the summary and the last stretch verbatim.
  const recent = allMessages.slice(-24);
  const transcript = recent.map(function (m) {
    return (m.role === 'user' ? 'USER: ' : 'AI: ') + m.content;
  }).join('\n\n');

  const body = [
    'TOPIC: ' + debate.topic,
    'USER ARGUED: ' + debate.userPosition,
    'AI ARGUED: ' + debate.aiPosition,
    'AI DEBATER: ' + (debater ? debater.name : debate.persona),
    '',
    debate.summary ? ('EARLIER IN THE DEBATE (notes):\n' + debate.summary + '\n') : '',
    'TRANSCRIPT:',
    transcript,
  ].filter(Boolean).join('\n');

  try {
    const res = await c.chat.completions.create({
      model: KIMI_MODEL,
      max_tokens: 4000,
      temperature: 0.6,   // non-thinking mode only accepts 0.6
      thinking: THINKING_OFF,
      messages: [
        { role: 'system', content: ARBITER_PROMPT },
        { role: 'user', content: body },
      ],
    });

    let raw = readReply(res);
    var verdict = parseVerdict(raw);
    if (!verdict) {
      console.error('[debate] verdict unreadable, tail was:', raw.slice(-500));
      return { ok: false, reason: 'The judge could not be read. Try again.' };
    }
    if (!verdict || !verdict.winner) return { ok: false, reason: 'The judge returned nothing usable.' };
    return { ok: true, verdict: verdict };
  } catch (err) {
    console.error('[debate] judging failed:', err && err.message);
    return { ok: false, reason: 'Could not judge the debate just now.' };
  }
}

/** Topic suggestions for a given debater. */
async function suggestTopics(personaKey) {
  const c = client();
  const debater = getDebater(personaKey);
  if (!c || !debater) return { ok: false, reason: 'Unavailable.' };

  try {
    const res = await c.chat.completions.create({
      model: KIMI_MODEL,
      max_tokens: 1500,
      temperature: 0.6,   // non-thinking mode only accepts 0.6
      thinking: THINKING_OFF,
      messages: [
        {
          role: 'system',
          content:
            'Suggest five debate topics for a debate with an expert in: ' + debater.subject + '.\n' +
            'Each must be a genuine question with two defensible sides - not a question with ' +
            'an obvious answer, and not a topic where one side is simply bigotry.\n' +
            'Phrase each as a short proposition someone could argue for or against.\n' +
            'Return ONLY a JSON array of five strings. No markdown fence.',
        },
        { role: 'user', content: 'Five topics.' },
      ],
    });
    let raw = readReply(res);
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
    // Take the JSON itself, ignoring any deliberation around it.
    var _o = raw.indexOf('{') !== -1 ? raw.indexOf('{') : raw.indexOf('[');
    var _c = raw.lastIndexOf('}') !== -1 ? raw.lastIndexOf('}') : raw.lastIndexOf(']');
    if (_o !== -1 && _c > _o) raw = raw.slice(_o, _c + 1);
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return { ok: false, reason: 'Bad suggestion format.' };
    return { ok: true, topics: list.slice(0, 5) };
  } catch (err) {
    console.error('[debate] topic suggestion failed:', err && err.message);
    return { ok: false, reason: 'Could not suggest topics just now.' };
  }
}

module.exports = {
  detectLanguage,
  transcribe,
  debateReply,
  judgeDebate,
  suggestTopics,
  updateSummary,
  WINDOW,
  SUMMARISE_EVERY,
  MAX_EXCHANGES,
};
