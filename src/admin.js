/**
 * Admin REST API and database operations
 */

import { requireAuth, authenticate, destroySession } from './auth.js';
import * as Sentry from '@sentry/cloudflare';
import {
  enqueueRecordSummary,
  isAiSummaryEnabled,
  isAutoAiSummaryEnabled
} from './ai-summary.js';
import { enrichRecordLocation } from './ai-location.js';

function validateAndNormalizePublicHttpUrl(rawUrl) {
  if (!rawUrl) {
    return { ok: true, url: '' };
  }

  try {
    const parsed = new URL(rawUrl);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return { ok: false, error: 'URL must use http or https' };
    }

    if (parsed.username || parsed.password) {
      return { ok: false, error: 'URL must not include credentials' };
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname) {
      return { ok: false, error: 'URL host is required' };
    }

    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')
    ) {
      return { ok: false, error: 'Local hostnames are not allowed' };
    }

    if (isPrivateOrLocalIp(hostname)) {
      return { ok: false, error: 'Private/local IP ranges are not allowed' };
    }

    parsed.hostname = hostname;
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: 'Invalid URL format' };
  }
}

function isPrivateOrLocalIp(hostname) {
  return isPrivateIpv4(hostname) || isPrivateIpv6(hostname);
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map(p => Number.parseInt(p, 10));
  if (octets.some(n => Number.isNaN(n) || n < 0 || n > 255)) {
    return false;
  }

  const [a, b, c] = octets;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;

  return false;
}

