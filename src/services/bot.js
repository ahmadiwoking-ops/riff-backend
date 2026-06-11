let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch {}
const client = process.env.ANTHROPIC_API_KEY && Anthropic ? new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

async function generateResponse(persona, message, history) {
  const lower = (message || '').toLowerCase();
  if (/^(hi|hey|hello|yo|sup)/i.test(lower)) return { text: "hey! I was hoping you'd message 💛" };
  if (/how (are|r) (you|u)/i.test(lower)) return { text: "honestly? better now that we're talking. how about you?" };
  if (!client) {
    const fallbacks = ["hmm. let me think about that...", "that's interesting. tell me more?", "sorry my wifi dropped. what were you saying?", "okay wait. I need to process what you just said", "pessoa just knocked my phone. where were we?"];
    return { text: fallbacks[Math.floor(Math.random() * fallbacks.length)] };
  }
  try {
    const res = await client.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 500, system: persona?.personality || 'You are a friendly chat companion.', messages: [...(history || []).slice(-10), { role: 'user', content: message }] });
    return { text: res.content.map(b => b.text || '').join('').trim() || "hmm. let me think..." };
  } catch { return { text: "sorry, signal dropped for a second. what were you saying?" }; }
}
module.exports = { generateResponse };
