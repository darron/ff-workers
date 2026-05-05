# Agent Story Ingestion

The ingestion API lets a remote agent submit article URLs without using browser admin cookies.

The flow is intentionally two-step:

1. Worker proposes where a URL belongs.
2. Agent approves the worker proposal.
3. Worker validates again, attaches the story, and queues record summary work.

No notification webhook is wired yet. Review pending proposals through the API.

Repo-local agent instructions live in:

```text
skills/massmurdercanada-story-ingest/SKILL.md
```

Staging-only operator tasks live in `Taskfile.yml`:

```bash
task staging:migrate
task staging:deploy
task staging:secret:ingest-token INGEST_API_TOKEN=...
task staging:secret:rotate-ingest-token
task staging:ingest:create INGEST_API_TOKEN=... INGEST_TEST_URL=...
task staging:ingest:search INGEST_API_TOKEN=... SEARCH_QUERY='city=Calgary&province=AB&date=2026-04-29'
task staging:ingest:approve INGEST_API_TOKEN=... PROPOSAL_ID=... RECORD_ID=... AGENT_CONFIDENCE=... AGENT_REASON=...
task staging:ingest:reject INGEST_API_TOKEN=... PROPOSAL_ID=... AGENT_CONFIDENCE=... AGENT_REASON=...
task staging:record:delete RECORD_ID=...
```

## Setup

Apply the schema migration:

```bash
npx wrangler d1 migrations apply massmurdercanada --env staging
npx wrangler d1 migrations apply massmurdercanada --env production
```

Set a machine token secret:

```bash
npx wrangler secret put INGEST_API_TOKEN --env staging
npx wrangler secret put INGEST_API_TOKEN --env production
```

`INGEST_API_TOKENS` may also be used for a comma-separated list of accepted tokens.

For staging smoke tests, `task staging:secret:rotate-ingest-token` generates a staging-only token, stores it in `/private/tmp/ff-workers-staging-ingest-token`, and sets the staging secret without printing the token.
After that, the staging ingest tasks can use the local token file when `INGEST_API_TOKEN` is not passed.

Optional confidence thresholds:

- `INGEST_WORKER_MIN_CONFIDENCE`, default `0.65`
- `INGEST_AGENT_MIN_CONFIDENCE`, default `0.65`
- `INGEST_AI_MODEL`, default falls back to `AI_MODEL`
- `INGEST_RATE_LIMIT_PER_MINUTE`, default `60` when `AUTH_TOKENS` KV is configured

Source fetches use public-URL validation, manual redirect checks, DNS checks, timeouts, and response-size caps. Third-party extraction fallbacks for summaries are disabled by default; enabling them can disclose source URLs to those services.

## Auth

Ingest endpoints accept:

```http
Authorization: Bearer <INGEST_API_TOKEN>
```

The bearer token works only for `/admin/api/ingest/*`. Existing admin APIs still require the browser session cookie.

## Create Proposal

```bash
curl -s https://massmurdercanada.org/admin/api/ingest/proposals \
  -H "Authorization: Bearer $INGEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article"}'
```

Batch mode:

```json
{
  "urls": [
    "https://example.com/article-1",
    "https://example.com/article-2"
  ]
}
```

Maximum batch size is 5.

Important response fields:

- `status`: `worker_proposed`, `needs_review`, `duplicate`, `applied`, or `rejected`
- `proposed_action`: `attach_to_record`, `create_record`, `needs_review`, or `duplicate`
- `proposed_record_id`: record the Worker thinks the URL belongs to
- `worker_confidence`: Worker confidence, 0 to 1
- `worker_reason`: short reasoning string
- `decision.top_candidates`: nearby records considered
- `decision.proposed_record`: new record draft when `proposed_action` is `create_record`
- `decision.record_date_basis`: whether a proposed new record used an event date/year or publication-year fallback
- `extracted_facts`: incident facts extracted from the source

Only `worker_proposed` proposals are eligible for automatic agent approval.

## Search Records

Agents can run a read-only structured candidate search before approving a proposal, especially when the Worker proposes `create_record` or when the agent is uncertain.

```bash
curl -s "https://massmurdercanada.org/admin/api/ingest/records/search?city=Calgary&province=AB&date=2026-04-29&victims=2&deaths=2" \
  -H "Authorization: Bearer $INGEST_API_TOKEN"
```

