/**
 * Utility script to generate a SHA-256 hash of a password for admin authentication
 * 
 * Usage: node generate-password-hash.js <password>
 */

import crypto from 'crypto';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

const password = process.argv[2];

if (!password) {
  console.error('Usage: node generate-password-hash.js <password>');
  process.exit(1);
}

try {
  const hash = hashPassword(password);
  console.log('\nPassword hash (SHA-256):');
  console.log(hash);
  console.log('\nAdd this to your wrangler.toml or environment variables:');
  console.log(`ADMIN_PASSWORD_HASH = "${hash}"`);
  console.log('\nOr set it as a secret:');
  console.log(`npx wrangler secret put ADMIN_PASSWORD_HASH`);
  console.log('Then enter the hash when prompted.');
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}

