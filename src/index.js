/**
 * Cloudflare Worker for Mass Murder Canada
 */

import { getAllRecords, findRecord, filterRecordsByGroup, filterRecordsByProvince } from './db.js';
import { renderHomePage, renderRecordPage } from './templates.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Verify DB binding exists
    if (!env.DB) {
      console.error('DB binding is missing. Available env keys:', Object.keys(env));
      return new Response('Database binding not configured. DB binding is missing from environment.', { 
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
      // Home page
      if (path === '/') {
        const records = await getAllRecords(env);
        return new Response(renderHomePage(records, path), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // Group filtering: /records/group/:group
      if (path.startsWith('/records/group/')) {
        const group = path.split('/records/group/')[1];
        const allRecords = await getAllRecords(env);
        const filteredRecords = filterRecordsByGroup(allRecords, group);
        return new Response(renderHomePage(filteredRecords, path), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // Province filtering: /records/provinces/:province
      if (path.startsWith('/records/provinces/')) {
        const province = path.split('/records/provinces/')[1];
        const allRecords = await getAllRecords(env);
        const filteredRecords = filterRecordsByProvince(allRecords, province);
        return new Response(renderHomePage(filteredRecords, path), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // Individual record: /records/:id
      if (path.startsWith('/records/')) {
        const id = path.split('/records/')[1];
        // Skip if it's a group or province route
        if (!id.includes('/')) {
          const record = await findRecord(env, id);
          return new Response(renderRecordPage(record, path), {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
      }

      // 404
      return new Response('Page not found', { status: 404 });
    } catch (error) {
      console.error('Error handling request:', error);
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  }
};

