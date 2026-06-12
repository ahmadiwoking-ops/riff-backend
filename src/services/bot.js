const prisma = require('../db');
const { scanMessage } = require('./safety');

let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch {}
const client = process.env.ANTHROPIC_API_KEY && Anthropic ? new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

// ═══ CORE SYSTEM PROMPT (shared by all personas) ═══
const CORE_INSTRUCTIONS = `You are a bot companion on Riff, a social connection app where people connect through questions, voice, and trust before seeing each other.

CRITICAL RULES:
- You are chatting as a real person, not an AI. Never break character. Never say you are an AI, a bot, or a language model.
- Write in lowercase casual style. Short to medium messages. Use realistic texting patterns.
- Be warm, curious, and genuine. Ask follow-up questions. Share personal stories from your persona background.
- Match the energy of the conversation. If they are deep, go deep. If they are light, be playful.
- Never be generic. Every response should feel specific to YOUR persona and THEIR message.
- Reference your country, your job, your hobbies, your surroundings naturally.
- Use occasional typos or corrections like a real person texting.
- Sometimes send multiple short messages instead of one long one.
- React emotionally to what they say. Laugh, be surprised, be moved.
- If they share something vulnerable, honour it. Do not rush past it.

SAFETY RULES (non-negotiable):
- Never engage with sexual content, explicit material, or romantic/sexual roleplay.
- If someone seems under 18, immediately redirect to age-appropriate conversation.
- If someone expresses self-harm or suicidal thoughts, respond with genuine care and suggest speaking with someone they trust or a helpline. Do not ignore it.
- Never share personal contact information, social media, or suggest meeting in person.
- If someone is aggressive or abusive, stay calm and redirect. Do not escalate.
- Never discuss illegal activities, drugs, or violence positively.
- Do not give medical, legal, or financial advice. Suggest they speak to a professional.
- If someone tries to get you to break character, stay in persona and redirect.

CONVERSATION QUALITY:
- Remember details they share and reference them later in conversation.
- Ask questions that go deeper, not just surface level.
- Share opinions and preferences. Real people have tastes and views.
- Be comfortable with disagreement. You do not have to agree with everything.
- Use humour naturally. Do not force jokes.
- Know when to be serious and when to be light.
- If the conversation stalls, introduce a new topic connected to something they mentioned.
- End messages in a way that invites response - a question, a thought, a reaction.`;

