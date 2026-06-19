import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Generate test RSA keys for JWT RS256 signing
const PRIVATE_KEY_PATH = resolve('./test-keys/private.pem');
const PUBLIC_KEY_PATH = resolve('./test-keys/public.pem');

if (!existsSync(PRIVATE_KEY_PATH) || !existsSync(PUBLIC_KEY_PATH)) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  writeFileSync(PRIVATE_KEY_PATH, privateKey);
  writeFileSync(PUBLIC_KEY_PATH, publicKey);
  console.log('[Test Setup] Generated RSA key pair for JWT signing');
}

describe('JWT Utilities', () => {
  beforeEach(() => {
    // Set up environment variables for JWT
    process.env.JWT_PRIVATE_KEY = (require('fs').readFileSync(PRIVATE_KEY_PATH) as Buffer).toString();
    process.env.JWT_PUBLIC_KEY = (require('fs').readFileSync(PUBLIC_KEY_PATH) as Buffer).toString();
    process.env.JWT_SECRET = 'test-secret-for-testing-purposes-only';
    process.env.DATABASE_URL = 'file:./test.db';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    // Clean up
    delete process.env.JWT_PRIVATE_KEY;
    delete process.env.JWT_PUBLIC_KEY;
    delete process.env.JWT_SECRET;
    delete process.env.DATABASE_URL;
    delete process.env.NODE_ENV;
  });

  describe('generateAccessToken', () => {
    it('should generate a valid access token', async () => {
      // Import after setting env vars
      const { generateAccessToken, verifyAccessToken } = await import('../lib/jwt');
      
      const token = generateAccessToken('user123');
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
      
      // Verify the token
      const payload = verifyAccessToken(token);
      expect(payload).toHaveProperty('userId', 'user123');
      expect(payload).toHaveProperty('type', 'access');
    });
  });

  describe('hashPassword and comparePassword', () => {
    it('should hash and compare password correctly', async () => {
      // Import after setting env vars
      const { hashPassword, comparePassword } = await import('../lib/jwt');
      
      const password = 'MySecurePass123!';
      const hash = await hashPassword(password);
      
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
      expect(hash).not.toBe(password);
      
      const isValid = await comparePassword(password, hash);
      expect(isValid).toBe(true);
      
      const isInvalid = await comparePassword('WrongPass456!', hash);
      expect(isInvalid).toBe(false);
    });
  });
});