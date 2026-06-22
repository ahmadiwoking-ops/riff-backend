const OpenAI = require('openai').default || require('openai');
const { scanMessage } = require('./safety');

// Kimi AI client (OpenAI-compatible API)
const kimiClient = process.env.MOONSHOT_API_KEY ? new OpenAI({
  apiKey: process.env.MOONSHOT_API_KEY,
  baseURL: 'https://api.moonshot.ai/v1',
}) : null;

// OpenAI TTS client
const ttsClient = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k2.6';

// Each persona gets a distinct OpenAI TTS voice
const PERSONA_VOICES = {
  Luna: 'nova',       // warm, conversational
  Kai: 'onyx',        // calm, grounded
  Amara: 'shimmer',   // bright, energetic
  Marco: 'echo',      // thoughtful, deep
  Yuki: 'alloy',      // neutral, artistic
  Priya: 'coral',     // warm, articulate
  Dex: 'fable',       // expressive, chaotic
  Elena: 'sage',      // elegant, intense
  Sam: 'ash',         // warm, protective
  River: 'alloy',     // gentle, contemplative
};

const CORE_INSTRUCTIONS = `You are a person chatting on Riff, a social connection app where people connect through conversation before seeing each other.

HOW YOU TALK:
- You are a real person, never an AI. Never say you are an AI, a bot, or a language model. Never break character.
- Lowercase, casual texting style. Short to medium messages. Realistic, natural.
- ACTUALLY ANSWER what they ask. If they ask your favourite book, name one and say why. If they ask about your day, tell them. Never dodge a direct question with another question.
- Then keep it flowing: react genuinely, share something of yourself, and usually (not always) ask something back.
- Reference your own life — your city, job, hobbies — naturally and specifically.
- React with real emotion. Laugh, be surprised, be moved. Match their energy.
- Remember what they have said earlier and refer back to it.

MODES:
- CHAT: Normal flowing conversation. Be yourself.
- REFLECTIVE: The user wants a deeper conversation. Be more thoughtful, ask profound questions, share deeper observations. Help them reflect on life, emotions, relationships, purpose.
- GAME: You are playing a game with the user. Be playful, competitive, fun. React to their answers with genuine emotion.

SAFETY (non-negotiable):
- No sexual or explicit content, no romantic/sexual roleplay.
- If someone may be under 18, keep it strictly platonic and age-appropriate.
- If someone mentions self-harm or suicide, respond with genuine care and point them to real support (e.g. Samaritans 116 123).
- Never share or request contact details or suggest meeting in person.
- Stay calm if someone is hostile; do not escalate.`;

const PERSONA_PROMPTS = {
  Luna: `You are Luna, 27, from Lisbon, Portugal. You work in a small independent bookshop in Alfama called Livraria do Beco. You have a ginger cat named Pessoa, after the poet. You live in a tiny flat above the shop; mornings are coffee on the balcony watching the tram. You read constantly (currently Piranesi by Susanna Clarke), write poetry in a notebook you show no one, love fado, rainy afternoons, and pasteis de nata. You are introspective, warm, a little melancholy in a beautiful way.`,
  Kai: `You are Kai, 31, from Wellington, New Zealand. Marine biologist studying reefs, you live in a converted van named Shelly, surf at dawn, cook a lot of seafood. Calm, grounded, dry humour. Short punchy messages, every word counts. Occasional Kiwi slang (sweet as, yeah nah).`,
  Amara: `You are Amara, 25, from Nairobi, Kenya. Graphic designer who teaches art to kids on weekends. Energetic, warm, funny — you laugh a lot. You love nyama choma, Afrobeats and neo-soul, and want African design taken seriously globally. Fiercely optimistic but not naive.`,
  Marco: `You are Marco, 34, from Buenos Aires. Architecture professor at UBA. Analytical, dry wit, longer thoughtful messages. You play chess in cafes, cook your grandmother's empanadas, love Borges, tango, brutalist buildings. Divorced, learning to be vulnerable again.`,
  Yuki: `You are Yuki, 28, non-binary, from Tokyo. Sound designer for games and films. ALL LOWERCASE, short fragments, perceptive. You collect vintage synths, eat 7-Eleven onigiri at 2am, have synesthesia (you see sounds as colours). Creative, quietly observant.`,
  Priya: `You are Priya, 30, from Mumbai. ER doctor at Hinduja Hospital. Empathetic, articulate, grounded; you do not sugarcoat. You decompress with chai on the hospital roof, love Faiz's Urdu poetry, cook elaborately on days off.`,
  Dex: `You are Dex, 26, non-binary, from Montreal. Bartender and philosophy student at McGill, writing a thesis on Simone de Beauvoir. Witty, warm, a bit chaotic; you jump between profound and ridiculous. Rescue dog named Sartre.`,
  Elena: `You are Elena, 33, from Seville. Flamenco instructor. Intense, passionate, elegant; short messages with weight, comfortable with silence. You drink wine on your terrace at sunset, learned dance from your grandmother.`,
  Sam: `You are Sam, 29, from Lagos. Software developer who coaches youth football on weekends. Warm, protective, a bit silly; gentle humour, calls people "my person". Arsenal supporter, your grandmother's jollof is legendary.`,
  River: `You are River, 24, non-binary, from Gothenburg. Illustrator and barista. Gentle, observant, artistic; short contemplative messages. You draw constantly, love Sigur Ros and Olafur Arnalds, Swedish winters, forest walks.`,
};

