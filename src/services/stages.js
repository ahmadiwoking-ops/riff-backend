const prisma = require('../db');
const STAGE_GATES = {
  // Text/questioning -> voice: 50 messages or 3 days
  questioning: { next: 'voice', check: async (cId, uId) => {
    const conn = await prisma.connection.findUnique({ where: { id: cId } });
    const days = (Date.now() - new Date(conn.createdAt).getTime()) / 86400000;
    const msgs = await prisma.message.count({ where: { connectionId: cId, type: 'text' } });
    if (days >= 3 || msgs >= 50) return { allowed: true, progress: { days: Math.floor(days), messages: msgs } };
    return { allowed: false, reason: 'Keep chatting to unlock voice', progress: { days: Math.floor(days), daysNeeded: 3, messages: msgs, messagesNeeded: 50, daysRemaining: Math.max(0, Math.ceil(3 - days)), messagesRemaining: Math.max(0, 50 - msgs) } };
  }},
  // Voice -> scoring: both users 5+ voice messages
  voice: { next: 'scoring', check: async (cId, uId) => {
    const conn = await prisma.connection.findUnique({ where: { id: cId } });
    const other = conn.userAId === uId ? conn.userBId : conn.userAId;
    const yours = await prisma.message.count({ where: { connectionId: cId, senderId: uId, type: 'voice' } });
    const theirs = await prisma.message.count({ where: { connectionId: cId, senderId: other, type: 'voice' } });
    if (yours >= 5 && theirs >= 5) return { allowed: true };
    return { allowed: false, reason: 'Exchange more voice messages', progress: { yourVoices: yours, theirVoices: theirs, yourRemaining: Math.max(0, 5 - yours), theirRemaining: Math.max(0, 5 - theirs) } };
  }},
  // Scoring -> reveal: both voice avg 4+
  scoring: { next: 'reveal', check: async (cId) => {
    const conn = await prisma.connection.findUnique({ where: { id: cId } });
    if (conn.userAVoiceAvg >= 4 && conn.userBVoiceAvg >= 4) return { allowed: true };
    return { allowed: false, reason: 'Both voices need 4/5+ to unlock reveal' };
  }},
  // Reveal -> video: both submitted selfies, both chose continue
  reveal: { next: 'video', check: async (cId, uId) => {
    const conn = await prisma.connection.findUnique({ where: { id: cId } });
    if (!conn.userAPhoto || !conn.userBPhoto) return { allowed: false, reason: 'Both need to submit a selfie first' };
    if (!conn.revealedAt) return { allowed: false, reason: 'Complete the photo reveal first' };
    if (conn.userADecision !== 'continue' || conn.userBDecision !== 'continue') {
      return { allowed: false, reason: 'Waiting for both to choose to continue' };
    }
    return { allowed: true };
  }},
  // Video -> connected: 3 days passed AND both final-decided continue
  video: { next: 'connected', check: async (cId, uId) => {
    const conn = await prisma.connection.findUnique({ where: { id: cId } });
    if (!conn.videoStartedAt) return { allowed: false, reason: 'Start your video connection first' };
    const hrs = (Date.now() - new Date(conn.videoStartedAt).getTime()) / 3600000;
    if (hrs < 72) {
      return { allowed: false, reason: 'Spend time connecting over video', progress: { hoursRemaining: Math.ceil(72 - hrs), daysRemaining: Math.ceil((72 - hrs) / 24) } };
    }
    // 3 days passed - need both final decisions
    if (conn.userAFinalDecision !== 'continue' || conn.userBFinalDecision !== 'continue') {
      return { allowed: false, reason: 'Decide whether to continue or end the connection', needsFinalDecision: true };
    }
    return { allowed: true };
  }},
};
async function checkStageGate(cId, uId, stage) { const g = STAGE_GATES[stage]; return g ? g.check(cId, uId) : { allowed: false, reason: 'Unknown stage' }; }
async function advanceStage(cId, uId) {
  const conn = await prisma.connection.findUnique({ where: { id: cId } });
  const g = STAGE_GATES[conn.stage]; if (!g) return { error: 'Already at final stage' };
  const check = await g.check(cId, uId); if (!check.allowed) return { error: check.reason, progress: check.progress };
  var updateData = { stage: g.next };
  // When entering video stage, start the 3-day timer
  if (g.next === 'video') updateData.videoStartedAt = new Date();
  const updated = await prisma.connection.update({ where: { id: cId }, data: updateData });
  return { connection: updated, newStage: g.next };
}
module.exports = { checkStageGate, advanceStage };
