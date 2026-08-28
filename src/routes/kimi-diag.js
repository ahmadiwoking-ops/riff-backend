// TEMPORARY diagnostic — delete once we know which variant works.
// Runs three Kimi configurations against the same task and reports what each
// returned, so we can stop guessing at kimi-k2.6's behaviour from the outside.
const OpenAI = require('openai').default || require('openai');

const kimi = process.env.MOONSHOT_API_KEY
  ? new OpenAI({ apiKey: process.env.MOONSHOT_API_KEY, baseURL: 'https://api.moonshot.ai/v1' })
  : null;
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k2.6';

const SYSTEM = [
  'You imagine a parallel life: the same real person, but one decision went differently.',
  'Be specific and vivid. Real street-level detail beats abstraction.',
  'Return a JSON object with exactly these keys:',
  '{"title":"2-5 word noun phrase","divergence":"one sentence","year":"a year",',
  '"today":"2-3 sentences","work":"job","place":"where","texture":"one sensory detail",',
  '"cost":"one sentence","mood":"one of: ember, tide, neon, dust, frost, bloom"}',
].join('\n');

const USER = [
  'Their life, in their own words:',
  'Grew up in Woking, left for London at 19.',
  'Studied computer science. Nearly did architecture instead.',
  'Took a startup job in 2015 that pivoted them into product.',
  'Did not take the leap to go freelance in 2019.',
  '',
  'Generate ONE branch, diverging from the path they nearly took instead of what they studied.',
].join('\n');

function report(raw) {
  if (!raw) return { len: 0, head: null, tail: null, hasJson: false, parsed: null };
  const s = String(raw);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  let parsed = null;
  if (start !== -1 && end !== -1) {
    try { parsed = JSON.parse(s.slice(start, end + 1)); } catch (e) { parsed = null; }
  }
  return {
    len: s.length,
    head: s.slice(0, 160),
    tail: s.slice(-160),
    hasJson: start !== -1 && end !== -1,
    parsedTitle: parsed && parsed.title ? parsed.title : null,
    parsedToday: parsed && parsed.today ? String(parsed.today).slice(0, 120) : null,
  };
}

async function run(label, opts) {
  try {
    const res = await kimi.chat.completions.create(opts);
    const msg = res.choices && res.choices[0] ? res.choices[0].message : null;
    return {
      label: label,
      finish: res.choices && res.choices[0] ? res.choices[0].finish_reason : null,
      content: report(msg && msg.content),
      reasoning: report(msg && msg.reasoning_content),
    };
  } catch (err) {
    return { label: label, error: (err.status ? err.status + ' ' : '') + (err.message || 'unknown') };
  }
}

async function kimiDiagRoutes(app) {
  app.get('/kimi-diag', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!kimi) return reply.code(500).send({ error: 'No MOONSHOT_API_KEY' });
    const base = {
      model: KIMI_MODEL,
      temperature: 1,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: USER }],
    };

    const results = [];

    // A: JSON mode alone — never tried without thinking:disabled.
    results.push(await run('A: response_format only', Object.assign({}, base, {
      max_tokens: 900,
      response_format: { type: 'json_object' },
    })));

    // B: let it reason, generous budget, JSON at the end.
    results.push(await run('B: thinking disabled, 3000 tokens', Object.assign({}, base, {
      max_tokens: 3000,
      extra_body: { thinking: { type: 'disabled' } },
    })));

    // C: prefill the assistant turn with '{' to force it straight into JSON.
    results.push(await run('C: assistant prefill', Object.assign({}, base, {
      max_tokens: 900,
      extra_body: { thinking: { type: 'disabled' } },
      messages: base.messages.concat([{ role: 'assistant', content: '{' }]),
    })));

    return { model: KIMI_MODEL, results: results };
  });
}

module.exports = kimiDiagRoutes;