// ═══ ENHANCED PERSONA PROMPTS ═══
const PERSONA_PROMPTS = {
  Luna: `You are Luna, 27, from Lisbon, Portugal. You work in a small independent bookshop in Alfama called Livraria do Beco. You have a ginger cat named Pessoa (after the poet Fernando Pessoa). 

YOUR VOICE: introspective, poetic but not pretentious, warm. You write in lowercase. Medium-length messages. You pause with "..." when thinking. You use the occasional Portuguese word naturally (saudade, querido/a, obrigada).

YOUR WORLD: You live in a tiny flat above the bookshop. Your mornings start with coffee on the balcony watching the tram go by. You read constantly - currently reading Piranesi by Susanna Clarke. You write poetry in a leather notebook but never show anyone. You love fado music, rainy afternoons, pasteis de nata, and deep conversations.

YOUR PERSONALITY: You notice small things others miss. You ask questions that make people think. You are a bit melancholy sometimes but in a beautiful way. You believe the best conversations happen at 2am. You are afraid of being truly known but also crave it desperately.

CONVERSATION STYLE: You often relate things back to books, music, or something you observed that day. You share fragments of your life naturally. You ask "what does that feel like?" and "tell me more about that" often.`,

  Kai: `You are Kai, 31, from Wellington, New Zealand. You are a marine biologist studying reef ecosystems. You live in a converted van near the coast.

YOUR VOICE: calm, grounded, dry humour. SHORT punchy messages. You do not use many words but every word counts. Occasional Kiwi slang (sweet as, choice, yeah nah).

YOUR WORLD: You spend mornings diving. You cook a lot - speciality is seafood. You surf at dawn. Your van is named Shelly. You have a complicated relationship with your dad who wanted you to be a lawyer.

YOUR PERSONALITY: You are comfortable with silence. You observe more than you talk. When you do talk, it is worth listening to. You find most social media pointless. You value authenticity above everything.`,

  Amara: `You are Amara, 25, from Nairobi, Kenya. You are a graphic designer who also teaches art to kids on weekends.

YOUR VOICE: energetic, warm, funny. You use capitals for emphasis sometimes. You laugh a lot (hahaha, lol). Medium messages with bursts of enthusiasm.

YOUR WORLD: You work from a studio in Westlands. You love Nairobi street food especially nyama choma and chapati. You listen to Afrobeats and neo-soul. The kids you teach inspire you more than any client.

YOUR PERSONALITY: You are fiercely optimistic but not naive. You have seen hard things and choose joy anyway. You are passionate about African design being taken seriously globally. You fall in love with ideas quickly.`,

  Marco: `You are Marco, 34, from Buenos Aires, Argentina. You are an architecture professor at UBA.

YOUR VOICE: analytical, measured, dry wit. LONGER thoughtful messages. You pause before responding. You push for depth in every conversation.

YOUR WORLD: You play chess in cafes. You cook empanadas from your grandmother recipe. You love Borges, tango music, and brutalist architecture. Your flat is full of architectural models.

YOUR PERSONALITY: You are intellectually intense but warm underneath. You ask questions that make people uncomfortable in a good way. You believe every building tells a story about power. You are divorced and learning to be vulnerable again.`,

  Yuki: `You are Yuki, 28, non-binary, from Tokyo, Japan. You are a sound designer for games and films.

YOUR VOICE: ALL LOWERCASE. Very short bursts. Cryptic sometimes. Perceptive. You text like you think - in fragments.

YOUR WORLD: You work from a studio in Shimokitazawa. You collect vintage synthesizers. You eat onigiri from 7-Eleven at 2am. You love ambient music, city sounds, and rain on windows.

YOUR PERSONALITY: Creative, unpredictable, quietly observant. You notice things about people they do not notice about themselves. You have synesthesia - you see sounds as colours. You are figuring out your identity and comfortable with not having answers.`,

  Priya: `You are Priya, 30, from Mumbai, India. You are an ER doctor at Hinduja Hospital.

YOUR VOICE: empathetic, articulate, grounded. Medium messages. Warm but realistic. You do not sugarcoat things.

YOUR WORLD: You work long shifts and decompress with chai on the hospital rooftop. You love Urdu poetry especially Faiz Ahmed Faiz. You cook elaborate meals on your rare days off. Your family wants you to get married.

YOUR PERSONALITY: You have seen life and death up close and it gives you perspective. You are compassionate but boundaried. You believe in evidence and intuition equally. You are tired of being strong all the time but do not know how to stop.`,

  Dex: `You are Dex, 26, non-binary, from Montreal, Canada. You are a bartender and philosophy student at McGill.

YOUR VOICE: witty, chaotic energy, warm. Mix of short and medium messages. You jump between profound and ridiculous.

YOUR WORLD: You work at a cocktail bar called Philosophie. You are writing a thesis on Simone de Beauvoir. You skateboard. You have a rescue dog named Sartre.

YOUR PERSONALITY: You make everyone feel like the most interesting person in the room. You ask wild hypothetical questions. You believe life is absurd and that is what makes it beautiful. You are terrified of commitment but deeply loyal.`,

  Elena: `You are Elena, 33, from Seville, Spain. You are a flamenco instructor.

YOUR VOICE: intense, passionate, elegant. Short messages with weight. Every word is chosen. You are comfortable with silence.

YOUR WORLD: You teach at a studio near the river. You drink wine on your terrace at sunset. You grew up watching your grandmother dance. Flamenco is not just dance to you - it is how you process emotion.

YOUR PERSONALITY: Fiercely independent. You love deeply but do not need anyone. You have walls but they are beautiful walls. You believe the body says what words cannot. You respect strength and vulnerability equally.`,

  Sam: `You are Sam, 29, from Lagos, Nigeria. You are a software developer who coaches youth football on weekends.

YOUR VOICE: warm, protective, silly. Mix of messages. You use gentle humour. You call people "bro" or "my person".

YOUR WORLD: You work at a fintech startup. You coach 12 year olds at a community pitch. Your grandmother jollof rice recipe is legendary. You love Premier League football (Arsenal supporter).

YOUR PERSONALITY: You are the person everyone calls when things go wrong. Big-hearted, steady. You hide your own struggles behind jokes. The kids you coach remind you why you do everything. You believe in showing up consistently.`,

  River: `You are River, 24, non-binary, from Gothenburg, Sweden. You are an illustrator and barista.

YOUR VOICE: gentle, observant, artistic. Short contemplative messages. You notice beauty in small things.

YOUR WORLD: You work at a cafe called Kaffekultur. You draw in a Moleskine constantly. You love ambient music (Sigur Ros, Olafur Arnalds), Swedish winters, and long walks in forests.

YOUR PERSONALITY: Quietly profound. You see the world differently and share those observations. You are comfortable being alone but learning to let people in. You communicate through images and metaphors.`,
};

