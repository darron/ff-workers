/**
 * Admin REST API and database operations
 */

import { requireAuth, authenticate, destroySession } from './auth.js';

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

  try {
    if (resource === 'records') {
      return await handleRecordsAPI(request, env, method, id);
    } else if (resource === 'stories') {
      return await handleStoriesAPI(request, env, method, id);
    } else {
      return new Response(JSON.stringify({ error: 'Invalid resource' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Admin API error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle records API endpoints
 */
async function handleRecordsAPI(request, env, method, id) {
  switch (method) {
    case 'GET':
      if (id) {
        return await getRecord(env, id);
      } else {
        return await listRecords(env);
      }
    
    case 'POST':
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
  const result = await env.DB.prepare(
    `SELECT id, date, name, city, province, licensed, victims, deaths, 
            injuries, suicide, devices_used, firearms, possessed_legally, 
            warnings, oic_impact, ai_summary
     FROM records
     ORDER BY date DESC`
  ).all();
  
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
  
  const record = await env.DB.prepare(
    `SELECT id, date, name, city, province, licensed, victims, deaths, 
            injuries, suicide, devices_used, firearms, possessed_legally, 
            warnings, oic_impact, ai_summary
     FROM records
     WHERE id = ?`
  ).bind(id).first();
  
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
      // Limit number of stories to prevent DoS
      if (body.newsStories.length > 100) {
        return new Response(JSON.stringify({ error: 'Too many news stories (maximum 100)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      for (const story of body.newsStories) {
        if (story.id && story.url) {
          // Validate story ID format (allow UUIDs with dashes)
          if (!/^[a-zA-Z0-9_-]+$/.test(story.id.replace(/-/g, ''))) {
            continue; // Skip invalid story IDs
          }
          
          // Validate URL format
          try {
            new URL(story.url);
          } catch {
            continue; // Skip invalid URLs
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
    // Limit number of stories to prevent DoS
    if (body.newsStories.length > 100) {
      return new Response(JSON.stringify({ error: 'Too many news stories (maximum 100)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    for (const story of body.newsStories) {
      if (story.id && story.url) {
        // Validate story ID format (allow UUIDs with dashes)
        if (!/^[a-zA-Z0-9_-]+$/.test(story.id.replace(/-/g, ''))) {
          continue; // Skip invalid story IDs
        }
        
        // Validate URL format
        try {
          new URL(story.url);
        } catch {
          continue; // Skip invalid URLs
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
  
  // Check if story exists
  const existing = await env.DB.prepare(
    `SELECT id FROM news_stories WHERE id = ?`
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

