const prisma = require('../db');
const bcrypt = require('bcryptjs');
const { checkStageGate, advanceStage } = require('../services/stages');
const { getLimits } = require('../services/plan-limits');
const { calculateMatchScore, toArr } = require('./questions');

async function connectionRoutes(app) {
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.id;
    var all = await prisma.connection.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      include: { userA: { select: { id: true, alias: true, trustScore: true, idVerified: true, avatarEmoji: true, avatarColour: true, displayPhoto: true, area: true, shareLocation: true } }, userB: { select: { id: true, alias: true, trustScore: true, idVerified: true, avatarEmoji: true, avatarColour: true, displayPhoto: true, area: true, shareLocation: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    // Answer vectors for the breakdown shown on each active card.
    var me = await prisma.user.findUnique({ where: { id: userId }, select: { matchVector: true, connectionType: true } });
    var myVector = me && me.matchVector ? me.matchVector.answers : null;
    var myType = me ? me.connectionType : 'all';
    var otherIds = all.filter(function (x) { return x.isActive; }).map(function (x) { return x.userAId === userId ? x.userBId : x.userAId; });
    var vectors = {};
    if (myVector && otherIds.length) {
      var rows = await prisma.user.findMany({ where: { id: { in: otherIds } }, select: { id: true, matchVector: true } });
      rows.forEach(function (r) { if (r.matchVector && r.matchVector.answers) vectors[r.id] = r.matchVector.answers; });
    }

    // Split into active and ended (ended = recoverable via Connect back)
    var active = all.filter(function(c) { return c.isActive; }).map(function(c) {
      // Give active connections the same shape as ended: a resolved `other`.
      var other = c.userAId === userId ? c.userB : c.userA;
      var bd = null;
      try {
        var mv = vectors[other.id];
        if (myVector && mv) bd = calculateMatchScore(toArr(myVector), toArr(mv), myType || 'all').breakdown;
      } catch (e) { bd = null; }
      return Object.assign({}, c, { other: other, score: Math.round(c.compatScore || 0), breakdown: bd });
    });
    var ended = all.filter(function(c) { return !c.isActive && c.stage === 'ended'; }).map(function(c) {
      var iAmA = c.userAId === userId;
      return {
        id: c.id,
        other: iAmA ? c.userB : c.userA,
        stageBeforeEnd: c.stageBeforeEnd,
        endReason: c.endReason,
        endedAt: c.endedAt,
        myReconnect: iAmA ? c.userAReconnect : c.userBReconnect,
        theirReconnect: iAmA ? c.userBReconnect : c.userAReconnect,
      };
    });
    return { connections: active, ended: ended };
  });

  app.get('/:id', { preHandler: [app.authenticate] }, async (request) => {
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id }, include: { userA: { select: { id: true, alias: true, trustScore: true, idVerified: true } }, userB: { select: { id: true, alias: true, trustScore: true, idVerified: true } } } });
    if (!conn) return { error: 'Not found' };
    const stageCheck = await checkStageGate(conn.id, request.user.id, conn.stage);
    return { connection: conn, stageProgress: stageCheck };
  });

  app.get('/:id/check-advance', { preHandler: [app.authenticate] }, async (request) => {
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return { error: 'Not found' };
    return { currentStage: conn.stage, ...(await checkStageGate(conn.id, request.user.id, conn.stage)) };
  });

  app.post('/:id/advance', { preHandler: [app.authenticate] }, async (request) => {
    const result = await advanceStage(request.params.id, request.user.id);
    return result.error ? { error: result.error, progress: result.progress } : result;
  });

  app.post('/test-match', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.id;
      let testUser = await prisma.user.findUnique({ where: { email: 'luna-bot@riff.app' } });
      if (!testUser) {
        testUser = await prisma.user.create({ data: { email: 'luna-bot@riff.app', alias: 'MysteryMatch', age: 27, gender: 'Female', seekingGender: 'No preference', connectionType: 'both', passwordHash: await bcrypt.hash('testpassword123', 12), trustScore: 'green', idVerified: true, selfieVerified: true, phoneVerified: true } });
      }
      const existing = await prisma.connection.findFirst({ where: { OR: [{ userAId: userId, userBId: testUser.id }, { userAId: testUser.id, userBId: userId }], isActive: true } });
      if (existing) return { connection: existing, message: 'Match exists' };
      const connection = await prisma.connection.create({ data: { userAId: userId, userBId: testUser.id, compatScore: 78 + Math.random() * 15, stage: 'questioning', isPractice: false } });
      return { connection, message: 'Test match created' };
    } catch (err) { app.log.error(err); return reply.status(500).send({ error: 'Failed: ' + err.message }); }
  });

  // Post-reveal decision (continue or fade)
  app.post('/:id/decision', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { decision } = request.body;
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.status(404).send({ error: 'Not found' });
    const field = conn.userAId === request.user.id ? 'userADecision' : 'userBDecision';
    const updated = await prisma.connection.update({ where: { id: conn.id }, data: { [field]: decision } });
    if (updated.userADecision && updated.userBDecision) {
      const both = updated.userADecision === 'continue' && updated.userBDecision === 'continue';
      if (both) {
        await prisma.connection.update({ where: { id: conn.id }, data: { stage: 'video', videoStartedAt: new Date() } });
        return { status: 'both_continue', message: 'You both chose to continue! Video connection unlocked.', advanced: true };
      } else {
        await prisma.connection.update({ where: { id: conn.id }, data: { stage: 'ended', isActive: false, endedAt: new Date(), endReason: 'faded' } });
        return { status: 'faded', message: 'One of you chose to fade. The connection has closed.', ended: true };
      }
    }
    return { status: 'waiting', message: 'Waiting for the other person to decide...' };
  });

  // Submit selfie for the reveal
  app.post('/:id/selfie', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { photo } = request.body;
    if (!photo) return reply.status(400).send({ error: 'photo required' });
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.status(404).send({ error: 'Not found' });
    const field = conn.userAId === request.user.id ? 'userAPhoto' : 'userBPhoto';
    const updated = await prisma.connection.update({ where: { id: conn.id }, data: { [field]: photo } });
    const bothSubmitted = !!(updated.userAPhoto && updated.userBPhoto);
    if (bothSubmitted && !updated.revealedAt) {
      await prisma.connection.update({ where: { id: conn.id }, data: { revealedAt: new Date(), revealReady: true } });
    }
    return { status: 'saved', bothSubmitted: bothSubmitted, message: bothSubmitted ? 'Both selfies in — get ready for the reveal!' : 'Selfie saved. Waiting for the other person...' };
  });

  // Get reveal photos (only returns once both submitted)
  app.get('/:id/reveal', { preHandler: [app.authenticate] }, async (request) => {
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return { error: 'Not found' };
    if (!conn.userAPhoto || !conn.userBPhoto) return { ready: false, message: 'Waiting for both selfies' };
    const isUserA = conn.userAId === request.user.id;
    return { ready: true, myPhoto: isUserA ? conn.userAPhoto : conn.userBPhoto, theirPhoto: isUserA ? conn.userBPhoto : conn.userAPhoto, revealedAt: conn.revealedAt };
  });

  // Get the Jitsi video room for this connection
  app.get('/:id/video-room', { preHandler: [app.authenticate] }, async (request) => {
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return { error: 'Not found' };
    // Unique deterministic room name both users share
    const room = 'riff-' + conn.id;
    const url = 'https://meet.jit.si/' + room + '#config.prejoinPageEnabled=false&config.requireDisplayName=false&config.enableLobbyChat=false&config.disableModeratorIndicator=true';
    // 3-day timer info
    var hoursLeft = null;
    if (conn.videoStartedAt) {
      const hrs = (Date.now() - new Date(conn.videoStartedAt).getTime()) / 3600000;
      hoursLeft = Math.max(0, Math.ceil(72 - hrs));
    }
    return { room: room, url: url, videoStartedAt: conn.videoStartedAt, hoursLeft: hoursLeft, decisionReady: hoursLeft === 0 };
  });

  // Final decision after 3 days of video (continue or end)
  app.post('/:id/final-decision', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { decision } = request.body;
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.status(404).send({ error: 'Not found' });
    const field = conn.userAId === request.user.id ? 'userAFinalDecision' : 'userBFinalDecision';
    const updated = await prisma.connection.update({ where: { id: conn.id }, data: { [field]: decision } });
    if (updated.userAFinalDecision && updated.userBFinalDecision) {
      const both = updated.userAFinalDecision === 'continue' && updated.userBFinalDecision === 'continue';
      if (both) {
        await prisma.connection.update({ where: { id: conn.id }, data: { stage: 'connected' } });
        return { status: 'connected', message: 'You both chose to continue! Full connection unlocked.', advanced: true };
      } else {
        await prisma.connection.update({ where: { id: conn.id }, data: { stage: 'ending', endReason: 'ended' } });
        return { status: 'ending', message: 'The connection is ending. You can send a final goodbye message.', ending: true };
      }
    }
    return { status: 'waiting', message: 'Waiting for the other person to decide...' };
  });

  // Send a goodbye message when ending
  app.post('/:id/goodbye', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { message } = request.body;
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.status(404).send({ error: 'Not found' });
    const field = conn.userAId === request.user.id ? 'userAGoodbye' : 'userBGoodbye';
    await prisma.connection.update({ where: { id: conn.id }, data: { [field]: message || '', stage: 'ended', isActive: false, endedAt: conn.endedAt || new Date() } });
    return { status: 'sent', message: 'Your goodbye has been sent. This connection is now closed.' };
  });

  // Get goodbye messages (both, once ended)
  app.get('/:id/goodbye', { preHandler: [app.authenticate] }, async (request) => {
    const conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return { error: 'Not found' };
    const isUserA = conn.userAId === request.user.id;
    return { myGoodbye: isUserA ? conn.userAGoodbye : conn.userBGoodbye, theirGoodbye: isUserA ? conn.userBGoodbye : conn.userAGoodbye, endReason: conn.endReason };
  });

  // ═══ NEW FLOW: mark ready to reveal ═══
  app.post('/:id/ready-reveal', { preHandler: [app.authenticate] }, async (request, reply) => {
    var conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.code(404).send({ error: 'Not found' });
    var field = request.user.id === conn.userAId ? 'userAReadyReveal' : 'userBReadyReveal';
    var updated = await prisma.connection.update({ where: { id: conn.id }, data: { [field]: true } });
    var both = updated.userAReadyReveal && updated.userBReadyReveal;
    if (both && updated.stage === 'open') {
      await prisma.connection.update({ where: { id: conn.id }, data: { stage: 'reveal' } });
    }
    return { status: 'ready', bothReady: both, message: both ? 'Both ready — take your selfies!' : 'Waiting for them to be ready to reveal' };
  });

  // ═══ NEW FLOW: mark ready to open video ═══
  app.post('/:id/ready-video', { preHandler: [app.authenticate] }, async (request, reply) => {
    var conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.code(404).send({ error: 'Not found' });
    if (!conn.userAPhoto || !conn.userBPhoto) return { status: 'waiting', bothReady: false, message: 'Both need to share a selfie first' };
    var field = request.user.id === conn.userAId ? 'userAReadyVideo' : 'userBReadyVideo';
    var updated = await prisma.connection.update({ where: { id: conn.id }, data: { [field]: true } });
    var both = updated.userAReadyVideo && updated.userBReadyVideo;
    if (both && updated.stage === 'reveal') {
      await prisma.connection.update({ where: { id: conn.id }, data: { stage: 'connected' } });
    }
    return { status: 'ready', bothReady: both, message: both ? 'Video unlocked — full connection!' : 'Waiting for them to open video' };
  });

  // ═══ NEW FLOW: change / retake profile photo ═══
  app.post('/:id/change-photo', { preHandler: [app.authenticate] }, async (request, reply) => {
    var photo = request.body.photo;
    if (!photo) return reply.code(400).send({ error: 'photo required' });
    var conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.code(404).send({ error: 'Not found' });
    var field = request.user.id === conn.userAId ? 'userAPhoto' : 'userBPhoto';
    await prisma.connection.update({ where: { id: conn.id }, data: { [field]: photo } });
    return { status: 'updated', message: 'Your photo has been updated.' };
  });

  // ═══ NEW FLOW: mark first video started (gates the fade option) ═══
  app.post('/:id/video-started', { preHandler: [app.authenticate] }, async (request, reply) => {
    var conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.code(404).send({ error: 'Not found' });
    var data = { videoStartedAt: conn.videoStartedAt || new Date() };
    if (!conn.firstVideoAt) data.firstVideoAt = new Date();
    await prisma.connection.update({ where: { id: conn.id }, data: data });
    return { status: 'started', firstVideo: !conn.firstVideoAt };
  });

  // ═══ NEW FLOW: fade the connection (self goodbye or bot-assisted) ═══
  app.post('/:id/fade', { preHandler: [app.authenticate] }, async (request, reply) => {
    var mode = request.body.mode; // 'self' or 'bot'
    var goodbyeText = request.body.goodbye;
    var conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.code(404).send({ error: 'Not found' });

    if (mode === 'self') {
      var gfield = request.user.id === conn.userAId ? 'userAGoodbye' : 'userBGoodbye';
      await prisma.connection.update({ where: { id: conn.id }, data: { [gfield]: goodbyeText || 'Thank you for the connection. Wishing you all the best.', fadeMode: 'self', fadeInitiatedBy: request.user.id, isActive: false, stageBeforeEnd: (conn.stage === 'fading' || conn.stage === 'ended') ? (conn.stageBeforeEnd || 'connected') : conn.stage, stage: 'ended', endedAt: new Date(), endReason: 'self_goodbye', userAReconnect: false, userBReconnect: false } });
      return { status: 'ended', message: 'Your goodbye has been shared. This connection is now closed.' };
    }

    if (mode === 'bot') {
      // Bot takes over: mark fading, step 0. Gradual messages sent via bot-goodbye-step.
      await prisma.connection.update({ where: { id: conn.id }, data: { fadeMode: 'bot', fadeInitiatedBy: request.user.id, stageBeforeEnd: conn.stage, stage: 'fading', botGoodbyeStep: 0, userAReconnect: false, userBReconnect: false } });
      return { status: 'fading', message: 'A gentle wind-down has begun. The connection will ease to a close over the next little while.' };
    }

    return reply.code(400).send({ error: 'Invalid fade mode' });
  });

  // ═══ NEW FLOW: advance the bot's gradual goodbye (called over time) ═══
  app.post('/:id/bot-goodbye-step', { preHandler: [app.authenticate] }, async (request, reply) => {
    var conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.code(404).send({ error: 'Not found' });
    if (conn.fadeMode !== 'bot' || conn.stage !== 'fading') return { status: conn.stage, done: conn.stage === 'ended' };

    var BOT_MESSAGES = [
      "hey — just wanted to say how much i've enjoyed getting to know you here. 💛",
      "life takes us in different directions sometimes, and that's okay. i think this connection has run its lovely course.",
      "no hard feelings at all — only gratitude for the conversations we shared.",
      "i'll let this be my goodbye. take care of yourself, and all the best on your journey. 🌿",
    ];
    var step = conn.botGoodbyeStep || 0;
    if (step >= BOT_MESSAGES.length) {
      await prisma.connection.update({ where: { id: conn.id }, data: { isActive: false, stage: 'ended', endedAt: new Date(), endReason: 'bot_goodbye' } });
      return { status: 'ended', done: true };
    }
    var text = BOT_MESSAGES[step];
    // Save as a system/bot message in the conversation
    await prisma.message.create({ data: { connectionId: conn.id, senderId: conn.fadeInitiatedBy || conn.userAId, content: text, type: 'bot_goodbye' } });
    var nextStep = step + 1;
    var done = nextStep >= BOT_MESSAGES.length;
    await prisma.connection.update({ where: { id: conn.id }, data: { botGoodbyeStep: nextStep, ...(done ? { isActive: false, stage: 'ended', endedAt: new Date(), endReason: 'bot_goodbye' } : {}) } });
    return { status: done ? 'ended' : 'fading', message: text, step: nextStep, done: done };
  });

  // ═══ Connect back (mutual) — recover an ended connection ═══
  app.post('/:id/reconnect', { preHandler: [app.authenticate] }, async (request, reply) => {
    var conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.code(404).send({ error: 'Not found' });
    if (conn.stage !== 'ended') return { status: 'active', message: 'This connection is still active.' };
    var field = request.user.id === conn.userAId ? 'userAReconnect' : 'userBReconnect';
    var updated = await prisma.connection.update({ where: { id: conn.id }, data: { [field]: true } });
    var both = updated.userAReconnect && updated.userBReconnect;
    if (both) {
      // reconnect cap check: don't exceed the plan's active-connection limit
      var reUser = await prisma.user.findUnique({ where: { id: request.user.id }, select: { plan: true, planExpiresAt: true } });
      var rePlan = reUser.plan || 'free';
      if (reUser.planExpiresAt && reUser.planExpiresAt < new Date()) rePlan = 'free';
      var reLimits = getLimits(rePlan);
      if (reLimits.deepConnections !== -1) {
        var reActive = await prisma.connection.count({ where: { OR: [{ userAId: request.user.id }, { userBId: request.user.id }], isActive: true } });
        if (reActive >= reLimits.deepConnections) {
          return { status: 'at_limit', message: 'You have reached your active connection limit. End another connection before reconnecting this one.' };
        }
      }
      var restoreStage = updated.stageBeforeEnd || 'connected';
      await prisma.connection.update({ where: { id: conn.id }, data: {
        stage: restoreStage, isActive: true,
        endedAt: null, endReason: null, fadeMode: null, fadeInitiatedBy: null,
        botGoodbyeStep: 0, userAReconnect: false, userBReconnect: false,
        userAGoodbye: null, userBGoodbye: null,
      } });
      return { status: 'reconnected', stage: restoreStage, message: 'You are connected again! Picking up where you left off.' };
    }
    var otherName = 'the other person';
    return { status: 'waiting', message: 'Waiting for ' + otherName + ' to connect back too.', bothReady: false };
  });

  // ═══ Twilio Video access token ═══
  // Replaces the Jitsi URL: that opened a public room outside the app, and any
  // holder of the connection id could join it. This is scoped to one room, one
  // identity, and expires in an hour.
  app.post('/:id/video-token', { preHandler: [app.authenticate] }, async (request, reply) => {
    var conn = await prisma.connection.findUnique({ where: { id: request.params.id } });
    if (!conn) return reply.code(404).send({ error: 'Connection not found.' });
    if (conn.userAId !== request.user.id && conn.userBId !== request.user.id) {
      return reply.code(403).send({ error: 'You are not part of this connection.' });
    }
    if (!conn.isActive) return reply.code(400).send({ error: 'This connection has ended.' });

    var sid = process.env.TWILIO_ACCOUNT_SID;
    var key = process.env.TWILIO_API_KEY;
    var secret = process.env.TWILIO_API_SECRET;
    if (!sid || !key || !secret) {
      request.log.error('Twilio video credentials are not configured');
      return reply.code(503).send({ error: 'Video is not available right now.', code: 'VIDEO_NOT_CONFIGURED' });
    }

    try {
      var twilio = require('twilio');
      var AccessToken = twilio.jwt.AccessToken;
      var VideoGrant = AccessToken.VideoGrant;
      var room = 'riff-' + conn.id;
      var token = new AccessToken(sid, key, secret, { identity: request.user.id, ttl: 3600 });
      token.addGrant(new VideoGrant({ room: room }));

      var hoursLeft = null;
      if (conn.videoStartedAt) {
        var hrs = (Date.now() - new Date(conn.videoStartedAt).getTime()) / 3600000;
        hoursLeft = Math.max(0, Math.ceil(72 - hrs));
      }
      return {
        token: token.toJwt(),
        room: room,
        identity: request.user.id,
        videoStartedAt: conn.videoStartedAt,
        hoursLeft: hoursLeft,
        decisionReady: hoursLeft === 0,
      };
    } catch (err) {
      request.log.error(err, 'twilio video token failed');
      return reply.code(500).send({ error: 'Could not start the video call.' });
    }
  });

}
module.exports = connectionRoutes;
