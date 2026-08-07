import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import worker from '../src/index.js';
import { MASS_MURDER_CANADA_RESEARCH_SKILL } from '../src/agent-skills.js';

const ORIGIN = 'https://massmurdercanada.org';

function fetchResource(path, method = 'GET') {
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, { method }),
    {},
    { waitUntil() {} }
  );
}

test('publishes a digest-verified Agent Skills discovery index and skill', async () => {
  const indexResponse = await fetchResource('/.well-known/agent-skills/index.json');
  const index = await indexResponse.json();

  assert.equal(indexResponse.status, 200);
  assert.equal(indexResponse.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.match(indexResponse.headers.get('cache-control'), /max-age=3600/);
  assert.equal(index.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  assert.equal(index.skills.length, 1);

  const [skill] = index.skills;
  assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(skill.type, 'skill-md');
  assert.ok(skill.description);
  assert.match(skill.url, /\/\.well-known\/agent-skills\/mass-murder-canada-research\/SKILL\.md$/);
  assert.match(skill.digest, /^sha256:[a-f0-9]{64}$/);

  const skillPath = new URL(skill.url, ORIGIN).pathname;
  const skillResponse = await fetchResource(skillPath);
  const skillBytes = Buffer.from(await skillResponse.arrayBuffer());
  const skillBody = skillBytes.toString('utf8');
  const canonicalSkill = await readFile(new URL('../skills/mass-murder-canada-research/SKILL.md', import.meta.url), 'utf8');

  assert.equal(skillResponse.status, 200);
  assert.equal(skillResponse.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.match(skillResponse.headers.get('cache-control'), /max-age=3600/);
  assert.equal(skill.digest, `sha256:${createHash('sha256').update(skillBytes).digest('hex')}`);
  assert.equal(skillBody, canonicalSkill);
  assert.equal(skillBody, MASS_MURDER_CANADA_RESEARCH_SKILL);
  assert.match(skillBody, /^---\nname: mass-murder-canada-research\ndescription: .+\n---\n/);
  assert.match(skillBody, /list_provinces/);
  assert.match(skillBody, /list_record_types/);
  assert.match(skillBody, /list_records/);
  assert.match(skillBody, /get_record/);
  assert.match(skillBody, /text\/markdown/);
  assert.match(skillBody, /\/index\.md/);
  assert.doesNotMatch(skillBody, /\/\.md/);
  assert.doesNotMatch(skillBody, /remote MCP endpoint/i);
});

test('supports HEAD for the Agent Skills index and artifact without a database', async () => {
  const indexResponse = await fetchResource('/.well-known/agent-skills/index.json', 'HEAD');
  const skillResponse = await fetchResource('/.well-known/agent-skills/mass-murder-canada-research/SKILL.md', 'HEAD');

  assert.equal(indexResponse.status, 200);
  assert.equal(indexResponse.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(await indexResponse.text(), '');
  assert.equal(skillResponse.status, 200);
  assert.equal(skillResponse.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(await skillResponse.text(), '');
});