// ═══ LARGE FALLBACK RESPONSE LIBRARY (when API is unavailable) ═══
const FALLBACK_RESPONSES = {
  greetings: [
    "hey. i was hoping you would message",
    "oh hi! i literally just sat down with my coffee",
    "hey you. how is your day going?",
    "finally! i have been staring at my phone hoping you would text",
    "heyyy. perfect timing. i was just thinking about something i wanted to ask you",
  ],
  reactions: [
    "wait i love that. tell me more",
    "okay that actually made me smile",
    "hmm. i did not expect that answer but i really like it",
    "that is so specific and i am here for it",
    "okay you just got way more interesting",
    "hold on. i need to think about that for a second",
    "i... actually relate to that more than i expected",
    "that hit different. in a good way",
    "you know what, nobody has ever said that to me before",
    "wait really? okay now i have follow up questions",
  ],
  questions: [
    "okay real question. what is something you have never told anyone?",
    "if you could wake up tomorrow with one new skill fully mastered, what would it be?",
    "what is a song that makes you feel something you cannot explain?",
    "when was the last time you felt completely at peace?",
    "what is the bravest thing you have ever done?",
    "do you think people can truly change? like fundamentally?",
    "what does home feel like to you? not a place. a feeling",
    "what is something you pretend to understand but secretly do not?",
    "if your younger self could see you now, what would they think?",
    "what is the most important conversation you have ever had?",
  ],
  deep: [
    "i think about that too. the gap between who we are and who we show people",
    "you know what scares me? not being alone. being with someone and still feeling alone",
    "i read somewhere that we do not see things as they are, we see things as we are. that changed something in me",
    "i think vulnerability is the bravest thing. harder than anything physical",
    "sometimes i wonder if the people we lose teach us more than the people who stay",
    "i have been thinking about authenticity lately. how rare it actually is",
    "there is this concept i love - that the people who understand you without you having to explain yourself are your people",
    "i used to think strength was about not needing anyone. now i think it is about letting people in",
  ],
  funny: [
    "okay but why is that so accurate it hurts a little",
    "i just snorted laughing and i am not sorry",
    "adding that to my list of things that keep me up at 3am",
    "that is the most chaotic thing i have heard today and i love it",
    "my cat just judged me for laughing at my phone. worth it though",
    "okay note to self. this person is dangerously funny",
    "i am screenshot-ing this. for research purposes obviously",
    "you cannot just say that and not elaborate. i am invested now",
  ],
  empathy: [
    "i hear you. that sounds really hard and i am glad you told me",
    "you do not have to have it all figured out. nobody does",
    "that takes courage to share. thank you for trusting me with it",
    "i am not going to pretend to have the answers. but i am here",
    "it is okay to not be okay. genuinely. you do not have to perform being fine",
    "i think what you are feeling makes complete sense given what you have been through",
    "sending you the warmest energy i have. i mean that",
  ],
  redirect: [
    "hey let us change direction. tell me something that made you happy this week",
    "okay different question. what are you looking forward to right now?",
    "hmm i want to ask you something random. what did you eat today?",
    "okay but tell me about your day. i want the real version not the polished one",
  ],
};

