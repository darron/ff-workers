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

  assert.equal(
    __test.deriveEventDateFromSource(
      'Official court documents show the offence allegedly occurred Wednesday night.',
      '2026-05-01T17:17:18.455Z'
    ),
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

test('attach candidates require strong incident evidence beyond city and counts', () => {
  assert.equal(__test.candidateHasStrongAttachEvidence({
    reasons: ['province', 'city', 'victims', 'deaths']
  }), false);

  assert.equal(__test.candidateHasStrongAttachEvidence({
    reasons: ['year_from_event_date', 'province', 'city', 'victims', 'deaths']
  }), true);

  assert.equal(__test.candidateHasStrongAttachEvidence({
    reasons: ['province', 'city', 'name_in_source', 'victims', 'deaths']
  }), true);

  assert.equal(__test.candidateHasStrongAttachEvidence({
    reasons: ['province', 'city', 'victims', 'deaths', 'devices']
  }), false);

  assert.equal(__test.candidateHasStrongAttachEvidence({
    reasons: ['year', 'province', 'city_in_source', 'victims', 'deaths', 'devices']
  }), true);
});

test('incident city prefers specific community over nearby reference city', () => {
  const sourceText = 'A 16-year-old boy who pleaded guilty to four counts of manslaughter in a quadruple homicide last year on Carry the Kettle Nakoda Nation, which is east of Regina, has been sentenced.';

  assert.equal(
    __test.normalizeIncidentCity('Regina', sourceText),
    'Carry the Kettle Nakoda Nation'
  );

  assert.equal(
    __test.candidateHardFieldsCompatible({
      city: 'Carry the Kettle Nakoda Nation',
      province: 'SK',
      victims: 4,
      deaths: 4,
      reasons: ['city_in_source']
    }, {
      city: 'Regina',
      province: 'SK',
      victims: 4,
      deaths: 4
    }),
    true
  );
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

test('ingest source fetch falls back to markdown.new when direct fetch fails', async () => {
  const originalFetch = globalThis.fetch;
  const articleUrl = 'https://www.cbc.ca/news/canada/calgary/story-9.7184460';

  globalThis.fetch = async (url) => {
    const urlString = String(url);
    if (urlString.startsWith('https://cloudflare-dns.com/dns-query')) {
      return new Response(JSON.stringify({
        Status: 0,
        Answer: [{ type: 1, data: '93.184.216.34' }]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/dns-json' }
      });
    }

    if (urlString === articleUrl) {
      return new Response('', { status: 520 });
    }

    if (urlString === 'https://markdown.new/') {
      return new Response(JSON.stringify({
        success: true,
        title: 'Father charged with 1st-degree murder in deaths of his 2 children | CBC News',
        content: '# Calgary father charged with 1st-degree murder in deaths of 2 children\n\nA father has been charged with two counts of first-degree murder in the deaths of his two children in Calgary.\n\n```json\n{"datePublished":"2026-05-01T17:17:18.455Z"}\n```'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    throw new Error(`Unexpected fetch URL: ${urlString}`);
  };

  try {
    const source = await __test.fetchSourceContent(articleUrl, {
      AI_FETCH_MARKDOWN_NEW_FALLBACK: 'true'
    });

    assert.equal(source.method, 'markdown_new');
    assert.match(source.title, /CBC News/);
    assert.match(source.text, /two children in Calgary/);
    assert.equal(source.publishedAt, '2026-05-01T17:17:18.455Z');
    assert.equal(source.error, '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('create-record proposal can be agent-redirected to an existing record', async () => {
  const env = makeIngestApprovalEnv({
    proposal: {
      id: 'ingest_redirect',
      url: 'https://example.com/story',
      normalized_url: 'https://example.com/story',
      status: 'worker_proposed',
      proposed_action: 'create_record',
      proposed_record_id: 'new-record-id',
      proposed_story_id: 'story_redirect',
      worker_confidence: 1,
      worker_reason: 'Worker thought this was new.',
      extracted_text: 'Article text long enough to persist. '.repeat(20),
      decision_json: JSON.stringify({
        proposed_record: { id: 'new-record-id', date: '2026', city: 'Winnipeg', province: 'MB' }
      }),
      created_at: '2026-05-05T00:00:00.000Z',
      updated_at: '2026-05-05T00:00:00.000Z'
    },
    existingRecord: {
      id: 'existing-record-id',
      name: 'Felix'
    }
  });

  const request = new Request('https://example.test/admin/api/ingest/proposals/ingest_redirect/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      record_id: 'existing-record-id',
      agent_confidence: 1,
      agent_reason: 'Article is about survivor of existing Felix incident dying later, not a new incident.'
    })
  });

  const response = await __test.approveProposal(request, env, 'ingest_redirect');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'applied');
  assert.equal(body.record_id, 'existing-record-id');
  assert.equal(env.insertedStory.record_id, 'existing-record-id');
  assert.equal(env.updatedProposal.agent_decision, 'approve_redirect');
  assert.equal(env.updatedProposal.status, 'applied');
  assert.equal(env.summary.recordId, 'existing-record-id');
  assert.equal(env.summary.reason, 'ingest_agent_redirect_attached');

  const decision = JSON.parse(env.updatedProposal.decision_json);
  assert.equal(decision.agent_redirect_record_id, 'existing-record-id');
  assert.equal(decision.worker_proposed_record_id, 'new-record-id');
});

test('create-record redirect to a missing record remains needs_review', async () => {
  const env = makeIngestApprovalEnv({
    proposal: {
      id: 'ingest_missing_redirect',
      url: 'https://example.com/story',
      normalized_url: 'https://example.com/story',
      status: 'worker_proposed',
      proposed_action: 'create_record',
      proposed_record_id: 'new-record-id',
      proposed_story_id: 'story_redirect',
      worker_confidence: 1,
      worker_reason: 'Worker thought this was new.',
      extracted_text: '',
      decision_json: '{}',
      created_at: '2026-05-05T00:00:00.000Z',
      updated_at: '2026-05-05T00:00:00.000Z'
    },
    existingRecord: null
  });

  const request = new Request('https://example.test/admin/api/ingest/proposals/ingest_missing_redirect/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      record_id: 'missing-record-id',
      agent_confidence: 1,
      agent_reason: 'Article should attach elsewhere.'
    })
  });

  const response = await __test.approveProposal(request, env, 'ingest_missing_redirect');
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.status, 'needs_review');
  assert.equal(env.insertedStory, null);
  assert.match(env.updatedProposal.error, /redirect target was not found/);
});

function makeIngestApprovalEnv({ proposal, existingRecord }) {
  const state = {
    proposal: { ...proposal },
    insertedStory: null,
    updatedProposal: null,
    summary: null
  };

  return {
    get insertedStory() {
      return state.insertedStory;
    },
    get updatedProposal() {
      return state.updatedProposal;
    },
    get summary() {
      return state.summary;
    },
    SUMMARY_QUEUE: {
      async send(payload) {
        state.summary = payload;
      }
    },
    DB: {
      prepare(sql) {
        return makeStatement(sql, state, existingRecord);
      }
    }
  };
}

function makeStatement(sql, state, existingRecord) {
  return {
    bind(...values) {
      return {
        async first() {
          if (sql.includes('FROM story_ingest_proposals') && sql.includes('WHERE id = ?')) {
            return state.proposal?.id === values[0] ? { ...state.proposal } : null;
          }
          if (sql.includes('FROM records') && sql.includes('WHERE id = ?')) {
            return existingRecord?.id === values[0] ? { ...existingRecord } : null;
          }
          if (sql.includes('FROM news_stories')) {
            return null;
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO news_stories')) {
            state.insertedStory = {
              id: values[0],
              record_id: values[1],
              url: values[2],
              canonical_url: values[3],
              body_text: values[4],
              ai_summary: values[5]
            };
            return {};
          }

          if (sql.includes('UPDATE story_ingest_proposals')) {
            const status = values[0];
            if (sql.includes('applied_at = ?')) {
              state.proposal = {
                ...state.proposal,
                status,
                agent_decision: values[1],
                agent_confidence: values[2],
                agent_reason: values[3],
                decision_json: values[4],
                applied_at: values[5],
                applied_story_id: values[6],
                error: null,
                updated_at: values[7]
              };
            } else {
              state.proposal = {
                ...state.proposal,
                status,
                agent_decision: values[1] ?? state.proposal.agent_decision,
                agent_confidence: values[2] ?? state.proposal.agent_confidence,
                agent_reason: values[3] ?? state.proposal.agent_reason,
                decision_json: values[4],
                error: values[5],
                updated_at: values[6]
              };
            }
            state.updatedProposal = { ...state.proposal };
            return {};
          }

          return {};
        }
      };
    }
  };
}
