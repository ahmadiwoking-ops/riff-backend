const prisma = require('../db');
const { listDebaters, getDebater } = require('../services/debate-personas');
const debateSvc = require('../services/debate');

// Debates cost roughly twice a companion message: the debater carries the
// whole argument, and the judging pass reads the lot. Charged from the same
// credit pool at 2, with a separate free allowance so trying it does not eat
// someone's chat messages.
const CREDITS_PER_MESSAGE = 2;
const FREE_DEBATE_MESSAGES = 50;

async function monthUsage(userId) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let usage = await prisma.botConnectionUsage.findFirst({ where: { userId, monthStart } });
  if (!usage) {
    usage = await prisma.botConnectionUsage.create({
      data: { userId, monthStart, messageCount: 0, bonusMessages: 0 },
    });
  }
  return usage;
}

/** How many debate messages this person has sent, ever. */
async function debateMessagesUsed(userId) {
  return prisma.debateMessage.count({
    where: { role: 'user', debate: { userId: userId } },
  });
}

async function debateRoutes(app) {
  // ── Who you can debate ────────────────────────────────────────────────
  app.get('/debaters', { preHandler: [app.authenticate] }, async () => {
    return { debaters: listDebaters() };
  });

  // ── Allowance ─────────────────────────────────────────────────────────
  app.get('/allowance', { preHandler: [app.authenticate] }, async (request) => {
    const used = await debateMessagesUsed(request.user.id);
    const freeLeft = Math.max(0, FREE_DEBATE_MESSAGES - used);
    const usage = await monthUsage(request.user.id);
    const credits = Math.max(0, usage.bonusMessages - usage.messageCount);
    return {
      freeLeft,
      credits,
      creditsPerMessage: CREDITS_PER_MESSAGE,
      canDebate: freeLeft > 0 || credits >= CREDITS_PER_MESSAGE,
    };
  });

  // ── Topic suggestions ─────────────────────────────────────────────────
  app.post('/suggest-topics', { preHandler: [app.authenticate] }, async (request, reply) => {
    const persona = (request.body || {}).persona;
    if (!getDebater(persona)) return reply.code(400).send({ error: 'Unknown debater.' });
    const r = await debateSvc.suggestTopics(persona);
    if (!r.ok) return reply.code(503).send({ error: r.reason });
    return { topics: r.topics };
  });

  // ── Start a debate ────────────────────────────────────────────────────
  app.post('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body || {};
    const debater = getDebater(body.persona);
    if (!debater) return reply.code(400).send({ error: 'Choose someone to debate.' });

    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    const userPosition = typeof body.userPosition === 'string' ? body.userPosition.trim() : '';
    if (!topic || topic.length > 300) return reply.code(400).send({ error: 'Give the debate a topic.' });
    if (!userPosition || userPosition.length > 300) {
      return reply.code(400).send({ error: 'Say what you are arguing for.' });
    }

    // Several debates at once is allowed, but not unbounded.
    const open = await prisma.debate.count({ where: { userId: request.user.id, status: 'active' } });
    if (open >= 5) {
      return reply.code(400).send({ error: 'You have five debates on the go. Finish one first.', code: 'TOO_MANY' });
    }

    const debate = await prisma.debate.create({
      data: {
        userId: request.user.id,
        persona: debater.key,
        topic: topic,
        userPosition: userPosition,
        aiPosition: typeof body.aiPosition === 'string' && body.aiPosition.trim()
          ? body.aiPosition.trim()
          : (/^(for|agree|yes|true|支持)/i.test(userPosition)
              ? ('Disagreeing with: ' + topic)
              : ('Agreeing with: ' + topic)),
        topicSource: body.topicSource === 'suggested' ? 'suggested' : 'user',
      },
    });
    return { debate };
  });

  // ── List your debates ─────────────────────────────────────────────────
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const debates = await prisma.debate.findMany({
      where: { userId: request.user.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, persona: true, topic: true, userPosition: true, status: true,
        exchangeCount: true, verdict: true, createdAt: true, updatedAt: true,
      },
    });
    return { debates };
  });

  // ── Read one ──────────────────────────────────────────────────────────
  app.get('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const debate = await prisma.debate.findUnique({
      where: { id: request.params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!debate) return reply.code(404).send({ error: 'Debate not found.' });
    if (debate.userId !== request.user.id) return reply.code(403).send({ error: 'Not yours.' });
    return { debate, debater: getDebater(debate.persona) };
  });

  // ── Take a turn ───────────────────────────────────────────────────────
  app.post('/:id/message', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body || {};
    const debate = await prisma.debate.findUnique({ where: { id: request.params.id } });
    if (!debate) return reply.code(404).send({ error: 'Debate not found.' });
    if (debate.userId !== request.user.id) return reply.code(403).send({ error: 'Not yours.' });
    if (debate.status !== 'active') return reply.code(400).send({ error: 'This debate has finished.' });
    if (debate.exchangeCount >= debateSvc.MAX_EXCHANGES) {
      return reply.code(400).send({ error: 'This debate has reached its limit. End it to get a verdict.', code: 'AT_LIMIT' });
    }

    // Spoken or typed - the debater always replies in writing.
    let text = typeof body.content === 'string' ? body.content.trim() : '';
    let viaVoice = false;
    if (!text && body.audio) {
      const tr = await debateSvc.transcribe(body.audio);
      if (!tr.ok) return reply.code(400).send({ error: tr.reason });
      text = tr.text;
      viaVoice = true;
      var heard = tr.language || null;
    }
    if (!text) return reply.code(400).send({ error: 'Say something.' });
    if (text.length > 4000) return reply.code(400).send({ error: 'That is too long for one turn.' });

    // Allowance: free messages first, then credits.
    const used = await debateMessagesUsed(request.user.id);
    const usingFree = used < FREE_DEBATE_MESSAGES;
    let usage = null;
    if (!usingFree) {
      usage = await monthUsage(request.user.id);
      const credits = usage.bonusMessages - usage.messageCount;
      if (credits < CREDITS_PER_MESSAGE) {
        return reply.code(402).send({
          error: 'You are out of debate credits.',
          code: 'NO_CREDITS',
          creditsPerMessage: CREDITS_PER_MESSAGE,
        });
      }
    }

    await prisma.debateMessage.create({
      data: { debateId: debate.id, role: 'user', content: text, viaVoice: viaVoice },
    });

    if (!debate.language) {
      // Whisper first (free, every language), then script ranges (free,
      // instant), then one model call for Latin scripts it cannot tell apart.
      var lang = (typeof heard !== 'undefined' && heard) ? heard : debateSvc.detectLanguage(text);
      if (!lang) lang = await debateSvc.detectLanguageByModel(text);
      if (lang) {
        await prisma.debate.update({ where: { id: debate.id }, data: { language: lang } });
        debate.language = lang;
      }
    }

    const all = await prisma.debateMessage.findMany({
      where: { debateId: debate.id, role: { in: ['user', 'ai'] } },
      orderBy: { createdAt: 'asc' },
    });

    const res = await debateSvc.debateReply(debate, all);
    if (!res.ok) {
      // Their message is kept - only the reply failed, and they can retry.
      return reply.code(503).send({ error: res.reason });
    }

    await prisma.debateMessage.create({
      data: { debateId: debate.id, role: 'ai', content: res.text },
    });

    const nextCount = debate.exchangeCount + 1;
    const data = { exchangeCount: nextCount };

    // Fold older exchanges into notes now and then, so cost per turn stays
    // flat however long this runs.
    if (nextCount - debate.summarisedTo >= debateSvc.SUMMARISE_EVERY && nextCount > debateSvc.WINDOW) {
      const summary = await debateSvc.updateSummary(debate, all);
      if (summary) { data.summary = summary; data.summarisedTo = nextCount; }
    }
    await prisma.debate.update({ where: { id: debate.id }, data: data });

    if (!usingFree && usage) {
      await prisma.botConnectionUsage.update({
        where: { id: usage.id },
        data: { messageCount: { increment: CREDITS_PER_MESSAGE } },
      });
    }

    return {
      reply: res.text,
      transcribed: viaVoice ? text : undefined,
      exchangeCount: nextCount,
      remaining: debateSvc.MAX_EXCHANGES - nextCount,
    };
  });

  // ── End and judge ─────────────────────────────────────────────────────
  app.post('/:id/end', { preHandler: [app.authenticate] }, async (request, reply) => {
    const debate = await prisma.debate.findUnique({ where: { id: request.params.id } });
    if (!debate) return reply.code(404).send({ error: 'Debate not found.' });
    if (debate.userId !== request.user.id) return reply.code(403).send({ error: 'Not yours.' });
    if (debate.status === 'judged') return { verdict: debate.verdict, alreadyJudged: true };
    if (debate.exchangeCount < 2) {
      return reply.code(400).send({ error: 'There is not enough here to judge yet.', code: 'TOO_SHORT' });
    }

    const all = await prisma.debateMessage.findMany({
      where: { debateId: debate.id, role: { in: ['user', 'ai'] } },
      orderBy: { createdAt: 'asc' },
    });

    await prisma.debate.update({ where: { id: debate.id }, data: { status: 'judging' } });
    const res = await debateSvc.judgeDebate(debate, all);
    if (!res.ok) {
      await prisma.debate.update({ where: { id: debate.id }, data: { status: 'active' } });
      return reply.code(503).send({ error: res.reason });
    }

    await prisma.debate.update({
      where: { id: debate.id },
      data: {
        status: 'judged',
        verdict: res.verdict,
        endedReason: (request.body || {}).reason === 'limit' ? 'limit' : 'user_ended',
      },
    });
    return { verdict: res.verdict };
  });

  // ── Abandon ───────────────────────────────────────────────────────────
  app.delete('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const debate = await prisma.debate.findUnique({ where: { id: request.params.id } });
    if (!debate) return reply.code(404).send({ error: 'Debate not found.' });
    if (debate.userId !== request.user.id) return reply.code(403).send({ error: 'Not yours.' });
    await prisma.debate.delete({ where: { id: debate.id } });
    return { status: 'deleted' };
  });
}

module.exports = debateRoutes;