function isPrivateIpv6(hostname) {
  if (!hostname.includes(':')) {
    return false;
  }

  const normalized = hostname.toLowerCase().split('%')[0];
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  return (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

async function enqueueRecordSummaryWithWarning(env, recordId, reason, context) {
  const result = await enqueueRecordSummary(env, recordId, reason);
  if (!result?.queued) {
    console.warn(
      `AI summary enqueue skipped (${context}): record=${recordId}, reason=${result?.reason || 'unknown'}`
    );
  }
}

function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseNumberInRange(value, defaultValue, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) return defaultValue;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function parseFloatInRange(value, defaultValue, min, max) {
  const parsed = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return defaultValue;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

async function readJsonBodySafe(request) {
  try {
    const raw = await request.text();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Admin API routes handler
 */
export async function handleAdminAPI(request, env, path, method) {
  // All admin routes require authentication
  const authCheck = await requireAuth(request, env);
  if (authCheck) return authCheck;

  // Parse path segments
  const segments = path.split('/').filter(s => s);
  // segments should be: ['admin', 'api', ...]

  if (segments.length < 3) {
    return new Response(JSON.stringify({ error: 'Invalid API endpoint' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const resource = segments[2]; // 'records' or 'stories'
  const id = segments[3]; // Optional ID
  const action = segments[4]; // Optional action for resource routes

  try {
    if (resource === 'records') {
      return await handleRecordsAPI(request, env, method, id, action);
    } else if (resource === 'stories') {
      return await handleStoriesAPI(request, env, method, id);
    } else if (resource === 'sentry-test') {
      return await handleSentryTestAPI(request, env, method);
    } else {
      return new Response(JSON.stringify({ error: 'Invalid resource' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Admin API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleSentryTestAPI(request, env, method) {
  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!env?.SENTRY_DSN) {
    return new Response(JSON.stringify({
      error: 'Sentry DSN is not configured in this environment'
    }), {
      status: 412,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const body = await readJsonBodySafe(request);
  const message = String(body?.message || 'Manual Sentry test event from admin').slice(0, 300);
  const generatedAt = new Date().toISOString();
  const path = new URL(request.url).pathname;
  const testError = new Error(`${message} [${generatedAt}]`);

  const eventId = Sentry.withScope(scope => {
    scope.setTag('source', 'admin-api');
    scope.setTag('event_type', 'manual_sentry_test');
    scope.setExtra('generated_at', generatedAt);
    scope.setExtra('path', path);
    return Sentry.captureException(testError);
  });

  let flushed = true;
  try {
    await Sentry.flush(2000);
  } catch (flushError) {
    flushed = false;
    console.error('Failed to flush Sentry test event:', flushError);
  }

  return new Response(JSON.stringify({
    success: true,
    eventId: eventId || null,
    flushed,
    message: flushed ? 'Sentry test event sent' : 'Sentry test event captured but flush was not confirmed'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Handle records API endpoints
 */
async function handleRecordsAPI(request, env, method, id, action) {
  switch (method) {
    case 'GET':
      if (id) {
        return await getRecord(env, id);
      } else {
        return await listRecords(env);
      }
    
    case 'POST':
      if (id === 'summarize-all') {
        return await triggerBulkRecordSummary(request, env);
      }
      if (id === 'enrich-location-all') {
        return await triggerBulkRecordLocationEnrichment(request, env);
      }
      if (id && action === 'summarize') {
        return await triggerRecordSummary(env, id);
      }
      if (id && action === 'enrich-location') {
        return await triggerRecordLocationEnrichment(request, env, id);
      }
      return await createRecord(request, env);
    
    case 'PUT':
      if (!id) {
        return new Response(JSON.stringify({ error: 'Record ID required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return await updateRecord(request, env, id);
    
    case 'DELETE':
      if (!id) {
        return new Response(JSON.stringify({ error: 'Record ID required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return await deleteRecord(env, id);
    
    default:
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
  }
}

/**
 * Handle news stories API endpoints
 */
async function handleStoriesAPI(request, env, method, id) {
  switch (method) {
    case 'GET':
      if (id) {
        return await getStory(env, id);
      } else {
        // Optionally filter by record_id
        const url = new URL(request.url);
        const recordId = url.searchParams.get('record_id');
        return await listStories(env, recordId);
      }
    
    case 'POST':
      return await createStory(request, env);
    
    case 'PUT':
      if (!id) {
        return new Response(JSON.stringify({ error: 'Story ID required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return await updateStory(request, env, id);
    
    case 'DELETE':
      if (!id) {
        return new Response(JSON.stringify({ error: 'Story ID required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return await deleteStory(env, id);
    
    default:
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
  }
}

// Record CRUD operations

async function listRecords(env) {
  let result;
  try {
    result = await env.DB.prepare(
      `SELECT id, date, name, city, province, licensed, victims, deaths, 
              injuries, suicide, devices_used, firearms, possessed_legally, 
              warnings, oic_impact, ai_summary,
              city_verified, city_confidence, city_verification_source, city_verification_notes,
              location_lat, location_lon, location_source, location_confidence,
              location_updated_at, location_last_checked_at
       FROM records
       ORDER BY date DESC`
    ).all();
  } catch (error) {
    if (!isMissingLocationSchemaError(error)) {
      throw error;
    }

    // Fallback for environments where location migration has not yet been applied.
    result = await env.DB.prepare(
      `SELECT id, date, name, city, province, licensed, victims, deaths, 
              injuries, suicide, devices_used, firearms, possessed_legally, 
              warnings, oic_impact, ai_summary
       FROM records
       ORDER BY date DESC`
    ).all();
  }
  
  return new Response(JSON.stringify(result.results || []), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getRecord(env, id) {
  // Validate ID to prevent injection (allow UUIDs with dashes)
  if (!/^[a-zA-Z0-9_-]+$/.test(id.replace(/-/g, ''))) {
    return new Response(JSON.stringify({ error: 'Invalid record ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  let record;
  try {
    record = await env.DB.prepare(
      `SELECT id, date, name, city, province, licensed, victims, deaths, 
              injuries, suicide, devices_used, firearms, possessed_legally, 
              warnings, oic_impact, ai_summary,
              city_verified, city_confidence, city_verification_source, city_verification_notes,
              location_lat, location_lon, location_source, location_confidence,
              location_updated_at, location_last_checked_at
       FROM records
       WHERE id = ?`
    ).bind(id).first();
  } catch (error) {
    if (!isMissingLocationSchemaError(error)) {
      throw error;
    }

    // Fallback for environments where location migration has not yet been applied.
    record = await env.DB.prepare(
      `SELECT id, date, name, city, province, licensed, victims, deaths, 
              injuries, suicide, devices_used, firearms, possessed_legally, 
              warnings, oic_impact, ai_summary
       FROM records
       WHERE id = ?`
    ).bind(id).first();
  }
  
  if (!record) {
    return new Response(JSON.stringify({ error: 'Record not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Get associated news stories
  const stories = await env.DB.prepare(
    `SELECT id, record_id, url, body_text, ai_summary FROM news_stories WHERE record_id = ?`
  ).bind(id).all();
  
  return new Response(JSON.stringify({
    ...record,
    newsStories: stories.results || []
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function createRecord(request, env) {
  const body = await request.json();
  
  // Validate required fields
  if (!body.id || !body.date) {
    return new Response(JSON.stringify({ error: 'ID and date are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Validate ID format (allow UUIDs with dashes)
  if (!/^[a-zA-Z0-9_-]+$/.test(body.id.replace(/-/g, ''))) {
    return new Response(JSON.stringify({ error: 'Invalid ID format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Validate date format (should be 4-digit year)
  if (body.date && !/^\d{4}$/.test(String(body.date).trim())) {
    return new Response(JSON.stringify({ error: 'Date must be a 4-digit year (e.g., 2024)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (body.newsStories && Array.isArray(body.newsStories)) {
    // Limit number of stories to prevent DoS
    if (body.newsStories.length > 100) {
      return new Response(JSON.stringify({ error: 'Too many news stories (maximum 100)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    for (const story of body.newsStories) {
      if (!story?.url) continue;
      const validated = validateAndNormalizePublicHttpUrl(story.url);
      if (!validated.ok) {
        return new Response(JSON.stringify({ error: `Invalid or unsafe story URL: ${validated.error}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      story.url = validated.url;
    }
  }
  
  try {
    const result = await env.DB.prepare(
      `INSERT INTO records (id, date, name, city, province, licensed, victims, 
                           deaths, injuries, suicide, devices_used, firearms, 
                           possessed_legally, warnings, oic_impact, ai_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      body.id,
      body.date || null,
      body.name || null,
      body.city || null,
      body.province || null,
      body.licensed !== undefined ? (body.licensed ? 1 : 0) : null,
      body.victims || null,
      body.deaths || null,
      body.injuries || null,
      body.suicide !== undefined ? (body.suicide ? 1 : 0) : null,
      body.devices_used || null,
      body.firearms !== undefined ? (body.firearms ? 1 : 0) : null,
      body.possessed_legally !== undefined ? (body.possessed_legally ? 1 : 0) : null,
      body.warnings || null,
      body.oic_impact !== undefined ? (body.oic_impact ? 1 : 0) : null,
      body.ai_summary || null
    ).run();
    
    // Handle news stories if provided
    if (body.newsStories && Array.isArray(body.newsStories)) {
      for (const story of body.newsStories) {
        if (story.id && story.url) {
          // Validate story ID format (allow UUIDs with dashes)
          if (!/^[a-zA-Z0-9_-]+$/.test(story.id.replace(/-/g, ''))) {
            continue; // Skip invalid story IDs
          }
          
          try {
            await env.DB.prepare(
              `INSERT INTO news_stories (id, record_id, url, body_text, ai_summary)
               VALUES (?, ?, ?, ?, ?)`
            ).bind(
              story.id,
              body.id,
              story.url || null,
              story.body_text || null,
              story.ai_summary || null
            ).run();
          } catch (e) {
            // Ignore duplicate story errors, continue with others
            if (!e.message.includes('UNIQUE') && !e.message.includes('unique')) {
              console.error('Error creating story:', e);
            }
          }
        }
      }
    }

    if (isAutoAiSummaryEnabled(env)) {
      try {
        await enqueueRecordSummaryWithWarning(env, body.id, 'record_created', 'record_create');
      } catch (error) {
        console.error('Failed to enqueue record summary after create:', error);
      }
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      id: body.id,
      message: 'Record created successfully'
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    // Check if it's a unique constraint violation
    if (error.message.includes('UNIQUE') || error.message.includes('unique')) {
      return new Response(JSON.stringify({ error: 'Record with this ID already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw error;
  }
}

async function updateRecord(request, env, id) {
  // Validate ID (allow UUIDs with dashes)
  if (!/^[a-zA-Z0-9_-]+$/.test(id.replace(/-/g, ''))) {
    return new Response(JSON.stringify({ error: 'Invalid record ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const body = await request.json();
  
  // Check if record exists
  const existing = await env.DB.prepare(
    `SELECT id FROM records WHERE id = ?`
  ).bind(id).first();
  
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Record not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Build UPDATE query dynamically based on provided fields
  const updates = [];
  const values = [];
  
  // Validate date format if provided
  if (body.date !== undefined && body.date !== null) {
    const dateStr = String(body.date).trim();
    if (!/^\d{4}$/.test(dateStr)) {
      return new Response(JSON.stringify({ error: 'Date must be a 4-digit year (e.g., 2024)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (body.newsStories !== undefined && Array.isArray(body.newsStories)) {
    // Limit number of stories to prevent DoS
    if (body.newsStories.length > 100) {
      return new Response(JSON.stringify({ error: 'Too many news stories (maximum 100)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    for (const story of body.newsStories) {
      if (!story?.url) continue;
      const validated = validateAndNormalizePublicHttpUrl(story.url);
      if (!validated.ok) {
        return new Response(JSON.stringify({ error: `Invalid or unsafe story URL: ${validated.error}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      story.url = validated.url;
    }
  }
  
  const fields = {
    date: body.date,
    name: body.name,
    city: body.city,
    province: body.province,
    licensed: body.licensed !== undefined ? (body.licensed ? 1 : 0) : undefined,
    victims: body.victims,
    deaths: body.deaths,
    injuries: body.injuries,
    suicide: body.suicide !== undefined ? (body.suicide ? 1 : 0) : undefined,
    devices_used: body.devices_used,
    firearms: body.firearms !== undefined ? (body.firearms ? 1 : 0) : undefined,
    possessed_legally: body.possessed_legally !== undefined ? (body.possessed_legally ? 1 : 0) : undefined,
    warnings: body.warnings,
    oic_impact: body.oic_impact !== undefined ? (body.oic_impact ? 1 : 0) : undefined,
    ai_summary: body.ai_summary
  };
  
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      updates.push(`${key} = ?`);
      values.push(value);
    }
  }
  
  if (updates.length === 0) {
    return new Response(JSON.stringify({ error: 'No fields to update' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  values.push(id); // For WHERE clause
  
  await env.DB.prepare(
    `UPDATE records SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();
  
  // Handle news stories if provided
  if (body.newsStories !== undefined && Array.isArray(body.newsStories)) {
    // Get current stories
    const currentStories = await env.DB.prepare(
      `SELECT id FROM news_stories WHERE record_id = ?`
    ).bind(id).all();
    const currentIds = new Set((currentStories.results || []).map(s => s.id));
    
    // Determine which to delete (removed from array)
    const newIds = new Set(body.newsStories.map(s => s.id));
    for (const currentId of currentIds) {
      if (!newIds.has(currentId)) {
        await env.DB.prepare(
          `DELETE FROM news_stories WHERE id = ?`
        ).bind(currentId).run();
      }
    }
    
    // Add or update stories
    for (const story of body.newsStories) {
      if (story.id && story.url) {
        // Validate story ID format (allow UUIDs with dashes)
        if (!/^[a-zA-Z0-9_-]+$/.test(story.id.replace(/-/g, ''))) {
          continue; // Skip invalid story IDs
        }
        
        // Check if story exists
        const existing = await env.DB.prepare(
          `SELECT id FROM news_stories WHERE id = ?`
        ).bind(story.id).first();
        
        if (existing) {
          // Update existing story
          await env.DB.prepare(
            `UPDATE news_stories SET url = ?, body_text = ?, ai_summary = ? WHERE id = ?`
          ).bind(
            story.url || null,
            story.body_text || null,
            story.ai_summary || null,
            story.id
          ).run();
        } else {
          // Insert new story
          await env.DB.prepare(
            `INSERT INTO news_stories (id, record_id, url, body_text, ai_summary)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(
            story.id,
            id,
            story.url || null,
            story.body_text || null,
            story.ai_summary || null
          ).run();
        }
      }
    }
  }

  if (isAutoAiSummaryEnabled(env)) {
    try {
      await enqueueRecordSummaryWithWarning(env, id, 'record_updated', 'record_update');
    } catch (error) {
      console.error('Failed to enqueue record summary after update:', error);
    }
  }
  
  return new Response(JSON.stringify({ 
    success: true, 
    id: id,
    message: 'Record updated successfully'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function deleteRecord(env, id) {
  // Validate ID (allow UUIDs with dashes)
  if (!/^[a-zA-Z0-9_-]+$/.test(id.replace(/-/g, ''))) {
    return new Response(JSON.stringify({ error: 'Invalid record ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Also delete associated news stories
  await env.DB.prepare(
    `DELETE FROM news_stories WHERE record_id = ?`
  ).bind(id).run();
  
  const result = await env.DB.prepare(
    `DELETE FROM records WHERE id = ?`
  ).bind(id).run();
  
  if (result.changes === 0) {
    return new Response(JSON.stringify({ error: 'Record not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response(JSON.stringify({ 
    success: true, 
    message: 'Record deleted successfully'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// News Stories CRUD operations

async function listStories(env, recordId = null) {
  let query = `SELECT id, record_id, url, body_text, ai_summary FROM news_stories`;
  let params = [];
  
  if (recordId) {
    // Validate record_id
    if (!/^[a-zA-Z0-9_-]+$/.test(recordId)) {
      return new Response(JSON.stringify({ error: 'Invalid record ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    query += ` WHERE record_id = ?`;
    params.push(recordId);
  }
  
  query += ` ORDER BY id`;
  
  const result = await env.DB.prepare(query).bind(...params).all();
  
  return new Response(JSON.stringify(result.results || []), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getStory(env, id) {
  // Validate ID (allow UUIDs with dashes)
  if (!/^[a-zA-Z0-9_-]+$/.test(id.replace(/-/g, ''))) {
    return new Response(JSON.stringify({ error: 'Invalid story ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const story = await env.DB.prepare(
    `SELECT id, record_id, url, body_text, ai_summary FROM news_stories WHERE id = ?`
  ).bind(id).first();
  
  if (!story) {
    return new Response(JSON.stringify({ error: 'Story not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response(JSON.stringify(story), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function createStory(request, env) {
  const body = await request.json();
  
  // Validate required fields
  if (!body.id || !body.record_id) {
    return new Response(JSON.stringify({ error: 'ID and record_id are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Validate ID format (allow UUIDs with dashes)
  if (!/^[a-zA-Z0-9_-]+$/.test(body.id.replace(/-/g, '')) || !/^[a-zA-Z0-9_-]+$/.test(body.record_id.replace(/-/g, ''))) {
    return new Response(JSON.stringify({ error: 'Invalid ID format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Verify record exists
  const record = await env.DB.prepare(
    `SELECT id FROM records WHERE id = ?`
  ).bind(body.record_id).first();
  
  if (!record) {
    return new Response(JSON.stringify({ error: 'Record not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (body.url) {
    const validated = validateAndNormalizePublicHttpUrl(body.url);
    if (!validated.ok) {
      return new Response(JSON.stringify({ error: `Invalid or unsafe URL: ${validated.error}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    body.url = validated.url;
  }
  
  try {
    await env.DB.prepare(
      `INSERT INTO news_stories (id, record_id, url, body_text, ai_summary)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      body.id,
      body.record_id,
      body.url || null,
      body.body_text || null,
      body.ai_summary || null
    ).run();

    if (isAutoAiSummaryEnabled(env)) {
      try {
        await enqueueRecordSummaryWithWarning(env, body.record_id, 'story_created', 'story_create');
      } catch (queueError) {
        console.error('Failed to enqueue record summary after story create:', queueError);
      }
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      id: body.id,
      message: 'Story created successfully'
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    if (error.message.includes('UNIQUE') || error.message.includes('unique')) {
      return new Response(JSON.stringify({ error: 'Story with this ID already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw error;
  }
}

async function updateStory(request, env, id) {
  // Validate ID (allow UUIDs with dashes)
  if (!/^[a-zA-Z0-9_-]+$/.test(id.replace(/-/g, ''))) {
    return new Response(JSON.stringify({ error: 'Invalid story ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const body = await request.json();

  if (body.url !== undefined && body.url !== null && body.url !== '') {
    const validated = validateAndNormalizePublicHttpUrl(body.url);
    if (!validated.ok) {
      return new Response(JSON.stringify({ error: `Invalid or unsafe URL: ${validated.error}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    body.url = validated.url;
  }
  
  // Check if story exists
  const existing = await env.DB.prepare(
    `SELECT id, record_id FROM news_stories WHERE id = ?`
  ).bind(id).first();
  
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Story not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // If record_id is being updated, verify it exists
  if (body.record_id) {
    if (!/^[a-zA-Z0-9_-]+$/.test(body.record_id.replace(/-/g, ''))) {
      return new Response(JSON.stringify({ error: 'Invalid record_id format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const record = await env.DB.prepare(
      `SELECT id FROM records WHERE id = ?`
    ).bind(body.record_id).first();
    
    if (!record) {
      return new Response(JSON.stringify({ error: 'Record not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  // Build UPDATE query
  const updates = [];
  const values = [];
  
  const fields = {
    record_id: body.record_id,
    url: body.url,
    body_text: body.body_text,
    ai_summary: body.ai_summary
  };
  
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      updates.push(`${key} = ?`);
      values.push(value);
    }
  }
  
  if (updates.length === 0) {
    return new Response(JSON.stringify({ error: 'No fields to update' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  values.push(id);
  
  await env.DB.prepare(
    `UPDATE news_stories SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  if (isAutoAiSummaryEnabled(env)) {
    try {
      const targetRecordId = body.record_id || existing.record_id;
      await enqueueRecordSummaryWithWarning(env, targetRecordId, 'story_updated', 'story_update');

      if (body.record_id && body.record_id !== existing.record_id) {
        await enqueueRecordSummaryWithWarning(env, existing.record_id, 'story_moved', 'story_move');
      }
    } catch (queueError) {
      console.error('Failed to enqueue record summary after story update:', queueError);
    }
  }
  
  return new Response(JSON.stringify({ 
    success: true, 
    id: id,
    message: 'Story updated successfully'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function deleteStory(env, id) {
  // Validate ID (allow UUIDs with dashes)
  if (!/^[a-zA-Z0-9_-]+$/.test(id.replace(/-/g, ''))) {
    return new Response(JSON.stringify({ error: 'Invalid story ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const result = await env.DB.prepare(
    `DELETE FROM news_stories WHERE id = ?`
  ).bind(id).run();
  
  if (result.changes === 0) {
    return new Response(JSON.stringify({ error: 'Story not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response(JSON.stringify({ 
    success: true, 
    message: 'Story deleted successfully'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function triggerRecordSummary(env, id) {
  // Validate ID (allow UUIDs with dashes)
  if (!/^[a-zA-Z0-9_-]+$/.test(id.replace(/-/g, ''))) {
    return new Response(JSON.stringify({ error: 'Invalid record ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!isAiSummaryEnabled(env)) {
    return new Response(JSON.stringify({
      error: 'AI summarization is disabled in this environment'
    }), {
      status: 412,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const record = await env.DB.prepare(
    `SELECT id FROM records WHERE id = ?`
  ).bind(id).first();

  if (!record) {
    return new Response(JSON.stringify({ error: 'Record not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const enqueueResult = await enqueueRecordSummary(env, id, 'manual_trigger');
    if (!enqueueResult.queued) {
      return new Response(JSON.stringify({
        error: 'Summary queue is not configured in this environment'
      }), {
        status: 412,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      id,
      message: 'Summary job queued'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Failed to queue summary job:', error);
    return new Response(JSON.stringify({
      error: 'Failed to queue summary job'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function triggerBulkRecordSummary(request, env) {
  if (!isAiSummaryEnabled(env)) {
    return new Response(JSON.stringify({
      error: 'AI summarization is disabled in this environment'
    }), {
      status: 412,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!env?.SUMMARY_QUEUE) {
    return new Response(JSON.stringify({
      error: 'Summary queue is not configured in this environment'
    }), {
      status: 412,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const body = await readJsonBodySafe(request);
  const requestUrl = new URL(request.url);
  const searchParams = requestUrl.searchParams;

  const limit = parseNumberInRange(
    body.limit ?? searchParams.get('limit'),
    25,
    1,
    100
  );
  const offset = parseNumberInRange(
    body.offset ?? searchParams.get('offset'),
    0,
    0,
    1000000
  );
  const onlyMissing = parseBooleanFlag(
    body.only_missing ?? body.onlyMissing ?? searchParams.get('only_missing'),
    true
  );
  const includeFallback = parseBooleanFlag(
    body.include_fallback ?? body.includeFallback ?? searchParams.get('include_fallback'),
    true
  );

  const predicates = [];
  if (onlyMissing) {
    predicates.push(`ai_summary IS NULL`);
    predicates.push(`TRIM(ai_summary) = ''`);
    if (includeFallback) {
      predicates.push(`ai_summary LIKE '%Automated fallback summary for%'`);
    }
  }

  const whereClause = predicates.length > 0
    ? `WHERE (${predicates.join(' OR ')})`
    : '';

  const eligibleResult = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM records
     ${whereClause}`
  ).first();
  const eligibleCount = Number.parseInt(String(eligibleResult?.total || 0), 10) || 0;

  const recordsResult = await env.DB.prepare(
    `SELECT id
     FROM records
     ${whereClause}
     ORDER BY date DESC, id
     LIMIT ?
     OFFSET ?`
  ).bind(limit, offset).all();

  const records = recordsResult.results || [];
  let queuedCount = 0;
  let skippedCount = 0;

  for (const record of records) {
    const enqueueResult = await enqueueRecordSummary(env, record.id, 'bulk_backfill', {
      offset: 0
    });
    if (enqueueResult?.queued) {
      queuedCount += 1;
    } else {
      skippedCount += 1;
      console.warn(
        `AI summary enqueue skipped (bulk_backfill): record=${record.id}, reason=${enqueueResult?.reason || 'unknown'}`
      );
    }
  }

  const selectedCount = records.length;
  const nextOffset = offset + selectedCount;
  const hasMore = nextOffset < eligibleCount;

  return new Response(JSON.stringify({
    success: true,
    onlyMissing,
    includeFallback,
    limit,
    offset,
    eligibleCount,
    selectedCount,
    queuedCount,
    skippedCount,
    hasMore,
    nextOffset: hasMore ? nextOffset : null
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function isMissingLocationSchemaError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('no such column: city_verified') ||
    message.includes('no such column: location_lat') ||
    message.includes('no such table: city_geocode_cache')
  );
}

async function markLocationCheckError(env, recordId, error) {
  const nowIso = new Date().toISOString();
  const errorText = String(error?.message || error || 'unknown error').slice(0, 300);

  await env.DB.prepare(
    `UPDATE records
     SET city_verification_source = COALESCE(city_verification_source, 'error'),
         city_verification_notes = ?,
         location_last_checked_at = ?
     WHERE id = ?`
  ).bind(
    `Location enrichment failed: ${errorText}`,
    nowIso,
    recordId
  ).run();
}

async function triggerRecordLocationEnrichment(request, env, id) {
  // Validate ID (allow UUIDs with dashes)
  if (!/^[a-zA-Z0-9_-]+$/.test(id.replace(/-/g, ''))) {
    return new Response(JSON.stringify({ error: 'Invalid record ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const body = await readJsonBodySafe(request);
  const requestUrl = new URL(request.url);
  const searchParams = requestUrl.searchParams;

  const force = parseBooleanFlag(
    body.force ?? searchParams.get('force'),
    false
  );
  const geocode = parseBooleanFlag(
    body.geocode ?? searchParams.get('geocode'),
    true
  );
  const minConfidence = parseFloatInRange(
    body.min_confidence ?? body.minConfidence ?? searchParams.get('min_confidence'),
    Number.NaN,
    0,
    1
  );

  const options = {
    force,
    geocode
  };
  if (Number.isFinite(minConfidence)) {
    options.minConfidence = minConfidence;
  }

  try {
    const result = await enrichRecordLocation(env, id, options);

    if (!result.ok && result.status === 'not_found') {
      return new Response(JSON.stringify({ error: 'Record not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: !!result.ok,
      ...result
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    if (isMissingLocationSchemaError(error)) {
      return new Response(JSON.stringify({
        error: 'Location enrichment schema is missing. Apply migration 0003_location_enrichment.sql first.'
      }), {
        status: 412,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.error('Failed to enrich location for record:', id, error);
    return new Response(JSON.stringify({
      error: 'Failed to enrich location for record'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function triggerBulkRecordLocationEnrichment(request, env) {
  const body = await readJsonBodySafe(request);
  const requestUrl = new URL(request.url);
  const searchParams = requestUrl.searchParams;

  const limit = parseNumberInRange(
    body.limit ?? searchParams.get('limit'),
    4,
    1,
    50
  );
  const offset = parseNumberInRange(
    body.offset ?? searchParams.get('offset'),
    0,
    0,
    1000000
  );
  const onlyMissing = parseBooleanFlag(
    body.only_missing ?? body.onlyMissing ?? searchParams.get('only_missing'),
    true
  );
  const force = parseBooleanFlag(
    body.force ?? searchParams.get('force'),
    false
  );
  const geocode = parseBooleanFlag(
    body.geocode ?? searchParams.get('geocode'),
    true
  );
  const minConfidence = parseFloatInRange(
    body.min_confidence ?? body.minConfidence ?? searchParams.get('min_confidence'),
    Number.NaN,
    0,
    1
  );

  const whereClauses = [];
  const missingPredicate = `(city_verified IS NULL OR TRIM(city_verified) = '' OR location_lat IS NULL OR location_lon IS NULL)`;
  if (onlyMissing) {
    whereClauses.push(missingPredicate);
    if (!force) {
      // In non-force mode, only process records that have not been checked yet.
      // This prevents endless reprocessing of unresolved/unggeocodable records.
      whereClauses.push(`location_last_checked_at IS NULL`);
    }
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const useDynamicMissingWindow = onlyMissing && !force;
  const effectiveOffset = useDynamicMissingWindow ? 0 : offset;

  try {
    const eligibleResult = await env.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM records
       ${whereSql}`
    ).first();
    const eligibleCount = Number.parseInt(String(eligibleResult?.total || 0), 10) || 0;

    const unresolvedResult = await env.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM records
       WHERE ${missingPredicate}
         AND location_last_checked_at IS NOT NULL`
    ).first();
    const unresolvedCount = Number.parseInt(String(unresolvedResult?.total || 0), 10) || 0;

    const recordsResult = await env.DB.prepare(
      `SELECT id
       FROM records
       ${whereSql}
       ORDER BY date DESC, id
       LIMIT ?
       OFFSET ?`
    ).bind(limit, effectiveOffset).all();

    const records = recordsResult.results || [];
    const details = [];
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const row of records) {
      const options = {
        force,
        geocode
      };
      if (Number.isFinite(minConfidence)) {
        options.minConfidence = minConfidence;
      }

      try {
        const outcome = await enrichRecordLocation(env, row.id, options);
        if (outcome.ok) {
          if (String(outcome.status || '').startsWith('skipped')) {
            skippedCount += 1;
          } else {
            updatedCount += 1;
          }
        } else {
          failedCount += 1;
        }

        if (details.length < 25) {
          details.push({
            id: row.id,
            status: outcome.status || (outcome.ok ? 'updated' : 'failed'),
            cityVerified: outcome.cityVerified || null,
            geocodeStatus: outcome.geocodeStatus || null
          });
        }
      } catch (error) {
        failedCount += 1;
        try {
          await markLocationCheckError(env, row.id, error);
        } catch (markError) {
          console.error('Failed to mark location check error for record:', row.id, markError);
        }
        if (details.length < 25) {
          details.push({
            id: row.id,
            status: 'failed',
            error: String(error?.message || error || 'unknown error')
          });
        }
      }
    }

    const selectedCount = records.length;
    let hasMore;
    let nextOffset;
    let remainingCount = null;

    if (useDynamicMissingWindow) {
      const remainingResult = await env.DB.prepare(
        `SELECT COUNT(*) AS total
         FROM records
         ${whereSql}`
      ).first();
      remainingCount = Number.parseInt(String(remainingResult?.total || 0), 10) || 0;
      hasMore = remainingCount > 0;
      nextOffset = hasMore ? 0 : null;
    } else {
      nextOffset = offset + selectedCount;
      hasMore = nextOffset < eligibleCount;
    }

    return new Response(JSON.stringify({
      success: true,
      onlyMissing,
      force,
      geocode,
      limit,
      offset,
      effectiveOffset,
      eligibleCount,
      unresolvedCount,
      remainingCount,
      selectedCount,
      updatedCount,
      skippedCount,
      failedCount,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
      details
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    if (isMissingLocationSchemaError(error)) {
      return new Response(JSON.stringify({
        error: 'Location enrichment schema is missing. Apply migration 0003_location_enrichment.sql first.'
      }), {
        status: 412,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.error('Failed bulk location enrichment:', error);
    return new Response(JSON.stringify({
      error: 'Failed bulk location enrichment'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
