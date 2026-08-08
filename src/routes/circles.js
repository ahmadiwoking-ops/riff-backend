const prisma = require('../db');
const { getLimits } = require('../services/plan-limits');
const { getCircleStatus } = require('../services/circle-stages');

async function circleRoutes(app) {
  // Get my circles
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const memberships = await prisma.circleMember.findMany({ where: { userId: request.user.id, isActive: true }, include: { circle: { include: { members: { include: { user: { select: { alias: true, trustScore: true } } } } } } } });
    return { circles: memberships.map(m => m.circle) };
  });

  // Get circle detail
  app.get('/:id', { preHandler: [app.authenticate] }, async (request) => {
    return { circle: await prisma.circle.findUnique({ where: { id: request.params.id }, include: { members: { include: { user: { select: { id: true, alias: true, trustScore: true } } } }, rounds: { orderBy: { roundNum: 'desc' }, take: 5, include: { answers: true } }, games: { where: { status: 'active' } } } }) };
  });

  // Join a circle — with plan-based limits
  app.post('/join', { preHandler: [app.authenticate] }, async (request) => {
    var circleId = request.body.circleId;
    if (!circleId) return { error: 'circleId required' };
    var myId = request.user.id;

    // Check if already a member
    var existing = await prisma.circleMember.findFirst({ where: { circleId: circleId, userId: myId } });
    if (existing) return { status: 'already_member', member: existing };

    // Check plan limits
    var user = await prisma.user.findUnique({ where: { id: myId }, select: { plan: true, planExpiresAt: true } });
    var plan = user.plan || 'free';
    if (user.planExpiresAt && user.planExpiresAt < new Date()) plan = 'free';
    var limits = getLimits(plan);

    if (limits.circles === 0) {
      return { error: 'Your plan does not include friend circles. Upgrade to Explorer or Inner Circle.', code: 'PLAN_LIMIT' };
    }

    if (limits.circles !== -1) {
      if (plan === 'free') {
        // FREE = one friend circle EVER (lifetime). Count every membership regardless of status.
        var everCircles = await prisma.circleMember.count({ where: { userId: myId } });
        if (everCircles >= 1) {
          return {
            error: 'Free accounts include one friend circle. Subscribe to a paid plan to join more circles.',
            code: 'FREE_LIFETIME_LIMIT',
            current: everCircles,
            limit: 1,
            plan: plan,
          };
        }
      } else {
        var activeCircles = await prisma.circleMember.count({ where: { userId: myId, isActive: true } });
        if (activeCircles >= limits.circles) {
          return {
            error: plan === 'inner_circle' ? 'You have reached your limit of 5 active circles. Leave one to join a new circle.' : 'You have reached your friend circle limit (' + limits.circles + ' on ' + plan + ' plan). Upgrade to join more circles.',
            code: 'PLAN_LIMIT',
            current: activeCircles,
            limit: limits.circles,
            plan: plan,
          };
        }
      }
    }

    // Join the circle
    var member = await prisma.circleMember.create({
      data: { circleId: circleId, userId: myId, alias: request.user.alias || 'Member' },
    });
    return { status: 'joined', member: member };
  });

  // ═══ Circle flow status ═══
  app.get('/:id/status', { preHandler: [app.authenticate] }, async (request) => {
    return await getCircleStatus(request.params.id, request.user.id);
  });

  // ═══ Opt in to voice stage ═══
  app.post('/:id/voice-optin', { preHandler: [app.authenticate] }, async (request) => {
    var circleId = request.params.id;
    var member = await prisma.circleMember.findFirst({ where: { circleId: circleId, userId: request.user.id } });
    if (!member) return { error: 'Not a member' };
    await prisma.circleMember.update({ where: { id: member.id }, data: { voiceOptIn: true } });
    var members = await prisma.circleMember.findMany({ where: { circleId: circleId, isActive: true } });
    var allIn = members.length > 0 && members.every(function(m) { return m.voiceOptIn; });
    if (allIn) {
      await prisma.circle.update({ where: { id: circleId }, data: { voiceStageOpen: true, stage: 'voice' } });
      return { status: 'voice_open', message: 'Everyone opted in — voice stage is now open!', allIn: true };
    }
    var optedIn = members.filter(function(m) { return m.voiceOptIn; }).length;
    return { status: 'waiting', message: 'Waiting for all members to open this stage (' + optedIn + '/' + members.length + ')', allIn: false };
  });

  // ═══ Increment message counts ═══
  app.post('/:id/count', { preHandler: [app.authenticate] }, async (request) => {
    var circleId = request.params.id;
    var type = request.body.type;
    var member = await prisma.circleMember.findFirst({ where: { circleId: circleId, userId: request.user.id } });
    if (!member) return { error: 'Not a member' };
    var field = type === 'voice' ? 'voiceCount' : 'textCount';
    var data = {}; data[field] = { increment: 1 };
    var updated = await prisma.circleMember.update({ where: { id: member.id }, data: data });
    var members = await prisma.circleMember.findMany({ where: { circleId: circleId, isActive: true } });
    var allQualified = members.length > 0 && members.every(function(m) { return m.textCount >= 3 && m.voiceCount >= 3; });
    if (allQualified) {
      await prisma.circle.update({ where: { id: circleId }, data: { revealReady: true, stage: 'reveal' } });
    }
    return { textCount: updated.textCount, voiceCount: updated.voiceCount, revealReady: allQualified };
  });

  // ═══ Submit selfie for circle reveal ═══
  app.post('/:id/selfie', { preHandler: [app.authenticate] }, async (request) => {
    var circleId = request.params.id;
    var photo = request.body.photo;
    if (!photo) return { error: 'photo required' };
    var member = await prisma.circleMember.findFirst({ where: { circleId: circleId, userId: request.user.id } });
    if (!member) return { error: 'Not a member' };
    // Model B: revealing your live selfie unlocks the circle for YOU immediately.
    await prisma.circleMember.update({ where: { id: member.id }, data: { selfiePhoto: photo, revealDecision: 'reveal' } });
    // Lock the selfie to the user's profile as the anti-fake reference (only set once — never overwritten).
    var u = await prisma.user.findUnique({ where: { id: request.user.id }, select: { circleSelfie: true, displayPhoto: true } });
    var profileData = {};
    if (!u || !u.circleSelfie) profileData.circleSelfie = photo;           // locked reference, set once
    if (!u || !u.displayPhoto) profileData.displayPhoto = photo;           // default display pic (updatable later)
    if (Object.keys(profileData).length) await prisma.user.update({ where: { id: request.user.id }, data: profileData });
    // Count how many have now revealed (for a nice notification), but don't gate on it.
    var members = await prisma.circleMember.findMany({ where: { circleId: circleId, isActive: true } });
    var revealedCount = members.filter(function(m) { return m.selfiePhoto; }).length;
    var allRevealed = revealedCount === members.length;
    if (allRevealed) await prisma.circle.update({ where: { id: circleId }, data: { revealedAt: new Date() } });
    return { status: 'revealed', revealedCount: revealedCount, total: members.length, allRevealed: allRevealed, message: 'You revealed! You can now see everyone else who has revealed.' };
  });

  // ═══ Get circle reveal photos ═══
  app.get('/:id/reveal', { preHandler: [app.authenticate] }, async (request) => {
    var circleId = request.params.id;
    var members = await prisma.circleMember.findMany({ where: { circleId: circleId, isActive: true } });
    var me = members.find(function(m) { return m.userId === request.user.id; });
    var iRevealed = !!(me && me.selfiePhoto);
    var revealedMembers = members.filter(function(m) { return m.selfiePhoto; });
    if (!iRevealed) {
      return { ready: false, iRevealed: false, revealedCount: revealedMembers.length, total: members.length, message: 'Reveal your selfie to see everyone who has revealed.' };
    }
    // I've revealed — show everyone else who has also revealed.
    return { ready: true, iRevealed: true, revealedCount: revealedMembers.length, total: members.length, photos: revealedMembers.map(function(m) { return { userId: m.userId, alias: m.alias, photo: m.selfiePhoto }; }) };
  });

  // ═══ Decline to reveal ═══
  app.post('/:id/decline-reveal', { preHandler: [app.authenticate] }, async (request) => {
    var circleId = request.params.id;
    var member = await prisma.circleMember.findFirst({ where: { circleId: circleId, userId: request.user.id } });
    if (!member) return { error: 'Not a member' };
    await prisma.circleMember.update({ where: { id: member.id }, data: { revealDecision: 'decline' } });
    return { status: 'declined', message: 'You declined to reveal. The group will vote on whether to keep you or find a replacement.' };
  });

  // ═══ Vote to keep or replace ═══
  app.post('/:id/vote', { preHandler: [app.authenticate] }, async (request) => {
    var circleId = request.params.id;
    var targetUserId = request.body.targetUserId;
    var vote = request.body.vote;
    if (!targetUserId || !vote) return { error: 'targetUserId and vote required' };
    await prisma.circleVote.upsert({
      where: { circleId_targetUserId_voterUserId: { circleId: circleId, targetUserId: targetUserId, voterUserId: request.user.id } },
      update: { vote: vote },
      create: { circleId: circleId, targetUserId: targetUserId, voterUserId: request.user.id, vote: vote },
    });
    var members = await prisma.circleMember.findMany({ where: { circleId: circleId, isActive: true } });
    var voters = members.filter(function(m) { return m.userId !== targetUserId; });
    var votes = await prisma.circleVote.findMany({ where: { circleId: circleId, targetUserId: targetUserId } });
    var keepVotes = votes.filter(function(v) { return v.vote === 'keep'; }).length;
    var replaceVotes = votes.filter(function(v) { return v.vote === 'replace'; }).length;
    var allVoted = votes.length >= voters.length;
    if (allVoted) {
      if (keepVotes >= replaceVotes) {
        await prisma.circleMember.updateMany({ where: { circleId: circleId, userId: targetUserId }, data: { revealDecision: 'kept' } });
        return { status: 'kept', message: 'The group voted to keep the member.', keepVotes: keepVotes, replaceVotes: replaceVotes };
      } else {
        await prisma.circleMember.updateMany({ where: { circleId: circleId, userId: targetUserId }, data: { isActive: false } });
        await prisma.circle.update({ where: { id: circleId }, data: { status: 'awaiting_replacement' } });
        return { status: 'replaced', message: 'The group voted to replace the member. Finding a new member...', keepVotes: keepVotes, replaceVotes: replaceVotes };
      }
    }
    return { status: 'vote_recorded', message: 'Vote recorded (' + votes.length + '/' + voters.length + ')', keepVotes: keepVotes, replaceVotes: replaceVotes };
  });
}
module.exports = circleRoutes;