Supported query parameters:

- `q`: text to match against record name, city, province, date, or devices
- `city`
- `province`: province or territory code/name
- `year`
- `date`: `YYYY-MM-DD`, month/day/year text, or four-digit year
- `date_window_days`: exact-date tolerance, default `30`, maximum `366`
- `victims`, `deaths`, `injuries`: integer counts
- `limit`: default `20`, maximum `100`

At least one search filter is required. Results include compact record fields plus `score` and `reasons`; this endpoint never writes records or stories.

## Agent Approval

```bash
curl -s https://massmurdercanada.org/admin/api/ingest/proposals/$PROPOSAL_ID/approve \
  -H "Authorization: Bearer $INGEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "record_id": "2d8bb859-5b00-4718-9a89-1d12cdf5b892",
    "agent_confidence": 0.92,
    "agent_reason": "The article names the same incident, location, year, and victim count."
  }'
```

The Worker applies only when:

- the proposal is still `worker_proposed`
- `attach_to_record`: the approved record exists
- `create_record`: the approved record ID matches the Worker-proposed new record ID
- worker and agent confidence meet thresholds
- the URL is not already attached to another story

If these checks fail, the proposal moves to `needs_review` instead of mutating `news_stories`.

Matching uses the article's extracted event/death/incident date when available:

- existing records near the source event date are favored
- different years are penalized
- exact or nearby event-date matches are stronger than city/count matches alone
- publication/update dates do not boost existing-record matching
- new-record drafts use the extracted event date when available, otherwise the best supported year

For new-record proposals, bearer-token approval does not accept record-field overrides. The Worker creates the reviewed `decision.proposed_record` as-is when the agent approves the Worker-proposed record ID.

```json
{
  "record_id": "worker-proposed-record-uuid",
  "agent_confidence": 0.92,
  "agent_reason": "The source describes a new Calgary incident with two child deaths."
}
```

Field corrections should go through the admin UI or a future reviewed `record_patch` proposal flow.

## Reject Proposal

```bash
curl -s https://massmurdercanada.org/admin/api/ingest/proposals/$PROPOSAL_ID/reject \
  -H "Authorization: Bearer $INGEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_confidence": 0.9,
    "agent_reason": "The source describes a different incident."
  }'
```

## Review

Fetch one proposal:

```bash
curl -s https://massmurdercanada.org/admin/api/ingest/proposals/$PROPOSAL_ID \
  -H "Authorization: Bearer $INGEST_API_TOKEN"
```

List proposals:

```bash
curl -s "https://massmurdercanada.org/admin/api/ingest/proposals?status=needs_review&limit=25" \
  -H "Authorization: Bearer $INGEST_API_TOKEN"
```

## Agent Rules

The remote agent should:

- submit URLs to create proposals
- approve only `worker_proposed` proposals
- include `record_id`, `agent_confidence`, and `agent_reason`
- reject clear mismatches
- leave `needs_review`, `duplicate`, and worker/agent disagreement cases for human review
- report newly discovered canonical facts, such as a released suspect name, as a metadata-update candidate instead of silently changing records
- never call the generic story CRUD endpoint directly unless a human explicitly asks it to bypass ingestion review

## Production Rollout Checklist

- Apply `0004_ingest_proposals.sql`, `0005_story_canonical_urls.sql`, and `0006_story_canonical_url_backfill.sql` to production D1.
- Set `INGEST_API_TOKEN` or `INGEST_API_TOKENS` in production.
- Consider stricter launch thresholds, for example `INGEST_WORKER_MIN_CONFIDENCE=0.75` and `INGEST_CREATE_RECORD_MIN_CONFIDENCE=0.8`.
- Add a Cloudflare WAF/rate-limit rule for `/admin/api/ingest/*` in addition to the Worker-side KV limiter.
- Smoke test duplicate, existing-record attach, new-record create, reject, and structured search paths in staging first.
- Add or explicitly defer a reviewed `record_patch` proposal flow for metadata updates from later reporting, such as changing `name` from `Unknown` after police release an accused person's name.
- Review `needs_review` proposals before enabling broad remote-agent usage.
