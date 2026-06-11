const prisma = require('../db');
const STAGE_GATES = {
  questioning: { next: 'voice', check: async (cId, uId) => {
    const conn = await prisma.connection.findUnique({ where: { id: cId } });
    const days = (Date.now() - new Date(conn.createdAt).getTime()) / 86400000;
    const msgs = await prisma.message.count({ where: { connectionId: cId, type: 'text' } });
    if (days >= 3 || msgs >= 50) return { allowed: true, progress: { days: Math.floor(days), messages: msgs } };
    return { allowed: false, reason: 'Keep chatting to unlock voice', progress: { days: Math.floor(days), daysNeeded: 3, messages: msgs, messagesNeeded: 50, daysRemaining: Math.max(0, Math.ceil(3 - days)), messagesRemaining: Math.max(0, 50 - msgs) } };
  }},
  voice: { next: 'scoring', check: async (cId, uId) => {
    const conn = await prisma.connection.findUnique({ where: { id: cId } });
    const other = conn.userAId === uId ? conn.userBId : conn.userAId;
    const yours = await prisma.voiceMessage.count({ where: { connectionId: cId, senderId: uId } });
    const theirs = await prisma.voiceMessage.count({ where: { connectionId: cId, senderId: other } });
    if (yours >= 5 && theirs >= 5) return { allowed: true };
    return { allowed: false, reason: 'Exchange more voice messages', progress: { yourVoices: yours, theirVoices: theirs, yourRemaining: Math.max(0, 5 - yours), theirRemaining: Math.max(0, 5 - theirs) } };
  }},
  scoring: { next: 'reveal', check: async (cId) => {
    const conn = await prisma.connection.findUnique({ where: { id: cId } });
    if (conn.userAVoiceAvg >= 4 && conn.userBVoiceAvg >= 4) return { allowed: true };
    return { allowed: false, reason: 'Both voices need 4/5+ to unlock reveal' };
  }},
  reveal: { next: 'chapters', check: async (cId) => {
    const conn = await prisma.connection.findUnique({ where: { id: cId } });
    if (!conn.revealedAt) return { allowed: false, reason: 'Complete photo reveal first' };
    if (conn.userADecision !== 'continue' || conn.userBDecision !== 'continue') return { allowed: false, reason: 'Waiting for decisions' };
    const hrs = (Date.now() - new Date(conn.revealedAt).getTime()) / 3600000;
    if (hrs >= 24) return { allowed: true };
    return { allowed: false, reason: 'Reflection period — ' + Math.ceil(24 - hrs) + ' hours remaining', progress: { hoursRemaining: Math.ceil(24 - hrs) } };
  }},
  chapters: { next: 'connected', check: async (cId, uId) => {
    const conn = await prisma.connection.findUnique({ where: { id: cId } });
    const other = conn.userAId === uId ? conn.userBId : conn.userAId;
    const yours = await prisma.lifeChapter.count({ where: { userId: uId, connectionId: cId, isShared: true } });
    const theirs = await prisma.lifeChapter.count({ where: { userId: other, connectionId: cId, isShared: true } });
    if (yours >= 3 && theirs >= 3) return { allowed: true };
    return { allowed: false, reason: 'Share more Life Chapters', progress: { yourChapters: yours, theirChapters: theirs, yourRemaining: Math.max(0, 3 - yours), theirRemaining: Math.max(0, 3 - theirs) } };
  }},
};
async function checkStageGate(cId, uId, stage) { const g = STAGE_GATES[stage]; return g ? g.check(cId, uId) : { allowed: false, reason: 'Unknown stage' }; }
async function advanceStage(cId, uId) {
  const conn = await prisma.connection.findUnique({ where: { id: cId } });
  const g = STAGE_GATES[conn.stage]; if (!g) return { error: 'Already at final stage' };
  const check = await g.check(cId, uId); if (!check.allowed) return { error: check.reason, progress: check.progress };
  const updated = await prisma.connection.update({ where: { id: cId }, data: { stage: g.next } });
  return { connection: updated, newStage: g.next };
}
module.exports = { checkStageGate, advanceStage };
