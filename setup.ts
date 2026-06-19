// setup.ts - sets up environment variables for testing
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

process.env.JWT_PRIVATE_KEY = (require('fs').readFileSync(PRIVATE_KEY_PATH) as Buffer).toString();
process.env.JWT_PUBLIC_KEY = (require('fs').readFileSync(PUBLIC_KEY_PATH) as Buffer).toString();
process.env.JWT_SECRET='test-s...only';
process.env.DATABASE_URL = 'file:./test.db';
process.env.NODE_ENV = 'test';

// Create test-keys directory if it doesn't exist
const testKeysDir = resolve('./test-keys');
if (!existsSync(testKeysDir)) {
  require('fs').mkdirSync(testKeysDir, { recursive: true });
}