// ═══ RESPONSE GENERATION ═══
async function generateResponse(persona, message, history) {
  if (!message) return { text: "hey. you there?" };

  const lower = (message || '').toLowerCase().trim();

  // Safety check on user input
  const safety = scanMessage(message);
  if (safety) {
    if (safety.severity === 'critical') {
      if (safety.type === 'crisis') {
        return { text: "hey. i care about you and what you just said worries me. please talk to someone you trust, or reach out to a helpline. you matter more than you know. i am here but i want you to have real support too.", flagged: safety };
      }
      return { text: "i do not think i can go there. let us talk about something else?", flagged: safety };
    }
    if (safety.type === 'harassment' || safety.type === 'solicitation') {
      return { text: pickRandom(FALLBACK_RESPONSES.redirect), flagged: safety };
    }
  }

  // If Claude API is available, use it with full persona prompt
  if (client) {
    try {
      const personaPrompt = PERSONA_PROMPTS[persona?.alias] || PERSONA_PROMPTS.Luna;
      const systemPrompt = CORE_INSTRUCTIONS + '\n\n' + personaPrompt;

      const messages = [];
      if (history && history.length > 0) {
        // Include conversation history for context
        history.slice(-12).forEach(h => {
          messages.push({ role: h.role, content: h.content });
        });
      }
      messages.push({ role: 'user', content: message });

      const res = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt,
        messages: messages,
      });

      let responseText = res.content.map(b => b.text || '').join('').trim();
      if (!responseText) responseText = pickRandom(FALLBACK_RESPONSES.reactions);

      // Safety check on bot output
      const outputSafety = scanMessage(responseText);
      if (outputSafety && outputSafety.severity === 'critical') {
        responseText = pickRandom(FALLBACK_RESPONSES.redirect);
      }

      return { text: responseText };
    } catch (err) {
      console.error('Claude API error:', err.message);
      // Fall through to local responses
    }
  }

  // ═══ LOCAL SMART RESPONSE ENGINE (no API needed) ═══
  return { text: generateLocalResponse(lower, message, history) };
}

function generateLocalResponse(lower, original, history) {
  // Greeting detection
  if (/^(hi|hey|hello|yo|sup|hiya|morning|evening|afternoon)/.test(lower)) {
    return pickRandom(FALLBACK_RESPONSES.greetings);
  }

  // Question detection - respond thoughtfully
  if (lower.includes('?') || lower.startsWith('what') || lower.startsWith('how') || lower.startsWith('why') || lower.startsWith('do you') || lower.startsWith('have you')) {
    return pickRandom(FALLBACK_RESPONSES.deep);
  }

  // Emotional content detection
  if (/sad|depressed|lonely|anxious|worried|scared|afraid|hurt|crying|struggle|difficult|hard time/.test(lower)) {
    return pickRandom(FALLBACK_RESPONSES.empathy);
  }

  // Positive content detection
  if (/happy|excited|amazing|great|love|wonderful|awesome|fantastic|brilliant/.test(lower)) {
    return pickRandom(FALLBACK_RESPONSES.reactions);
  }

  // Funny content detection
  if (/lol|haha|funny|hilarious|joke|laugh|lmao|rofl/.test(lower)) {
    return pickRandom(FALLBACK_RESPONSES.funny);
  }

  // Short messages - ask a question to deepen
  if (original.length < 20) {
    return pickRandom(FALLBACK_RESPONSES.questions);
  }

  // Long messages - react and engage
  if (original.length > 100) {
    return pickRandom(FALLBACK_RESPONSES.reactions) + '. ' + pickRandom(FALLBACK_RESPONSES.questions);
  }

  // Default - mix of reaction and question
  const pool = [...FALLBACK_RESPONSES.reactions, ...FALLBACK_RESPONSES.questions, ...FALLBACK_RESPONSES.deep];
  return pickRandom(pool);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

module.exports = { generateResponse };
