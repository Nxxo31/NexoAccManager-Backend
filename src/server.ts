import fastify, { FastifyInstance } from 'fastify';
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
  getMe,
  updateMe,
} from './routes/auth';
import { getLicenseVerify, getLicensePlans } from './routes/license';
import {
  createCheckoutSession,
  stripeWebhook,
  getStripePlans,
  createPortalSession,
} from './routes/stripe';
import './types';

// Load environment variables
dotenv.config();

// ─── Shared raw body cache for Stripe webhook signature verification ────────
// Keyed by request ID so concurrent requests don't collide
const rawBodyCache = new Map<string, Buffer>();

// ─── Type augmentation for raw body access in route handlers ──────────────
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

// ─── Validate required environment variables ───────────────────────────────
const requiredEnv = ['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'JWT_SECRET'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

// ─── Create Fastify instance ───────────────────────────────────────────────
const server: FastifyInstance = fastify({
  logger: true,
  bodyLimit: 1048576, // 1MB — needed for Stripe webhook payloads
});

// ─── Configure CORS ────────────────────────────────────────────────────────
const allowedOrigins = process.env.NODE_ENV === 'production' 
  ? [
      process.env.FRONTEND_URL,
      'https://nexoaccmanager.vercel.app',
      'https://nexoaccmanager.com',
    ].filter(Boolean) as string[]
  : ['http://localhost:3000', 'http://localhost:3001'];

server.register(cors, {
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
});

// ─── Configure Helmet for security headers ────────────────────────────────
server.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", 'https://*.stripe.com'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
});

// ─── Global rate limit ────────────────────────────────────────────────────
server.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// ─── Raw body caching for Stripe webhook ──────────────────────────────────
// Stripe requires the raw (unparsed) body to verify webhook signatures.
// Cache the raw body on onRequest, then make it available in the handler.
server.addHook('onRequest', async (request) => {
  if (request.url === '/stripe/webhook') {
    // In Fastify, the raw body is available on the Node.js IncomingMessage
    const chunks: Buffer[] = [];
    for await (const chunk of request.raw) {
      chunks.push(Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks);
    rawBodyCache.set(request.id, rawBody);
    // Reconstruct body for Fastify's JSON parsing by storing it back
    (request as any).rawBody = rawBody;
  }
});

server.addHook('preHandler', async (request) => {
  // Attach cached raw body to request for stripeWebhook handler
  (request as any).rawBody = rawBodyCache.get(request.id);
});

// ─── Auth-specific rate limits ────────────────────────────────────────────
const authRateLimit = {
  login: { max: 5, timeWindow: '15 minutes' },
  register: { max: 3, timeWindow: '1 hour' },
  forgotPassword: { max: 3, timeWindow: '1 hour' },
};

// Helper: create a rate-limit preHandler for specific options
function createRateLimitPreHandler(options: { max: number; timeWindow: string }) {
  return async (request: any, reply: any) => {
    const rl = (request.server as any)['@fastify/rate-limit'];
    if (rl?.rateLimitPreHandler) {
      const originalMax = (rl as any).global['max'];
      const originalTimeWindow = (rl as any).global['timeWindow'];
      (rl as any).global['max'] = options.max;
      (rl as any).global['timeWindow'] = options.timeWindow;
      try {
        await rl.rateLimitPreHandler(request, reply);
      } finally {
        (rl as any).global['max'] = originalMax;
        (rl as any).global['timeWindow'] = originalTimeWindow;
      }
    }
  };
}

// ─── Auth middleware ───────────────────────────────────────────────────────
server.addHook('preHandler', async (request, reply) => {
  const publicRoutes = [
    /^\/auth/,
    /^\/health/,
    /^\/license\/plans/,
    /^\/stripe\/webhook/,
    /^\/stripe\/plans/,
  ];
  if (publicRoutes.some((re) => re.test(request.routeOptions.url ?? ''))) {
    return;
  }
  
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid authorization header' });
  }
  
  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    (request as any).userId = payload.userId;
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
});

// ─── Health check ──────────────────────────────────────────────────────────
server.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Auth routes ───────────────────────────────────────────────────────────
server.register(async (instance) => {
  instance.post('/register', { preHandler: [createRateLimitPreHandler(authRateLimit.register)] }, register);
  instance.post('/login', { preHandler: [createRateLimitPreHandler(authRateLimit.login)] }, login);
  instance.post('/refresh', refresh);
  instance.post('/logout', logout);
  instance.post('/verify-email', verifyEmail);
  instance.post('/forgot-password', { preHandler: [createRateLimitPreHandler(authRateLimit.forgotPassword)] }, forgotPassword);
  instance.post('/reset-password', resetPassword);
  instance.get('/me', getMe);
  instance.patch('/me', updateMe);
}, { prefix: '/auth' });

// ─── License routes ────────────────────────────────────────────────────────
server.register((instance) => {
  instance.get('/verify', getLicenseVerify);
  instance.get('/plans', getLicensePlans);
}, { prefix: '/license' });

// ─── Stripe routes ─────────────────────────────────────────────────────────
server.register(async (instance) => {
  instance.get('/plans', getStripePlans);                         // public
  instance.post('/webhook', stripeWebhook);                       // raw body, no auth
  instance.post('/checkout/create-session', createCheckoutSession); // auth required
  instance.post('/portal', createPortalSession);                  // auth required
}, { prefix: '/stripe' });

// ─── Start server ──────────────────────────────────────────────────────────
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000');
    await server.listen({ port, host: '0.0.0.0' });
    server.log.info(`Server listening on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();

export { server };