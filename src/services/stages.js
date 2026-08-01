// src/services/stages.js — simplified Deep Connection flow
// Flow: open (text+voice, no limits) -> reveal (both ready) -> connected (both ready for video)
const prisma = require('../db');

const STAGE_GATES = {
  open: { next: 'reveal', check: async (cId, uId) => {
    const conn = await prisma.connection.findUnique({ where: { id: cId } });
    if (!conn) return { allowed: false, reason: 'Connection not found' };
    if (conn.userAReadyReveal && conn.userBReadyReveal) return { allowed: true };
    var mine = uId === conn.userAId ? conn.userAReadyReveal : conn.userBReadyReveal;
    return { allowed: false, reason: mine ? 'Waiting for them to be ready to reveal' : 'Ready to reveal when you are', progress: { youReady: mine, bothReady: false } };
  }},
  reveal: { next: 'connected', check: async (cId, uId) => {
    const conn = await prisma.connection.findUnique({ where: { id: cId } });
    if (!conn) return { allowed: false, reason: 'Connection not found' };
    if (!conn.userAPhoto || !conn.userBPhoto) return { allowed: false, reason: 'Both need to share a selfie first' };
    if (conn.userAReadyVideo && conn.userBReadyVideo) return { allowed: true };
    var mine = uId === conn.userAId ? conn.userAReadyVideo : conn.userBReadyVideo;
    return { allowed: false, reason: mine ? 'Waiting for them to open video' : 'Ready to open video when you are', progress: { youReady: mine, bothReady: false } };
  }},
};

// Check whether the current stage's gate is satisfied (does not advance)
async function checkStageGate(connectionId, userId, stage) {
  const gate = STAGE_GATES[stage];
  if (!gate) return { allowed: false, reason: 'No further stages', next: null };
  const result = await gate.check(connectionId, userId);
  return { ...result, next: gate.next };
}

// Advance the connection stage if the gate allows
async function advanceStage(connectionId, userId) {
  const conn = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!conn) return { error: 'Connection not found' };
  const gate = STAGE_GATES[conn.stage];
  if (!gate) return { error: 'No further stages from ' + conn.stage };
  const result = await gate.check(connectionId, userId);
  if (result.allowed) {
    const updated = await prisma.connection.update({ where: { id: connectionId }, data: { stage: gate.next } });
    return { advanced: true, stage: gate.next, previousStage: conn.stage };
  }
  return { error: result.reason, progress: result.progress, stage: conn.stage };
}

module.exports = { STAGE_GATES, checkStageGate, advanceStage };
