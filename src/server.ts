import fastify from 'fastify';
import { prisma } from './prisma/client';
import dotenv from 'dotenv';
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
import './types';

// Load environment variables
dotenv.config();

const server = fastify({
  logger: true,
});

// Middleware to verify access token
server.addHook('preHandler', async (request, reply) => {
  // Skip auth for auth routes and health
  if (request.routeOptions.url?.startsWith('/auth') || request.url === '/health') {
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
  instance.post('/auth/register', register);
  instance.post('/auth/login', login);
  instance.post('/auth/refresh', refresh);
  instance.post('/auth/logout', logout);
  instance.post('/auth/verify-email', verifyEmail);
  instance.post('/auth/forgot-password', forgotPassword);
  instance.post('/auth/reset-password', resetPassword);
}, { prefix: '/auth' });

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