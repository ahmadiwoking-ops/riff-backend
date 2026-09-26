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
      max_tokens: 700,
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
    return res.choices[0].message.content.trim();
  } catch (err) {
    // A failed summary is not worth failing the turn for - the window alone
    // still gives a usable debate.
    console.error('[debate] summary failed:', err && err.message);
    return debate.summary;
  }
}

/** One debate turn. Returns the AI's reply. */
async function debateReply(debate, allMessages) {
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
      max_tokens: 900,
      temperature: 0.8,
      messages: msgs,
    });
    const text = res.choices[0].message.content.trim();
    if (!text) return { ok: false, reason: 'No reply came back.' };
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
      max_tokens: 1400,
      temperature: 0.3,   // a judge should be consistent
      messages: [
        { role: 'system', content: ARBITER_PROMPT },
        { role: 'user', content: body },
      ],
    });

    let raw = res.choices[0].message.content.trim();
    // Models add fences despite being told not to.
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();

    let verdict;
    try {
      verdict = JSON.parse(raw);
    } catch (e) {
      console.error('[debate] verdict was not valid JSON:', raw.slice(0, 300));
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
      max_tokens: 400,
      temperature: 1.0,
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
    let raw = res.choices[0].message.content.trim();
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return { ok: false, reason: 'Bad suggestion format.' };
    return { ok: true, topics: list.slice(0, 5) };
  } catch (err) {
    console.error('[debate] topic suggestion failed:', err && err.message);
    return { ok: false, reason: 'Could not suggest topics just now.' };
  }
}

module.exports = {
  transcribe,
  debateReply,
  judgeDebate,
  suggestTopics,
  updateSummary,
  WINDOW,
  SUMMARISE_EVERY,
  MAX_EXCHANGES,
};
