// src/services/circle-stages.js
const prisma = require('../db');

// Circle stage flow: forming -> chatting -> voice -> reveal -> connected
// forming/chatting are live from start. voice needs all opt-in. reveal needs all 3 text + 3 voice.

async function getCircleStatus(circleId, userId) {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    include: { members: { where: { isActive: true } } },
  });
  if (!circle) return { error: 'Circle not found' };

  const members = circle.members;
  const total = members.length;
  const me = members.find(m => m.userId === userId);

  // Voice stage gate: ALL members opted in
  const optedIn = members.filter(m => m.voiceOptIn).length;
  const voiceCanOpen = total > 0 && optedIn === total;

  // Reveal gate: ALL members have 3+ text AND 3+ voice
  const qualified = members.filter(m => m.textCount >= 3 && m.voiceCount >= 3).length;
  const revealCanOpen = total > 0 && qualified === total;

  // Selfie status
  const selfiesSubmitted = members.filter(m => m.selfiePhoto).length;
  const allSelfiesIn = total > 0 && selfiesSubmitted === total;

  return {
    circleId: circle.id,
    name: circle.name,
    stage: circle.stage,
    status: circle.status,
    voiceStageOpen: circle.voiceStageOpen,
    revealReady: circle.revealReady,
    totalMembers: total,
    voice: {
      optedIn: optedIn,
      total: total,
      canOpen: voiceCanOpen,
      myOptIn: me ? me.voiceOptIn : false,
    },
    reveal: {
      qualified: qualified,
      total: total,
      canOpen: revealCanOpen,
      myTextCount: me ? me.textCount : 0,
      myVoiceCount: me ? me.voiceCount : 0,
      textNeeded: 3,
      voiceNeeded: 3,
      selfiesSubmitted: selfiesSubmitted,
      allSelfiesIn: allSelfiesIn,
      mySelfieSubmitted: me ? !!me.selfiePhoto : false,
    },
    members: members.map(m => ({
      userId: m.userId,
      alias: m.alias,
      voiceOptIn: m.voiceOptIn,
      textCount: m.textCount,
      voiceCount: m.voiceCount,
      qualified: m.textCount >= 3 && m.voiceCount >= 3,
      selfieSubmitted: !!m.selfiePhoto,
      revealDecision: m.revealDecision,
    })),
  };
}

module.exports = { getCircleStatus };
