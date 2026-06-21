const prisma = require('../db');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const registerSchema = z.object({
  email: z.string().email(), password: z.string().min(8), alias: z.string().min(2).max(20),
  age: z.number().int().min(18).max(120),
  gender: z.enum(['Male', 'Female', 'Non-binary', 'No Preference', 'Prefer not to say']),
  seekingGender: z.enum(['Male', 'Female', 'Non-binary', 'No Preference', 'No preference', 'A Friends Circle']),
  connectionType: z.enum(['deep', 'circle', 'both']),
});

async function authRoutes(app) {
  app.post('/register', async (request, reply) => {
    try {
      const data = registerSchema.parse(request.body);
      const existing = await prisma.user.findFirst({ where: { OR: [{ email: data.email }, { alias: data.alias }] } });
      if (existing) return reply.status(409).send({ error: existing.email === data.email ? 'Email already registered' : 'Alias taken' });
      const passwordHash = await bcrypt.hash(data.password, 12);
      const user = await prisma.user.create({
        data: { email: data.email, alias: data.alias, age: data.age, gender: data.gender, seekingGender: data.seekingGender, connectionType: data.connectionType, passwordHash },
        select: { id: true, alias: true, email: true, plan: true, trustScore: true },
      });
      const token = app.jwt.sign({ id: user.id, alias: user.alias, role: 'user' });
      return reply.status(201).send({ user, token });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      app.log.error(err);
      return reply.status(500).send({ error: 'Registration failed: ' + err.message });
    }
  });

  app.post('/login', async (request, reply) => {
    try {
      const { email, password } = request.body;
      if (!email || !password) return reply.status(400).send({ error: 'Email and password required' });
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return reply.status(401).send({ error: 'Invalid email or password' });
      if (user.isBanned) return reply.status(403).send({ error: 'Account suspended' });
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return reply.status(401).send({ error: 'Invalid email or password' });
      await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
      const token = app.jwt.sign({ id: user.id, alias: user.alias, role: 'user' });
      return { user: { id: user.id, alias: user.alias, email: user.email, plan: user.plan, trustScore: user.trustScore }, token };
    } catch (err) { app.log.error(err); return reply.status(500).send({ error: 'Login failed' }); }
  });

  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    return await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { id: true, alias: true, email: true, age: true, gender: true, seekingGender: true, connectionType: true, plan: true, trustScore: true, idVerified: true, createdAt: true },
    });
  });
}
module.exports = authRoutes;
