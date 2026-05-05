/**
 * Authentication utilities for admin access
 * Uses simple session-based auth with secure cookies
 */

const PBKDF2_ITERATIONS = 100000; // Workers runtime max
const PBKDF2_HASH = 'SHA-256';
const PBKDF2_KEY_LENGTH = 32; // bytes

function hexEncode(buffer) {
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}

function hexDecode(hex) {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Derive a key from password + salt using PBKDF2 (Web Crypto API)
 */
async function pbkdf2Derive(password, salt, iterations) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH },
    keyMaterial,
    PBKDF2_KEY_LENGTH * 8
  );
  return new Uint8Array(derived);
}

/**
 * Verify a password against a stored PBKDF2 hash string
 * Format: pbkdf2:<iterations>:<salt_hex>:<hash_hex>
 */
async function verifyPassword(password, storedHash) {
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    return false;
  }
  const iterations = parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 200000) {
    return false;
  }
  const salt = hexDecode(parts[2]);
  const expectedHash = hexDecode(parts[3]);

  const derived = await pbkdf2Derive(password, salt, iterations);

  // Constant-time comparison that doesn't leak length
  // Pass ArrayBuffer (.buffer) for broadest Workers compatibility
  const lengthsMatch = derived.byteLength === expectedHash.byteLength;
  return lengthsMatch
    ? crypto.subtle.timingSafeEqual(derived.buffer, expectedHash.buffer)
    : !crypto.subtle.timingSafeEqual(derived.buffer, derived.buffer);
}

/**
 * Generate a secure random token
 */
function generateToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get session token from request cookies
 */
export function getSessionToken(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  
  const cookies = cookieHeader.split(';').map(c => c.trim().split('='));
  const sessionCookie = cookies.find(([name]) => name === 'admin_session');
  return sessionCookie ? decodeURIComponent(sessionCookie[1]) : null;
}

/**
 * Set session cookie in response
 */
export function setSessionCookie(token) {
  // Set cookie with HttpOnly, Secure, and SameSite attributes
  // Secure flag should be enabled in production (HTTPS only)
  return `admin_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`; // 24 hours
}

/**
 * Clear session cookie
 */
export function clearSessionCookie() {
  return 'admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}

/**
 * Check if user is authenticated
 * Uses KV store, D1 database, or environment variable to store session tokens
 */
export async function isAuthenticated(request, env) {
  const token = getSessionToken(request);
  if (!token) return false;
  
  // Check if token exists in KV store (preferred)
  if (env.AUTH_TOKENS) {
    try {
      const storedToken = await env.AUTH_TOKENS.get(`session:${token}`);
      return storedToken === 'valid';
    } catch (e) {
      // KV might not be configured, fall back to database
    }
  }
  
  // Fallback: check in D1 database
  if (env.DB) {
    try {
      const result = await env.DB.prepare(
        `SELECT token FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')`
      ).bind(token).first();
      return !!result;
    } catch (e) {
      // Table might not exist yet, fall back to env variable
    }
  }
  
  // Last fallback: check against allowed tokens in env variable (comma-separated)
  const allowedTokens = env.ALLOWED_SESSION_TOKENS ? env.ALLOWED_SESSION_TOKENS.split(',') : [];
  return allowedTokens.includes(token);
}

/**
 * Check a bearer token scoped to machine ingestion endpoints.
 */
export function isIngestTokenAuthenticated(request, env) {
  const configuredTokens = getConfiguredIngestTokens(env);
  if (configuredTokens.length === 0) {
    return false;
  }

  const token = getBearerToken(request);
  if (!token) {
    return false;
  }

  return configuredTokens.some(configured => timingSafeStringEqual(token, configured));
}

function getConfiguredIngestTokens(env) {
  const raw = String(env?.INGEST_API_TOKENS || env?.INGEST_API_TOKEN || '').trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map(token => token.trim())
    .filter(Boolean);
}

function getBearerToken(request) {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function timingSafeStringEqual(a, b) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(String(a || ''));
  const bBytes = encoder.encode(String(b || ''));
  const length = Math.max(aBytes.length, bBytes.length, 1);
  const paddedA = new Uint8Array(length);
  const paddedB = new Uint8Array(length);

  paddedA.set(aBytes.slice(0, length));
  paddedB.set(bBytes.slice(0, length));

  let diff = aBytes.length === bBytes.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    diff |= paddedA[i] ^ paddedB[i];
  }

  return diff === 0;
}

/**
 * Create a new session
 */
export async function createSession(env) {
  const token = generateToken();
  
  // Store in KV if available (preferred)
  if (env.AUTH_TOKENS) {
    try {
      await env.AUTH_TOKENS.put(`session:${token}`, 'valid', { expirationTtl: 86400 }); // 24 hours
      return token;
    } catch (e) {
      // KV might not be configured, fall back to database
    }
  }
  
  // Fallback: store in D1 database
  if (env.DB) {
    try {
      // Create sessions table if it doesn't exist
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS admin_sessions (
          token TEXT PRIMARY KEY,
          expires_at TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )`
      ).run();
      
      // Insert session (expires in 24 hours)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      await env.DB.prepare(
        `INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)`
      ).bind(token, expiresAt.toISOString()).run();
      
      return token;
    } catch (e) {
      console.error('Failed to store session in database:', e);
    }
  }
  
  throw new Error('No session storage available (KV or DB required)');
}

/**
 * Destroy a session
 */
export async function destroySession(token, env) {
  // Delete from KV if available
  if (env.AUTH_TOKENS) {
    try {
      await env.AUTH_TOKENS.delete(`session:${token}`);
    } catch (e) {
      // KV might not be configured
    }
  }
  
  // Also delete from database (in case it was stored there)
  if (env.DB) {
    try {
      await env.DB.prepare(
        `DELETE FROM admin_sessions WHERE token = ?`
      ).bind(token).run();
    } catch (e) {
      // Table might not exist
    }
  }
}

/**
 * Authenticate user with password
 * Password should be stored as PBKDF2 hash in environment variable
 * Format: pbkdf2:<iterations>:<salt_hex>:<hash_hex>
 */
export async function authenticate(password, env) {
  const expectedHash = env.ADMIN_PASSWORD_HASH;
  if (!expectedHash) {
    throw new Error('Admin password not configured');
  }
  
  const isValid = await verifyPassword(password, expectedHash);
  if (!isValid) {
    return null;
  }
  
  return await createSession(env);
}

/**
 * Middleware to protect admin routes
 */
export async function requireAuth(request, env) {
  const authenticated = await isAuthenticated(request, env);
  if (!authenticated) {
    return new Response('Unauthorized', { 
      status: 401,
      headers: { 
        'Content-Type': 'text/plain',
        'Set-Cookie': clearSessionCookie()
      }
    });
  }
  return null; // null means authenticated
}
