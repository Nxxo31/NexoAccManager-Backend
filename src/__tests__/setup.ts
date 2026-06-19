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
process.env.JWT_SECRET = 'test-jwt-secret-12345678';
process.env.DATABASE_URL = 'file:./test.db';
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // Random port
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_secret';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_mock_secret';
process.env.FRONTEND_URL = 'http://localhost:3000';
// Disable SMTP for tests — email functions will be no-op
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
