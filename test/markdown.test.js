import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

const RECORD = {
  id: 'record-1',
  date: '2024-01-02',
  name: 'Test Event',
  city: 'Calgary',
  province: 'AB',
  licensed: 1,
  victims: 4,
  deaths: 2,
  injuries: 1,
  suicide: 0,
  devices_used: 'Rifle',
  firearms: 1,
  possessed_legally: 1,
  warnings: 'Warning text',
  oic_impact: 1,
  ai_summary: 'A **concise** summary.',
  newsStories: [
    {
      url: 'https://www.cbc.ca/news/test-event',
      ai_summary: 'A reported source summary.'
    }
  ]
};

function createEnv(records = [RECORD]) {
  return {
    DB: {
      prepare(sql) {
        const statement = {
          bind() {
            return statement;
          },
          all: async () => ({
            results: sql.includes('news_stories') ? (RECORD.newsStories || []) : records
          }),
          first: async () => records[0] || null
        };
        return statement;
      }
    }
  };
}

function fetchPage(path, env, headers = {}) {
  return worker.fetch(
    new Request(`https://massmurdercanada.org${path}`, { headers }),
    env,
    { waitUntil() {} }
  );
}

test('serves the home page as Markdown when requested', async () => {
  const response = await fetchPage('/', createEnv(), { Accept: 'text/markdown' });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(response.headers.get('vary'), 'Accept');
  assert.match(response.headers.get('x-markdown-tokens'), /^\d+$/);
  assert.match(body, /^# Mass Murder/);
  assert.match(body, /\| Date \| Name \| City \| Province/);
  assert.match(body, /\[Test Event\]\(\/records\/record-1\)/);
  assert.doesNotMatch(body, /<!DOCTYPE html>|<script|<style/);
});

test('keeps HTML as the default representation and varies on Accept', async () => {
  const response = await fetchPage('/', createEnv());
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('vary'), 'Accept');
  assert.match(body, /^<!DOCTYPE html>/);
});

test('renders the province map as Markdown with accessible summaries', async () => {
  const response = await fetchPage('/map/canada', createEnv(), { Accept: 'text/markdown' });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.match(body, /^# Mass Murder Canada — Province Map/);
  assert.match(body, /## Province summary/);
  assert.match(body, /\[AB\]\(\/records\/provinces\/ab\)/);
  assert.match(body, /\[Test Event\]\(\/records\/record-1\)/);
});

test('renders an individual record as Markdown with source and summary content', async () => {
  const response = await fetchPage('/records/record-1', createEnv(), { Accept: 'text/markdown' });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.match(body, /## Test Event in Calgary in 2024/);
  assert.match(body, /### Used\n\nRifle/);
  assert.match(body, /### Warnings\n\nWarning text/);
  assert.match(body, /### AI Synthesis\n\nA \*\*concise\*\* summary\./);
  assert.match(body, /\[News\]\(https:\/\/www\.cbc\.ca\/news\/test-event\)/);
  assert.match(body, /A reported source summary\./);
});

test('negotiates filtered pages and respects an explicit zero Markdown quality', async () => {
  const otherRecord = {
    ...RECORD,
    id: 'record-2',
    name: 'Other Event',
    province: 'ON',
    victims: 2
  };
  const env = createEnv([RECORD, otherRecord]);

  const group = await fetchPage('/records/group/mass', env, {
    Accept: 'text/markdown; q=0.8, text/html; q=0.9'
  });
  const groupBody = await group.text();
  assert.equal(group.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.match(groupBody, /^# Mass Murder Canada — Mass Killings/);
  assert.match(groupBody, /Events: 1/);

  const province = await fetchPage('/records/provinces/ab', env, { Accept: 'text/markdown' });
  const provinceBody = await province.text();
  assert.equal(province.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.match(provinceBody, /^# Mass Murder Canada — Province AB/);
  assert.match(provinceBody, /\[Test Event\]\(\/records\/record-1\)/);

  const html = await fetchPage('/', env, { Accept: 'text/markdown; q=0, text/html' });
  assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');
});

test('does not negotiate Markdown for robots or sitemap responses', async () => {
  const env = createEnv();
  const robots = await fetchPage('/robots.txt', env, { Accept: 'text/markdown' });
  const sitemap = await fetchPage('/sitemap.xml', env, { Accept: 'text/markdown' });

  assert.equal(robots.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(sitemap.headers.get('content-type'), 'application/xml; charset=utf-8');
});
