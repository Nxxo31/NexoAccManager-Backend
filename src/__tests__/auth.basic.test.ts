import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fastify from 'fastify';
import './setup'; // Must be first to set env vars before server import
import { prisma } from '../prisma/client';

describe('Auth API - Basic Setup', () => {
  let app: any;
  let testPort: number;

  beforeAll(async () => {
    // Create fresh fastify instance for testing
    app = fastify();

    // Register only the essential plugins for auth testing
    app.register(require('@fastify/cors'), {
      origin: ['http://localhost:3000', 'http://localhost:3001'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true,
    });
    app.register(require('@fastify/helmet'));
    app.register(require('@fastify/rate-limit'), {
      max: 100,
      timeWindow: '1 minute',
    });

    // Import and register auth routes AFTER setting up env vars
    const { register: registerHandler, login: loginHandler } = await import('../routes/auth');
    
    app.register(async (instance) => {
      instance.post('/register', registerHandler);
      instance.post('/login', loginHandler);
    }, { prefix: '/auth' });

    // Health check
    app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

    // Start listening
    await app.listen({ port: 0, host: '127.0.0.1' });
    testPort = (app.server.address() as any).port;
    console.log(`[Test] API listening on http://127.0.0.1:${testPort}`);
  });

  afterAll(async () => {
    await app.close();
  });

  const fetch = async (endpoint: string, options: RequestInit = {}) => {
    const url = `http://127.0.0.1:${testPort}${endpoint}`;
    const defaultHeaders: HeadersInit = {
      'Content-Type': 'application/json',
    };
    const headers = options.headers
      ? { ...defaultHeaders, ...options.headers }
      : defaultHeaders;

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    let data;
    try {
      data = await response.json();
    } catch {
      data = await response.text();
    }

    return { status: response.status, data };
  };

  describe('POST /auth/register', () => {
    beforeEach(async () => {
      // Clean database before each test
      await prisma.refreshToken.deleteMany();
      await prisma.license.deleteMany();
      await prisma.user.deleteMany();
    });

    it('should register a new user and return tokens', async () => {
      const res = await fetch('/auth/register', {
        method: 'POST',
        body: {
          email: 'test@example.com',
          password: 'SecurePass123!',
          name: 'Test User',
        },
      });

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('accessToken');
      expect(res.data).toHaveProperty('refreshToken');
      expect(res.data.user).toHaveProperty('email', 'test@example.com');
      expect(res.data.user).toHaveProperty('name', 'Test User');
    });

    it('should fail if email already exists', async () => {
      // Register first user
      await fetch('/auth/register', {
        method: 'POST',
        body: {
          email: 'dup@example.com',
          password: 'SecurePass123!',
          name: 'User One',
        },
      });

      // Try to register with same email
      const res = await fetch('/auth/register', {
        method: 'POST',
        body: {
          email: 'dup@example.com',
          password: 'AnotherPass456!',
          name: 'User Two',
        },
      });

      expect(res.status).toBe(409);
      expect(res.data.error).toBe('User already exists');
    });

    it('should fail validation on missing fields', async () => {
      const res = await fetch('/auth/register', {
        method: 'POST',
        body: {
          email: 'test@example.com',
          // missing password
        },
      });

      expect(res.status).toBe(400);
      expect(res.data.error).toBe('Email and password are required');
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      // Clean database before each test
      await prisma.refreshToken.deleteMany();
      await prisma.license.deleteMany();
      await prisma.user.deleteMany();
    });

    it('should login with valid credentials', async () => {
      // Create user first
      await fetch('/auth/register', {
        method: 'POST',
        body: {
          email: 'login@example.com',
          password: 'LoginPass123!',
          name: 'Login User',
        },
      });

      // Now login
      const res = await fetch('/auth/login', {
        method: 'POST',
        body: {
          email: 'login@example.com',
          password: 'LoginPass123!',
        },
      });

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('accessToken');
      expect(res.data).toHaveProperty('refreshToken');
      expect(res.data.user).toHaveProperty('email', 'login@example.com');
    });

    it('should fail with invalid credentials', async () => {
      // Create user
      await fetch('/auth/register', {
        method: 'POST',
        body: {
          email: 'fail@example.com',
          password: 'CorrectPass123!',
          name: 'Fail User',
        },
      });

      // Try wrong password
      const res = await fetch('/auth/login', {
        method: 'POST',
        body: {
          email: 'fail@example.com',
          password: 'WrongPass456!',
        },
      });

      expect(res.status).toBe(401);
      expect(res.data.error).toBe('Invalid credentials');
    });
  });
});