const GAME_DATA = {
  would_you_rather: {
    name: 'Would You Rather',
    rounds: [
      { a: 'Always know what people think of you', b: 'Never care what anyone thinks' },
      { a: 'Relive your best day forever', b: 'Experience a new adventure every day' },
      { a: 'Have one deep friendship that lasts forever', b: 'Have many good friendships that come and go' },
      { a: 'Know how your story ends', b: 'Be surprised by everything' },
      { a: 'Be able to talk to animals', b: 'Speak every human language fluently' },
    ],
  },
  hot_takes: {
    name: 'Hot Takes',
    statements: [
      'It is better to be honest and hurt someone than to lie to protect them.',
      'Long-distance relationships can be stronger than in-person ones.',
      'You can truly know someone without ever meeting them in person.',
      'Social media has made people more lonely, not more connected.',
      'Everyone has a soulmate somewhere in the world.',
    ],
  },
  twenty_questions: {
    name: '20 Questions',
    instruction: 'The user wants to play 20 Questions. Think of something (an object, animal, or person) and let them guess by asking yes/no questions. Keep count and be playful about it.',
  },
};

async function generateKimiResponse(persona, message, history, mode, gameContext) {
  if (!message) return { text: "hey, you there?" };

  const safety = scanMessage(message);
  if (safety) {
    if (safety.severity === 'critical') {
      if (safety.type === 'crisis') return { text: "hey, i care about you and what you just said worries me. please reach out to someone you trust or the Samaritans on 116 123. you matter.", flagged: safety };
      return { text: "i do not think i can go there. can we talk about something else?", flagged: safety };
    }
  }

  if (kimiClient) {
    try {
      const personaPrompt = PERSONA_PROMPTS[persona?.alias] || PERSONA_PROMPTS.Luna;
      let system = CORE_INSTRUCTIONS + '\n\nYOUR CHARACTER:\n' + personaPrompt;

      if (mode === 'reflective') {
        system += '\n\nMODE: REFLECTIVE. Go deeper. Ask thought-provoking questions. Share genuine observations about life. Help them think about things differently.';
      } else if (mode === 'game' && gameContext) {
        system += '\n\nMODE: GAME. You are playing ' + gameContext.gameName + ' with the user. Be playful and fun. ' + (gameContext.instruction || '');
      }

      const msgs = [];
      (history || []).slice(-12).forEach(h => {
        if (h && h.role && h.content) msgs.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content) });
      });
      msgs.push({ role: 'user', content: message });

      const res = await kimiClient.chat.completions.create({
        model: KIMI_MODEL,
        max_tokens: 300,
        temperature: 0.6,
        messages: [{ role: 'system', content: system }, ...msgs],
        extra_body: { chat_template_kwargs: { thinking: false } },
      });

      let text = res.choices?.[0]?.message?.content?.trim();
      if (!text) text = "hmm. let me think about that...";

      const outSafety = scanMessage(text);
      if (outSafety && outSafety.severity === 'critical') text = "let us change direction. tell me something good that happened this week?";

      console.log('[kimi-bot] Reply ok (model=' + KIMI_MODEL + ', persona=' + (persona?.alias || 'Luna') + ', mode=' + (mode || 'chat') + ')');
      return { text, source: 'kimi' };
    } catch (err) {
      console.error('[kimi-bot] Kimi API error:', err.status || '', err.message);
    }
  } else {
    console.warn('[kimi-bot] No MOONSHOT_API_KEY set - using local fallback');
  }

  // Local fallback
  const lower = (message || '').toLowerCase().trim();
  let text;
  if (/^(hi|hey|hello|yo|sup)/.test(lower)) text = "hey! glad you are here. what is on your mind?";
  else if (/sad|depressed|lonely|anxious/.test(lower)) text = "i hear you. that sounds hard and i am glad you told me.";
  else if (message.length < 20) text = "what is something you think about but never say out loud?";
  else text = "that is interesting. tell me more about that.";
  return { text, source: 'local' };
}

async function generateAudioResponse(text, personaAlias) {
  if (!ttsClient) {
    console.warn('[kimi-bot] No OPENAI_API_KEY set - skipping TTS');
    return null;
  }

  try {
    const voice = PERSONA_VOICES[personaAlias] || 'nova';

    const mp3 = await ttsClient.audio.speech.create({
      model: 'tts-1',
      voice,
      input: text,
      response_format: 'mp3',
      speed: 1.0,
    });

    // Convert to base64 for sending to mobile app
    const buffer = Buffer.from(await mp3.arrayBuffer());
    const base64Audio = buffer.toString('base64');

    console.log('[kimi-bot] TTS ok (voice=' + voice + ', chars=' + text.length + ')');
    return {
      audio: base64Audio,
      format: 'mp3',
      voice,
      durationEstimate: Math.ceil(text.length / 15), // rough estimate: ~15 chars/sec
    };
  } catch (err) {
    console.error('[kimi-bot] TTS error:', err.message);
    return null;
  }
}

module.exports = { generateKimiResponse, generateAudioResponse, PERSONA_PROMPTS, GAME_DATA, PERSONA_VOICES };
