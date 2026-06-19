import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

// Set up env vars BEFORE any imports
import '../../setup';

let app: any;
let port: number;
const BASE = (ep: string) => `http://127.0.0.1:${port}${ep}`;

describe('Auth API — Integration Tests', () => {
  beforeAll(async () => {
    app = Fastify({ logger: false });

    await app.register(require('@fastify/cors'), {
      origin: ['http://localhost:3000', 'http://localhost:3001'],
      credentials: true,
    });
    await app.register(require('@fastify/helmet'));

    const { 
      register, login, refresh, logout, 
      verifyEmail, forgotPassword, resetPassword, 
      getMe, updateMe,
    } = await import('../routes/auth');
    const { getLicenseVerify, getLicensePlans } = await import('../routes/license');

    await app.register(async (instance: any) => {
      // Mini auth middleware: extract userId from Bearer token for /me routes
      instance.addHook('preHandler', async (req: any) => {
        const auth = req.headers.authorization;
        if (auth?.startsWith('Bearer ')) {
          try {
            const { verifyAccessToken } = await import('../lib/jwt');
            const payload = verifyAccessToken(auth.slice(7));
            (req as any).userId = payload.userId;
          } catch {} // token invalid — handler will reject
        }
      });

      instance.post('/register', register);
      instance.post('/login', login);
      instance.post('/refresh', refresh);
      instance.post('/logout', logout);
      instance.post('/verify-email', verifyEmail);
      instance.post('/forgot-password', forgotPassword);
      instance.post('/reset-password', resetPassword);
      instance.get('/me', getMe);
      instance.patch('/me', updateMe);
    }, { prefix: '/auth' });

    await app.register(async (instance: any) => {
      instance.get('/verify', getLicenseVerify);
      instance.get('/plans', getLicensePlans);
    }, { prefix: '/license' });

    app.get('/health', async () => ({ ok: true }));

    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as any).port;
    console.log(`[Integration] API on http://127.0.0.1:${port}`);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = async (endpoint: string, options: RequestInit = {}) => {
    const url = BASE(endpoint);
    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers as any,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let data;
    try { data = await res.json(); } catch { data = await res.text(); }
    return { status: res.status, data };
  };

  beforeEach(async () => {
    const { prisma } = await import('../prisma/client');
    await prisma.refreshToken.deleteMany();
    await prisma.license.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('POST /auth/register', () => {
    it('registers a new user → 200 with tokens', async () => {
      const { status, data } = await api('/auth/register', {
        method: 'POST',
        body: { email: 'test@example.com', password: 'Pass123!', name: 'Tester' },
      });
      expect(status).toBe(200);
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();
      expect(data.user.email).toBe('test@example.com');
      expect(data.user.name).toBe('Tester');
    });

    it('rejects duplicate email → 409', async () => {
      await api('/auth/register', {
        method: 'POST',
        body: { email: 'dup@example.com', password: 'Pass123!' },
      });
      const { status, data } = await api('/auth/register', {
        method: 'POST',
        body: { email: 'dup@example.com', password: 'Pass123!' },
      });
      expect(status).toBe(409);
      expect(data.error).toBe('User already exists');
    });

    it('rejects missing password → 400', async () => {
      const { status, data } = await api('/auth/register', {
        method: 'POST',
        body: { email: 'test@example.com' },
      });
      expect(status).toBe(400);
      expect(data.error).toBe('Email and password are required');
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await api('/auth/register', {
        method: 'POST',
        body: { email: 'login@example.com', password: 'Secure123!', name: 'Login' },
      });
    });

    it('logs in with correct credentials → 200', async () => {
      const { status, data } = await api('/auth/login', {
        method: 'POST',
        body: { email: 'login@example.com', password: 'Secure123!' },
      });
      expect(status).toBe(200);
      expect(data.accessToken).toBeDefined();
      expect(data.user.email).toBe('login@example.com');
    });

    it('rejects wrong password → 401', async () => {
      const { status, data } = await api('/auth/login', {
        method: 'POST',
        body: { email: 'login@example.com', password: 'WrongPass!' },
      });
      expect(status).toBe(401);
      expect(data.error).toBe('Invalid credentials');
    });
  });

  describe('POST /auth/refresh', () => {
    it('refreshes access token with valid refresh token → 200', async () => {
      const reg = await api('/auth/register', {
        method: 'POST',
        body: { email: 'refresh@example.com', password: 'Pass123!' },
      });
      const { status, data } = await api('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: reg.data.refreshToken },
      });
      expect(status).toBe(200);
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).not.toBe(reg.data.refreshToken);
    });

    it('rejects invalid refresh token → 401', async () => {
      const { status, data } = await api('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: 'garbage-token' },
      });
      expect(status).toBe(401);
      expect(data.error).toBe('Invalid refresh token');
    });
  });

  describe('GET /auth/me', () => {
    it('returns user profile with license → 200', async () => {
      const reg = await api('/auth/register', {
        method: 'POST',
        body: { email: 'me@example.com', password: 'Pass123!', name: 'Me' },
      });
      const { status, data } = await api('/auth/me', {
        headers: { Authorization: `Bearer ${reg.data.accessToken}` } as any,
      });
      expect(status).toBe(200);
      expect(data.email).toBe('me@example.com');
      expect(data.license).toBeDefined();
      expect(data.license.plan).toBe('FREE');
      expect(data.license.accountLimit).toBe(5);
    });

    it('rejects without token → 401', async () => {
      const { status, data } = await api('/auth/me');
      expect(status).toBe(401);
      expect(data.error).toBe('Not authenticated');
    });
  });

  describe('PATCH /auth/me', () => {
    it('updates language and name → 200', async () => {
      const reg = await api('/auth/register', {
        method: 'POST',
        body: { email: 'patch@example.com', password: 'Pass123!', name: 'Old' },
      });
      const { status, data } = await api('/auth/me', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${reg.data.accessToken}` } as any,
        body: { language: 'en', name: 'New Name' },
      });
      expect(status).toBe(200);
      expect(data.language).toBe('en');
      expect(data.name).toBe('New Name');
    });

    it('rejects invalid language → 400', async () => {
      const reg = await api('/auth/register', {
        method: 'POST',
        body: { email: 'patch2@example.com', password: 'Pass123!' },
      });
      const { status, data } = await api('/auth/me', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${reg.data.accessToken}` } as any,
        body: { language: 'fr' },
      });
      expect(status).toBe(400);
      expect(data.error).toBe('Invalid language. Must be: es, en, or pt');
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('returns success for existing email → 200', async () => {
      await api('/auth/register', {
        method: 'POST',
        body: { email: 'forgot@example.com', password: 'Pass123!' },
      });
      const { status, data } = await api('/auth/forgot-password', {
        method: 'POST',
        body: { email: 'forgot@example.com' },
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('returns success for non-existent email (anti-enumeration) → 200', async () => {
      const { status, data } = await api('/auth/forgot-password', {
        method: 'POST',
        body: { email: 'noone@example.com' },
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('POST /auth/reset-password', () => {
    it('rejects short password → 400', async () => {
      const { status, data } = await api('/auth/reset-password', {
        method: 'POST',
        body: { token: 'any', newPassword: '123' },
      });
      expect(status).toBe(400);
      expect(data.error).toBe('Password must be at least 8 characters');
    });
  });

  describe('POST /auth/verify-email', () => {
    it('rejects invalid token → 400', async () => {
      const { status, data } = await api('/auth/verify-email', {
        method: 'POST',
        body: { token: 'bad-token' },
      });
      expect(status).toBe(400);
      expect(data.error).toBe('Invalid or expired token');
    });
  });
});