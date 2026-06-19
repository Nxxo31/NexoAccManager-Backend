import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the modules with explicit implementations
vi.mock('../prisma/client', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    license: {
      create: vi.fn(),
    },
  },
}));
vi.mock('../lib/jwt', () => ({
  hashPassword: vi.fn(),
}));
vi.mock('../lib/email', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue({}),
}));

import { prisma } from '../prisma/client';
import { hashPassword } from '../lib/jwt';
import { sendVerificationEmail } from '../lib/email';

describe('register function unit test', () => {
  let register: any;

  beforeEach(async () => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    
    // Import the register function after mocks are set up
    const { register: registerFunc } = await import('../routes/auth');
    register = registerFunc;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('register', () => {
    it('should return 400 if email or password missing', async () => {
      const mockRequest = {
        body: {
          email: 'test@example.com',
          // missing password
        },
      } as any;
      const mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      } as any;

      await register(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({ error: 'Email and password are required' });
    });

    it('should return 409 if email already exists', async () => {
      // Mock prisma.user.findUnique to return an existing user
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user-id' });

      const mockRequest = {
        body: {
          email: 'test@example.com',
          password: 'SecurePass123!',
        },
      } as any;
      const mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      } as any;

      await register(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(409);
      expect(mockReply.send).toHaveBeenCalledWith({ error: 'User already exists' });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });

    it('should create user and license when email is new', async () => {
      // Mock prisma.user.findUnique to return null (no existing user)
      prisma.user.findUnique.mockResolvedValue(null);
      // Mock hashPassword to return a hashed password
      hashPassword.mockResolvedValue('hashed-password-123');
      // Mock prisma.user.create to return a new user
      prisma.user.create.mockResolvedValue({
        id: 'new-user-id',
        email: 'test@example.com',
        passwordHash: 'hashed-password-123',
        name: 'Test User',
      });

      const mockRequest = {
        body: {
          email: 'test@example.com',
          password: 'SecurePass123!',
          name: 'Test User',
        },
      } as any;
      const mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      } as any;

      await register(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        user: {
          id: 'new-user-id',
          email: 'test@example.com',
          name: 'Test User',
        },
      });

      // Verify prisma calls
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(hashPassword).toHaveBeenCalledWith('SecurePass123!');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          passwordHash: 'hashed-password-123',
          name: 'Test User',
        },
      });
      expect(prisma.license.create).toHaveBeenCalledWith({
        data: {
          userId: 'new-user-id',
          plan: 'FREE',
          accountLimit: 5,
        },
      });
      expect(sendVerificationEmail).toHaveBeenCalledWith(
        'new-user-id',
        'test@example.com'
      );
    });
  });
});