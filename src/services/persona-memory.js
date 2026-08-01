// src/services/persona-memory.js — rolling summary memory, independent of persona code
const prisma = require('../db');
const OpenAI = require('openai');

const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k2.6';
let memClient = null;
if (process.env.MOONSHOT_API_KEY) {
  memClient = new OpenAI({ apiKey: process.env.MOONSHOT_API_KEY, baseURL: 'https://api.moonshot.ai/v1' });
}

// Load the stored memory summary for this user+persona
async function loadMemory(userId, persona) {
  try {
    var mem = await prisma.personaMemory.findFirst({ where: { userId: userId, persona: persona } });
    return mem ? mem.summary : '';
  } catch (e) { return ''; }
}

// Update the memory summary from the conversation history (called periodically)
async function updateMemory(userId, persona, conversationHistory) {
  if (!memClient) return;
  try {
    var existing = await prisma.personaMemory.findFirst({ where: { userId: userId, persona: persona } });
    var priorSummary = existing ? existing.summary : '';
    var msgCount = (conversationHistory || []).length;

    // Only update every ~15 messages to save cost
    if (existing && (msgCount - existing.lastMsgCount) < 15) return;

    // Build a transcript of the conversation
    var transcript = (conversationHistory || []).slice(-60).map(function(h) {
      return (h.role === 'assistant' ? 'Them' : 'User') + ': ' + h.content;
    }).join('\n');

    var prompt = 'You are maintaining a memory note about a person based on their conversation. ' +
      'Below is the existing memory note (may be empty) and the recent conversation. ' +
      'Update the memory note to capture durable, important facts about the USER: their name, job, goals, relationships, preferences, ongoing situations, and anything they would expect to be remembered. ' +
      'Keep it concise (under 200 words), factual, third-person, bullet-style. Do NOT include small talk or the assistant\\'s details.\\n\\n' +
      'EXISTING MEMORY NOTE:\\n' + (priorSummary || '(none yet)') + '\\n\\nRECENT CONVERSATION:\\n' + transcript + '\\n\\nUPDATED MEMORY NOTE:';

    var res = await memClient.chat.completions.create({
      model: KIMI_MODEL,
      max_tokens: 400,
      temperature: 1,
      messages: [{ role: 'user', content: prompt }],
    });
    var summary = res.choices && res.choices[0] && res.choices[0].message ? (res.choices[0].message.content || '').trim() : '';
    if (!summary) return;

    await prisma.personaMemory.upsert({
      where: { userId_persona: { userId: userId, persona: persona } },
      update: { summary: summary, lastMsgCount: msgCount },
      create: { userId: userId, persona: persona, summary: summary, lastMsgCount: msgCount },
    });
  } catch (e) {
    console.log('[persona-memory] update error: ' + (e.message || e));
  }
}

module.exports = { loadMemory, updateMemory };
