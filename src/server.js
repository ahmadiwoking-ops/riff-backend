require('dotenv').config();
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const rateLimit = require('@fastify/rate-limit');
const multipart = require('@fastify/multipart');
const { Server } = require('socket.io');
const http = require('http');
const prisma = require('./db');

async function start() {
  try { await prisma.$connect(); console.log('Database connected successfully'); }
  catch (err) { console.error('Database connection failed:', err.message); }

  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: { origin: [process.env.CORS_ORIGIN || 'http://localhost:3001', 'https://riff-app.co.uk'], credentials: true },
    transports: ['websocket', 'polling'],
  });

  const app = Fastify({ logger: true, trustProxy: true, serverFactory: (handler) => { httpServer.on('request', handler); return httpServer; } });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'riff-jwt-secret-2026', sign: { expiresIn: '7d' } });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  app.decorate('prisma', prisma);
  app.decorate('io', io);
  app.decorate('authenticate', async function (request, reply) {
    try { await request.jwtVerify(); } catch { reply.status(401).send({ error: 'Unauthorized' }); }
  });

  app.get('/', async () => ({ status: 'ok', service: 'riff-api', version: '2.0.0' }));
  app.get('/health', async () => {
    try { await prisma.$queryRaw`SELECT 1`; return { status: 'healthy', db: 'connected', timestamp: new Date().toISOString() }; }
    catch (err) { return { status: 'unhealthy', db: err.message }; }
  });

  app.register(require('./routes/auth'), { prefix: '/api/auth' });
  app.register(require('./routes/questions'), { prefix: '/api/questions' });
  app.register(require('./routes/connections'), { prefix: '/api/connections' });
  app.register(require('./routes/messages'), { prefix: '/api/messages' });
  app.register(require('./routes/circles'), { prefix: '/api/circles' });
  app.register(require('./routes/games'), { prefix: '/api/games' });
  app.register(require('./routes/voice'), { prefix: '/api/voice' });
  app.register(require('./routes/photos'), { prefix: '/api/photos' });
  app.register(require('./routes/users'), { prefix: '/api/users' });
  app.register(require('./routes/bot'), { prefix: '/api/bot' });
  app.register(require('./routes/admin'), { prefix: '/api/admin' });
  app.register(require('./routes/notifications'), { prefix: '/api/notifications' });
  app.register(require('./routes/subscriptions'), { prefix: '/api/subscriptions' });
  app.register(require('./routes/verification'), { prefix: '/api/verification' });

  io.on('connection', (socket) => {
    socket.on('join:connection', (id) => socket.join('connection:' + id));
    socket.on('join:circle', (id) => socket.join('circle:' + id));
    socket.on('message:send', async (data) => {
      try {
        const message = await prisma.message.create({
          data: { connectionId: data.connectionId, circleId: data.circleId, senderId: socket.userId, type: data.type || 'text', content: data.content },
          include: { sender: { select: { alias: true } } },
        });
        if (data.connectionId) io.to('connection:' + data.connectionId).emit('message:new', message);
        if (data.circleId) io.to('circle:' + data.circleId).emit('message:new', message);
      } catch (err) { socket.emit('error', { message: 'Failed' }); }
    });
    socket.on('disconnect', () => {});
  });

  const port = parseInt(process.env.PORT || '3000');
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info('Riff API v2.0.0 running on port ' + port);
}

process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0); });
process.on('SIGINT', async () => { await prisma.$disconnect(); process.exit(0); });
start().catch((err) => { console.error('Failed to start:', err); process.exit(1); });
// redeploy Fri Jun 19 13:59:55 GMTDT 2026
