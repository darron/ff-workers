import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/index.js';
import { renderHomePage } from '../src/templates.js';
import { renderWebMcpScript } from '../src/webmcp.js';

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
  ai_summary: 'A concise summary.',
  newsStories: []
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
            results: sql.includes('news_stories') ? [] : records
          }),
          first: async () => records[0] || null
        };
        return statement;
      }
    }
  };
}

function fetchPage(path, env = createEnv(), headers = {}) {
  return worker.fetch(
    new Request(`https://massmurdercanada.org${path}`, { headers }),
    env,
    { waitUntil() {} }
  );
}

test('embeds a feature-detected WebMCP registration bootstrap in public HTML', () => {
  const body = renderHomePage([]);

  assert.match(body, /document\.modelContext/);
  assert.match(body, /navigator\.modelContext/);
  assert.match(body, /AbortController/);
  assert.match(body, /inputSchema/);
  assert.match(body, /execute/);
  assert.match(body, /readOnlyHint: true/);
  assert.match(body, /list_provinces/);
  assert.match(body, /list_record_types/);
  assert.match(body, /list_records/);
  assert.match(body, /get_record/);
  assert.match(body, /\.md/);
});

test('registers four read-only tools with valid metadata and one lifecycle signal', async () => {
  const registrations = [];
  const fetchRequests = [];
  const modelContext = {
    registerTool(tool, options) {
      registrations.push({ tool, options });
      return Promise.resolve();
    }
  };
  const window = {};
  const source = renderWebMcpScript()
    .replace(/^<script>/, '')
    .replace(/<\/script>$/, '');

  vm.runInNewContext(source, {
    AbortController,
    console: { warn() {} },
    document: { modelContext },
    encodeURIComponent,
    fetch(path, options) {
      fetchRequests.push({ path, options });
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => '[Test Event](/records/record-1)'
      });
    },
    navigator: {},
    window
  });

  assert.deepEqual(
    registrations.map(({ tool }) => tool.name),
    ['list_provinces', 'list_record_types', 'list_records', 'get_record']
  );
  assert.ok(window.__massMurderCanadaWebMcp);
  assert.equal(registrations.length, 4);
  assert.ok(registrations.every(({ options }) => options.signal === window.__massMurderCanadaWebMcp.registrationController.signal));

  for (const { tool } of registrations) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.equal(typeof tool.execute, 'function', tool.name);
    assert.equal(tool.annotations.readOnlyHint, true, tool.name);
  }

  const provinces = await registrations[0].tool.execute({});
  const types = await registrations[1].tool.execute({});
  assert.match(provinces, /\[Alberta\]\(\/records\/provinces\/ab\.md\)/);
  assert.match(types, /\[Mass Killings\]\(\/records\/group\/mass\.md\)/);

  const records = await registrations[2].tool.execute({ province: 'ab' });
  assert.equal(fetchRequests[0].path, '/records/provinces/ab.md');
  assert.equal(fetchRequests[0].options.headers.Accept, 'text/markdown');
  assert.match(records, /\[Test Event\]\(\/records\/record-1\.md\)/);

  await registrations[2].tool.execute({});
  assert.equal(fetchRequests[1].path, '/index.md');
});

test('serves public .md aliases as forced Markdown', async () => {
  const aliases = [
    ['/index.md', /^# Mass Murder/],
    ['/map/canada.md', /^# Mass Murder Canada — Province Map/],
    ['/records/group/mass.md', /^# Mass Murder Canada — Mass Killings/],
    ['/records/provinces/ab.md', /^# Mass Murder Canada — Province AB/],
    ['/records/record-1.md', /## Test Event in Calgary in 2024/]
  ];

  for (const [path, heading] of aliases) {
    const response = await fetchPage(path, createEnv(), { Accept: 'text/html' });
    const body = await response.text();

    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8', path);
    assert.match(response.headers.get('x-markdown-tokens'), /^\d+$/, path);
    assert.match(body, heading, path);
    assert.doesNotMatch(body, /<!DOCTYPE html>|<script|<style/, path);
  }

  const legacyRootAlias = await fetchPage('/.md', createEnv());
  assert.equal(legacyRootAlias.status, 404);
});
