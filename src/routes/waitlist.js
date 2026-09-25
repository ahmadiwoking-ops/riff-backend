const prisma = require('../db');

// Public, unauthenticated: this is a marketing waiting list, not a signup.
// Rate limited by the global limiter in server.js.
async function waitlistRoutes(app) {
  app.post('/', async (request, reply) => {
    const body = request.body || {};
    const raw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    // Deliberately permissive - a stricter pattern rejects valid addresses more
    // often than it catches bad ones.
    if (!raw || raw.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      return reply.code(400).send({ error: 'Please enter a valid email address.' });
    }

    const source = typeof body.source === 'string' ? body.source.slice(0, 60) : null;

    try {
      const existing = await prisma.waitingList.findUnique({ where: { email: raw } });
      if (existing) {
        // Signing up twice is not an error worth showing anyone.
        return { status: 'ok', alreadyOn: true };
      }
      await prisma.waitingList.create({ data: { email: raw, source: source } });
      return { status: 'ok', alreadyOn: false };
    } catch (err) {
      // A race between the check and the create hits the unique constraint,
      // which is the same outcome as already being on the list.
      if (err && err.code === 'P2002') return { status: 'ok', alreadyOn: true };
      request.log.error(err, 'waitlist signup failed');
      return reply.code(500).send({ error: 'Could not add you just now. Please try again.' });
    }
  });

  // Admin only - used to export the list when the launch email goes out.
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const me = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { isAdmin: true },
    });
    if (!me || !me.isAdmin) return reply.code(403).send({ error: 'Not permitted.' });

    const entries = await prisma.waitingList.findMany({
      orderBy: { createdAt: 'desc' },
      select: { email: true, source: true, notified: true, createdAt: true },
    });
    return { total: entries.length, pending: entries.filter((e) => !e.notified).length, entries };
  });
}

module.exports = waitlistRoutes;
