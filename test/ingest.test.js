import test from 'node:test';
import assert from 'node:assert/strict';

import { __test } from '../src/ingest.js';

test('Arc/Fusion extraction uses article content and avoids related-story shell text', () => {
  const html = `
    <html>
      <head>
        <script>
          Fusion.globalContent={
            "headlines":{"basic":"Calgary father charged with 1st-degree murder"},
            "description":{"basic":"Police say two children were killed."},
            "first_publish_date":"2026-05-01T17:27:40.206Z",
            "content_elements":[
              {"type":"text","content":"Investigators believe a man murdered his two children shortly before midnight Wednesday."},
              {"type":"text","content":"Police say the identities of the children are protected by a publication ban."}
            ],
            "related_content":{"basic":[{"headlines":{"basic":"Boucher case returns to court"}}]}
          };Fusion.globalContentConfig={}
        </script>
      </head>
      <body><article>Boucher case returns to court</article></body>
    </html>
  `;

  const source = __test.extractSourceFromHtml(html);

  assert.equal(source.method, 'arc_global_content');
  assert.equal(source.publishedAt, '2026-05-01T17:27:40.206Z');
  assert.match(source.text, /murdered his two children/);
  assert.doesNotMatch(source.text, /Boucher/);
});

test('relative event weekday resolves from publication timestamp', () => {
  const sourceText = 'Investigators believe the children were killed just before midnight Wednesday.';

  assert.equal(
    __test.deriveEventDateFromSource(sourceText, '2026-05-01T17:27:40.206Z'),
    '2026-04-29'
  );
});

test('unsupported names and synthetic Jan. 1 dates are rejected', () => {
  const sourceText = 'Police say a Calgary father is charged. The father has not been named.';

  assert.equal(__test.sourceSupportsName('Boucher', sourceText), false);
  assert.equal(__test.sourceSupportsName('Calgary father', sourceText), false);
  assert.equal(__test.sourceSupportsName('Alex Smith', 'Police identified Alex Smith in the case.'), true);
  assert.equal(__test.normalizeIncidentDate('2026-01-01', 'The incident happened in 2026.'), '');
  assert.equal(__test.normalizeIncidentDate('2026-01-01', 'The incident happened January 1, 2026.'), '2026-01-01');
});

test('hard candidate compatibility rejects location and count conflicts', () => {
  const candidate = {
    id: 'record-1',
    city: 'Calgary',
    province: 'AB',
    victims: 2,
    deaths: 2
  };

  assert.equal(__test.candidateHardFieldsCompatible(candidate, {
    city: 'Calgary',
    province: 'AB',
    victims: 2,
    deaths: 2
  }), true);

  assert.equal(__test.candidateHardFieldsCompatible(candidate, {
    city: 'Mistissini',
    province: 'QC',
    victims: 2,
    deaths: 2
  }), false);

  assert.equal(__test.candidateHardFieldsCompatible(candidate, {
    city: 'Calgary',
    province: 'AB',
    victims: 5,
    deaths: 5
  }), false);
});

test('record search validates required filters and ranks structured candidates', () => {
  const empty = __test.parseRecordSearchParams(new URLSearchParams());
  assert.equal(empty.ok, false);

  const parsed = __test.parseRecordSearchParams(new URLSearchParams({
    city: 'Calgary',
    province: 'AB',
    date: '2026-04-29',
    victims: '2',
    deaths: '2'
  }));
  assert.equal(parsed.ok, true);

  const records = [
    {
      id: 'calgary-2026',
      date: '2026-04-29',
      name: 'Unknown',
      city: 'Calgary',
      province: 'AB',
      victims: 2,
      deaths: 2,
      injuries: null,
      devices_used: 'Vehicle'
    },
    {
      id: 'calgary-2019',
      date: '2019',
      name: 'Leeming',
      city: 'Calgary',
      province: 'AB',
      victims: 2,
      deaths: 2,
      injuries: 0,
      devices_used: 'Firearm'
    },
    {
      id: 'qc-2026',
      date: '2026-04-29',
      name: 'Mistissini',
      city: 'Mistissini',
      province: 'QC',
      victims: 2,
      deaths: 2,
      injuries: 0,
      devices_used: 'Firearm'
    }
  ];

  const candidates = __test.searchRecordCandidates(records, parsed.value);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, 'calgary-2026');
  assert.ok(candidates[0].reasons.includes('event_date'));
  assert.ok(candidates[0].reasons.includes('city'));
  assert.ok(candidates[0].reasons.includes('province'));
});

test('model JSON parsing accepts only strict object JSON or a full fenced object', () => {
  assert.deepEqual(__test.parseJsonObject('{"record_id":null,"confidence":0.2}'), {
    record_id: null,
    confidence: 0.2
  });
  assert.deepEqual(__test.parseJsonObject('```json\n{"ok":true}\n```'), { ok: true });
  assert.equal(__test.parseJsonObject('prefix {"ok":true} suffix'), null);
  assert.equal(__test.parseJsonObject('[{"ok":true}]'), null);
});

test('URL duplicate lookup includes canonical and trailing slash variants', () => {
  const variants = __test.buildUrlLookupVariants(
    'https://www.ctvnews.ca/story/?utm_source=codex#section'
  );

  assert.ok(variants.includes('https://www.ctvnews.ca/story'));
  assert.ok(variants.includes('https://www.ctvnews.ca/story/'));
});
