import fastify from 'fastify';
import { prisma } from './prisma/client';
import dotenv from 'dotenv';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { 
  register, 
  login, 
  refresh, 
  logout, 
  verifyEmail, 
  forgotPassword, 
  resetPassword,
  verifyAccessToken,
} from './routes/auth';
import { getLicenseVerify, getLicensePlans } from './routes/license';
import './types';

// Log current working directory for debugging
console.log('Current working directory:', process.cwd());

// Load environment variables

const server = fastify({
  logger: true,
});

// Register middleware
server.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  // Exclude auth routes from strict rate limiting initially
  // We'll add more specific limits per route if needed
});
server.register(helmet);
server.register(cors, {
  origin: '*', // In production, restrict to your frontend domains
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
});

// Middleware to verify access token
server.addHook('preHandler', async (request, reply) => {
  // Skip auth for auth routes, health, and public license routes
  if (request.routeOptions.url?.startsWith('/auth') || 
      request.url === '/health' ||
      request.url === '/license/plans') {
    return;
  }
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid authorization header' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    // Attach userId to request for use in handlers
    request.userId = payload.userId;
  } catch (err) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
});

// Health check
server.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

// Register auth routes
server.register(async (instance) => {
  instance.post('/register', register);
  instance.post('/login', login);
  instance.post('/refresh', refresh);
  instance.post('/logout', logout);
  instance.post('/verify-email', verifyEmail);
  instance.post('/forgot-password', forgotPassword);
  instance.post('/reset-password', resetPassword);
}, { prefix: '/auth' });

// Register license routes
server.register((instance) => {
  console.log('Registering license routes');
  instance.get('/verify', getLicenseVerify);
  instance.get('/plans', getLicensePlans);
  console.log('License routes registered');
}, { prefix: '/license' });

const start = async () => {
  try {
    await server.listen({ port: 3000, host: '0.0.0.0' });
    server.log.info(`Server listening on ${server.server.address()}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();

// Export for testing
export { server };