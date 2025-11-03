/**
 * Authentication utilities for admin access
 * Uses simple session-based auth with secure cookies
 */

/**
 * Hash a password using Web Crypto API
 */
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify a password against a hash
 */
async function verifyPassword(password, hash) {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
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
  return `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`; // 24 hours
}

/**
 * Clear session cookie
 */
export function clearSessionCookie() {
  return 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
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
      // Continue anyway - token is still generated
    }
  }
  
  return token;
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
 * Password should be stored as SHA-256 hash in environment variable
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

