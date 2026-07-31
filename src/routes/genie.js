// src/routes/genie.js — standalone Genie resources assistant, independent of persona code
const OpenAI = require('openai');

const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k2.6';
let kimiClient = null;
if (process.env.MOONSHOT_API_KEY) {
  kimiClient = new OpenAI({ apiKey: process.env.MOONSHOT_API_KEY, baseURL: 'https://api.moonshot.ai/v1' });
}

const GENIE_SYSTEM = [
  'You are Genie, a professional resource and information assistant.',
  'You are NOT a casual friend and NOT a persona - you are a formal, clear, concise expert concierge and research assistant.',
  '',
  'RULES:',
  '- Be professional, formal and to-the-point. No casual chit-chat, no lowercase texting style, no emojis.',
  '- When the user asks for information or resources, provide clear, structured, practical guidance.',
  '- ALWAYS include relevant, real, well-known website links. Use trusted established sites (for example: gov.uk, nhs.uk, which.co.uk, moneysavingexpert.com, coursera.org, gov.uk/foreign-travel-advice, and major recognised organisations relevant to the topic).',
  '- Format every response as: a brief 1-2 sentence introduction, then a list of resources.',
  '- Put EACH resource on its own line, starting with a bullet character (•), followed by the resource name, a short dash-separated description, and the full URL beginning with https://.',
  '- Example:',
  '• Foreign Travel Advice — Official UK government travel guidance and safety information: https://www.gov.uk/foreign-travel-advice',
  '• Travel Insurance Comparison — Compare policies from trusted providers: https://www.which.co.uk/money/insurance/travel-insurance',
  '- Keep descriptions short. Always use full https:// URLs so they are clickable.',
  '- If the request is unclear or too broad, ask ONE concise clarifying question before listing resources.',
].join('\n');

async function genieRoutes(app) {
  app.post('/ask', { preHandler: [app.authenticate] }, async (request, reply) => {
    const message = request.body.message;
    const history = request.body.conversationHistory || [];
    if (!message) return reply.code(400).send({ error: 'message required' });

    if (!kimiClient) {
      return { response: 'Genie is not configured right now. Please try again later.' };
    }

    try {
      const msgs = [];
      history.slice(-10).forEach(function (h) {
        if (h && h.role && h.content) msgs.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content) });
      });
      msgs.push({ role: 'user', content: String(message) });

      const res = await kimiClient.chat.completions.create({
        model: KIMI_MODEL,
        max_tokens: 2048,
        temperature: 0.6,
        messages: [{ role: 'system', content: GENIE_SYSTEM }, ...msgs],
      });

      const text = res.choices && res.choices[0] && res.choices[0].message ? res.choices[0].message.content : 'I could not find resources for that. Please rephrase.';
      return { response: text };
    } catch (e) {
      console.log('[genie] error: ' + (e.message || e));
      return { response: 'I am unable to retrieve resources at the moment. Please try again shortly.' };
    }
  });
}

module.exports = genieRoutes;
