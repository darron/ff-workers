/**
 * Cloudflare Worker for Mass Murder Canada
 */

import { getAllRecords, findRecord, filterRecordsByGroup, filterRecordsByProvince } from './db.js';
import { renderHomePage, renderRecordPage } from './templates.js';
import { handleAdminAPI } from './admin.js';
import { authenticate, destroySession, isAuthenticated, setSessionCookie, clearSessionCookie } from './auth.js';
import { renderLoginPage, renderAdminDashboard } from './admin-ui.js';

/**
 * Validate and sanitize path segments to prevent path traversal
 */
function sanitizePathSegment(segment) {
  if (!segment) return null;
  // Remove any path traversal attempts and only allow alphanumeric, hyphens, underscores
  const sanitized = segment.replace(/[^a-zA-Z0-9_-]/g, '');
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Extract and validate ID from path
 */
function extractId(path, prefix) {
  const parts = path.split(prefix);
  if (parts.length < 2) return null;
  const segment = parts[1].split('/')[0]; // Get first segment only
  return sanitizePathSegment(segment);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Verify DB binding exists
    if (!env.DB) {
      console.error('DB binding is missing. Available env keys:', Object.keys(env));
      return new Response('Database binding not configured.', { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Handle static assets (CSS, etc.)
    if (path.startsWith('/css/')) {
      return new Response('/* CSS styles are inlined in templates */', {
        headers: { 'Content-Type': 'text/css' }
      });
    }

    try {
      // Admin routes (require authentication)
      if (path === '/admin' || path.startsWith('/admin/')) {
        return await handleAdminRoutes(request, env, path, method);
      }

      // Public routes
      // Home page
      if (path === '/') {
        const records = await getAllRecords(env);
        return new Response(renderHomePage(records, path), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // Group filtering: /records/group/:group
      if (path.startsWith('/records/group/')) {
        const group = extractId(path, '/records/group/');
        if (!group) {
          return new Response('Invalid group', { status: 400 });
        }
        const allRecords = await getAllRecords(env);
        const filteredRecords = filterRecordsByGroup(allRecords, group);
        return new Response(renderHomePage(filteredRecords, path), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // Province filtering: /records/provinces/:province
      if (path.startsWith('/records/provinces/')) {
        const province = extractId(path, '/records/provinces/');
        if (!province) {
          return new Response('Invalid province', { status: 400 });
        }
        const allRecords = await getAllRecords(env);
        const filteredRecords = filterRecordsByProvince(allRecords, province);
        return new Response(renderHomePage(filteredRecords, path), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // Individual record: /records/:id
      if (path.startsWith('/records/')) {
        const id = extractId(path, '/records/');
        if (!id) {
          return new Response('Invalid record ID', { status: 400 });
        }
        const record = await findRecord(env, id);
        if (!record) {
          return new Response('Record not found', { status: 404 });
        }
        return new Response(renderRecordPage(record, path), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // 404
      return new Response('Page not found', { status: 404 });
    } catch (error) {
      console.error('Error handling request:', error);
      // Don't expose internal error details to users
      return new Response('An error occurred', { status: 500 });
    }
  }
};

/**
 * Handle admin routes
 */
async function handleAdminRoutes(request, env, path, method) {
  // Admin login
  if (path === '/admin/login') {
    if (method === 'GET') {
      return new Response(renderLoginPage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } else if (method === 'POST') {
      const formData = await request.formData();
      const password = formData.get('password');
      
      if (!password) {
        return new Response(renderLoginPage('Password required'), {
          status: 400,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
      
      try {
        const token = await authenticate(password, env);
        if (!token) {
          return new Response(renderLoginPage('Invalid password'), {
            status: 401,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        
        return new Response(null, {
          status: 302,
          headers: {
            'Location': '/admin',
            'Set-Cookie': setSessionCookie(token)
          }
        });
      } catch (error) {
        console.error('Login error:', error);
        return new Response(renderLoginPage('Authentication error'), {
          status: 500,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    }
  }

  // Admin logout
  if (path === '/admin/logout' && method === 'POST') {
    const token = request.headers.get('Cookie')?.match(/admin_session=([^;]+)/)?.[1];
    if (token) {
      await destroySession(decodeURIComponent(token), env);
    }
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/admin/login',
        'Set-Cookie': clearSessionCookie()
      }
    });
  }

  // Check authentication for other admin routes
  const authenticated = await isAuthenticated(request, env);
  if (!authenticated) {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/admin/login'
      }
    });
  }

  // Admin dashboard
  if (path === '/admin' || path === '/admin/') {
    try {
      const [recordsResult, storiesResult] = await Promise.all([
        env.DB.prepare('SELECT id, date, name, city, province, victims, deaths FROM records ORDER BY date DESC LIMIT 100').all(),
        env.DB.prepare('SELECT id, record_id, url FROM news_stories ORDER BY id DESC LIMIT 100').all()
      ]);
      
      return new Response(renderAdminDashboard(
        recordsResult.results || [],
        storiesResult.results || []
      ), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      return new Response('Error loading dashboard', { status: 500 });
    }
  }

  // Admin API routes
  if (path.startsWith('/admin/api/')) {
    return await handleAdminAPI(request, env, path, method);
  }

  return new Response('Admin page not found', { status: 404 });
}

