const prisma = require('../db');

let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch {}
const client = process.env.ANTHROPIC_API_KEY && Anthropic ? new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

async function adminRoutes(app) {
  app.get('/stats', { preHandler: [app.authenticate] }, async () => {
    const [totalUsers, activeUsers, totalConnections, activeCircles, pendingFlags, paidUsers] = await Promise.all([
      prisma.user.count(), prisma.user.count({ where: { lastActiveAt: { gte: new Date(Date.now() - 86400000) } } }),
      prisma.connection.count({ where: { isActive: true, isPractice: false } }), prisma.circle.count({ where: { isActive: true } }),
      prisma.safetyFlag.count({ where: { status: 'pending' } }), prisma.user.count({ where: { plan: { not: 'free' } } }),
    ]);
    return { totalUsers, activeUsers24h: activeUsers, activeConnections: totalConnections, activeCircles, pendingFlags, paidUsers };
  });

  app.get('/flags', { preHandler: [app.authenticate] }, async () => {
    return { flags: await prisma.safetyFlag.findMany({ where: { status: 'pending' }, include: { user: { select: { id: true, alias: true, trustScore: true } } }, orderBy: { createdAt: 'asc' }, take: 50 }) };
  });

  app.post('/flags/:id/resolve', { preHandler: [app.authenticate] }, async (request) => {
    const { action, notes } = request.body;
    const flag = await prisma.safetyFlag.update({ where: { id: request.params.id }, data: { status: 'resolved', reviewedBy: request.user.id, reviewNotes: notes, resolvedAt: new Date() } });
    if (action === 'ban') await prisma.user.update({ where: { id: flag.userId }, data: { isBanned: true, banReason: notes } });
    if (action === 'warn') await prisma.user.update({ where: { id: flag.userId }, data: { trustScore: 'yellow', trustFlags: { increment: 1 } } });
    return { flag, action };
  });

  app.get('/users', { preHandler: [app.authenticate] }, async (request) => {
    const { search, page } = request.query;
    const where = search ? { OR: [{ alias: { contains: search } }, { email: { contains: search } }] } : {};
    return { users: await prisma.user.findMany({ where, select: { id: true, alias: true, email: true, gender: true, plan: true, trustScore: true, isBanned: true, createdAt: true, lastActiveAt: true }, orderBy: { createdAt: 'desc' }, take: 50, skip: ((parseInt(page) || 1) - 1) * 50 }) };
  });

  // ═══ Content Studio: proxy to Anthropic API ═══
  app.post('/generate-content', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!client) {
      return reply.code(500).send({ error: 'ANTHROPIC_API_KEY not configured on the server' });
    }

    const { topic, platform, format, variety } = request.body;
    if (!topic || !format) {
      return reply.code(400).send({ error: 'Topic and format are required' });
    }

    const system =
      'You are the social media lead for Riff, a connection app that matches people through conversation, voice, and trust — not photos and swiping. ' +
      'Riff launched in 2026 in the UK. It has two modes: Deep Connection (1:1, five stages from text to voice to simultaneous photo reveal) and Friend Circle (groups of four). ' +
      'Trust badges: red (unverified), yellow (selfie), green (full ID + phone). ' +
      'Brand voice: warm, human, a little poetic, never corporate. Lowercase energy. Think late-night honest conversation, not marketing deck.';

    const userPrompt =
      `Topic: ${topic}\n` +
      `Platform: ${platform}\n` +
      `Write ${format}${variety || ''}\n` +
      'Output only the post content itself, ready to copy and paste. No preamble, no explanation, no markdown code fences.';

    try {
      const res = await client.messages.create({
        model: process.env.BOT_MODEL || 'claude-sonnet-4-6',
        max_tokens: 1000,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text = res.content.map(b => b.text || '').join('\n').trim();
      if (!text) return reply.code(500).send({ error: 'Empty response from AI' });

      console.log('[admin] Content generated for', platform);
      return { text };
    } catch (err) {
      console.error('[admin] Content generation error:', err.message);
      return reply.code(500).send({ error: 'Content generation failed: ' + err.message });
    }
  });
}

module.exports = adminRoutes;
