# Mass Murder Canada - Cloudflare Workers

Cloudflare Workers/D1 implementation of the Mass Murder Canada site, migrated from the original Go/Echo app.

Original project: [github.com/darron/ff](https://github.com/darron/ff)

## Features

- Original public URL structure preserved.
- Admin dashboard for records and linked news stories.
- REST-style admin APIs for CRUD + AI queue operations.
- AI summarization pipeline:
  - Per-story extraction and summary.
  - Record-level synthesis across linked sources.
  - Source typing (`official`, `news`, `social`, `other`) with social-only incidents treated as alleged.
  - Chunked queue processing for large records.
- AI location enrichment pipeline:
  - AI-assisted city verification from linked source content.
  - Geocoding + cache table for city/province coordinate reuse.
  - Per-record and bulk admin API triggers.
- Agent-assisted story ingestion:
  - Bearer-token proposal API for remote agents.
  - Worker proposes an existing record, agent approves, Worker applies with dedupe/audit checks.
- AI summaries are rendered as HTML from Markdown on record pages.
- Sentry error monitoring (`fetch` + `queue`) via `@sentry/cloudflare`.

## Setup

See [docs/SETUP.md](./docs/SETUP.md) for full setup.

Quick start:

1. `npm install`
2. Configure admin auth (see [docs/ADMIN_SETUP.md](./docs/ADMIN_SETUP.md))
3. `npm run dev`
4. Deploy as needed:
   - Staging: `npx wrangler deploy --env staging`
   - Production: `npx wrangler deploy --env production`

## Documentation

- [docs/README.md](./docs/README.md) - Docs index
- [docs/SETUP.md](./docs/SETUP.md) - Setup/deployment
- [docs/ADMIN_SETUP.md](./docs/ADMIN_SETUP.md) - Admin dashboard + API
- [docs/INGESTION.md](./docs/INGESTION.md) - Agent story ingestion API
- [docs/SECURITY.md](./docs/SECURITY.md) - Security notes
- [docs/NVM_GUIDE.md](./docs/NVM_GUIDE.md) - Node/NVM guidance
- [docs/CHANGELOG.md](./docs/CHANGELOG.md) - Change history

## Project Structure

```text
ff-workers/
├── src/
│   ├── index.js                  # Worker entrypoint (routes + queue + Sentry wrapper)
│   ├── admin.js                  # Admin API handlers
│   ├── admin-ui.js               # Admin dashboard HTML/JS
│   ├── ai-summary.js             # Queue-driven AI summarization pipeline
│   ├── ai-location.js            # AI city verification + geocoding pipeline
│   ├── source-classification.js  # URL/source credibility typing
│   ├── db.js                     # Record/story queries
│   ├── auth.js                   # Admin authentication/session helpers
│   └── templates.js              # Public page templates + markdown renderer
├── scripts/
│   └── deploy-production-with-sentry.sh
├── migrations/
│   ├── 0001_initial.sql
│   ├── 0002_data.sql
│   ├── 0003_location_enrichment.sql
│   ├── data/
│   └── prod-data/
├── wrangler.toml
├── package.json
├── migrate-data.cjs
├── import-prod-dump.cjs
└── database_dump.sql
```

## Routes

Public:

- `/`
- `/records/group/:group`
- `/records/provinces/:province`
- `/records/:id`

Admin:

- `/admin`
- `/admin/api/records/*`
- `/admin/api/stories/*`
- `/admin/api/ingest/proposals*`
- `/admin/api/sentry-test`

## Environments

Configured in `wrangler.toml`:

- `compatibility_flags = ["nodejs_compat"]` (required for Sentry SDK)
- Queue binding name in code: `SUMMARY_QUEUE`

Staging (`--env staging`):

- Worker: `massmurdercanada-staging`
- AI: enabled, manual on save (`AI_SUMMARY_AUTO_ON_SAVE=false`)
- `AI_SUMMARY_STORIES_PER_JOB=10`
- `AI_LOCATION_ENABLED=true`
- `AI_LOCATION_GEOCODE_ENABLED=true`
- `AI_LOCATION_MIN_CONFIDENCE=0.72`
- Queue: `massmurdercanada-staging-summary`
- Queue consumer: `max_batch_size=5`, `max_batch_timeout=10`

Production (`--env production`):

- Worker/routes: `massmurdercanada` on `massmurdercanada.org/*`
- AI: enabled, auto on save (`AI_SUMMARY_AUTO_ON_SAVE=true`)
- `AI_SUMMARY_STORIES_PER_JOB=5`
- `AI_LOCATION_ENABLED=true`
- `AI_LOCATION_GEOCODE_ENABLED=true`
- `AI_LOCATION_MIN_CONFIDENCE=0.72`
- Queue: `massmurdercanada-production-summary`
- Queue consumer: `max_batch_size=1`, `max_batch_timeout=5`

## AI Summary Pipeline

Trigger paths:

- Manual per-record: `POST /admin/api/records/:id/summarize`
- Bulk backfill: `POST /admin/api/records/summarize-all`
- Auto-on-save (when enabled): record/story create/update operations enqueue a job

Bulk backfill request options:

- `limit` (1-100, default `25`)
- `offset` (default `0`)
- `only_missing` (default `true`)
- `include_fallback` (default `true`)

Extraction flow per story:

1. Reuse stored `body_text` when sufficient.
2. Direct fetch + structured extraction (JSON-LD/article/main/meta).
3. Optional summarize daemon fallback (`AI_FETCH_SUMMARIZE_DAEMON_URL`).
4. Optional fallback readers: `r.jina.ai`, `markdown.new` (enabled in deployed environments by config).

Additional behavior:

- RCMP URLs are normalized from `rcmp-grc.gc.ca` to `rcmp.ca`.
- Unsafe URLs (non-public/localhost/private IP) are blocked.
- Large records are processed in chunks; final synthesis runs on last chunk.
- Source selection for synthesis favors `official/news` and de-emphasizes social links unless social is all that exists.
- Structured logs are emitted as `ai_summary_queue_job`.
- Record metadata date is treated as year-only for synthesis context.

Optional summarize daemon token secret:

- `npx wrangler secret put AI_FETCH_SUMMARIZE_DAEMON_TOKEN --env production`
- `npx wrangler secret put AI_FETCH_SUMMARIZE_DAEMON_TOKEN --env staging`

## AI Location Enrichment

Trigger paths:

- Manual per-record enrichment: `POST /admin/api/records/:id/enrich-location`
- Bulk enrichment backfill: `POST /admin/api/records/enrich-location-all`

Request options (single + bulk):

- `force` (default `false`) recomputes even when city/coordinates already exist.
- `geocode` (default `true`) allows coordinate lookups.
- `min_confidence` (0..1, default from `AI_LOCATION_MIN_CONFIDENCE`, usually `0.72`).

Bulk request options:

- `limit` (1-50, default `12`)
- `offset` (default `0`)
- `only_missing` (default `true`)

Schema additions (migration `0003_location_enrichment.sql`):

- `records.city_verified`, `records.city_confidence`, `records.city_verification_source`, `records.city_verification_notes`
- `records.location_lat`, `records.location_lon`, `records.location_source`, `records.location_confidence`, `records.location_updated_at`, `records.location_last_checked_at`
- `city_geocode_cache` table for city/province lookup caching

## Queue Setup

Create queues once (use latest Wrangler):

```bash
npx wrangler@latest queues create massmurdercanada-staging-summary \
  --message-retention-period-secs 86400 \
  --delivery-delay-secs 0

npx wrangler@latest queues create massmurdercanada-production-summary \
  --message-retention-period-secs 86400 \
  --delivery-delay-secs 0
```

Then deploy the Worker for each environment.

## Error Monitoring (Sentry)

Sentry is wired through `@sentry/cloudflare` and reads runtime config from env/secrets:

- `SENTRY_DSN` (secret)
- `SENTRY_RELEASE` (optional var)
- `SENTRY_ENVIRONMENT` (optional var)

Set DSN secret (production):

```bash
npx wrangler secret put SENTRY_DSN --env production
```

Admin Sentry test:

- Dashboard button calls `POST /admin/api/sentry-test`.
- If `SENTRY_DSN` is not set (e.g., staging), endpoint returns `412` instead of failing deployment/runtime.

Release + deploy workflow:

- One-command flow: `npm run deploy:production:sentry`
- Script: [scripts/deploy-production-with-sentry.sh](./scripts/deploy-production-with-sentry.sh)
- Requires env vars in shell: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`

## Notes

- Dates are stored in mixed formats, but UI and synthesis treat canonical record dates as year-level context.
- AI backfill targets missing summaries by default and can include existing fallback summaries.
- Story summaries and record synthesis are stored in D1 (`news_stories.ai_summary`, `records.ai_summary`).
