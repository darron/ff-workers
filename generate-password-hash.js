/**
 * Utility script to generate a PBKDF2 password hash for admin authentication
 *
 * Usage: node generate-password-hash.js <password>
 *
 * Output format: pbkdf2:<iterations>:<salt_hex>:<hash_hex>
 */

import crypto from 'crypto';

const ITERATIONS = 100000; // Cloudflare Workers runtime max
const KEY_LENGTH = 32; // bytes
const DIGEST = 'sha256';
const SALT_LENGTH = 16; // bytes

function generateHash(password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return `pbkdf2:${ITERATIONS}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

const password = process.argv[2];

if (!password) {
  console.error('Usage: node generate-password-hash.js <password>');
  process.exit(1);
}

try {
  const hash = generateHash(password);
  console.log('\nPassword hash (PBKDF2, 100k iterations, random salt):');
  console.log(hash);
  console.log('\nSet it as a secret (recommended):');
  console.log('npx wrangler secret put ADMIN_PASSWORD_HASH');
  console.log('Then paste the hash above when prompted.');
  console.log('\nFor staging:');
  console.log('npx wrangler secret put ADMIN_PASSWORD_HASH --env staging');
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
