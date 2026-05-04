# Changelog

## 2026-05-04

### Agent Story Ingestion

- Added bearer-token protected ingestion endpoints under `/admin/api/ingest/proposals`.
- Added Worker proposal and agent approval flow before writing `news_stories`.
- Added create-record proposal support for new incidents when no existing record matches.
- Added event-date-aware matching so same/near incident dates boost existing records and different years reduce false matches.
- Added bearer-token read-only structured record search for remote agents under `/admin/api/ingest/records/search`.
- Added `story_ingest_proposals` audit table with proposal status, extracted facts, confidence, decisions, and applied story IDs.
- Added duplicate URL checks, confidence thresholds, and review fallback for worker/agent disagreement.
- Moved admin story URL validation into a shared helper for reuse by ingestion.
- Documented remote-agent setup and API usage in `docs/INGESTION.md`.
- Added staging-only Taskfile targets for migration, deploy, token setup, and ingest smoke testing.
- Documented metadata-update gap for later facts, such as replacing `Unknown` after a name is released.
- Added focused Node tests for extraction, event-date derivation, name/date guardrails, hard candidate checks, and structured record search.

## 2026-03-02

### Location Enrichment and Map Drilldown

- Added AI-assisted city verification, geocoding, and `city_geocode_cache` (`512a103`, merged as `9084770`).
- Added location metadata fields through `0003_location_enrichment.sql`.
- Added admin actions for single-record location enrichment and bulk missing-location backfill.
- Updated `/map/canada` to prefer verified city and coordinate fields when available.
- Added city-level Leaflet drilldown for records with verified coordinates.
- Throttled bulk geocoding to respect Nominatim rate limits (`0022997`).
- Added Leaflet CDN integrity and crossorigin attributes (`0022997`).
- Preserved existing verified city data when AI confidence is lower and fixed partial-enrichment skip behavior (`ff3afdc`).

## 2026-02-26

### Canada Province Map

- Added `/map/canada` with an interactive Canada province map (`5ee7f8e`, merged as `1e35550`).
- Added province-level metric toggles for events, deaths, and events per million.
- Added province detail panels with recent record links and per-province totals.
- Added province quick list and direct links to province/event pages.
- Added `/map` redirect to `/map/canada`.
- Added map navigation for discoverability.

## 2026-02-18

### AI Summaries and Queue Processing

- Added queue-driven AI summarization for records and linked stories.
- Added chunked processing for large records via queue continuation payloads (`offset`, `storiesPerJob`).
- Added structured queue telemetry logs (`ai_summary_queue_job`) with action counts, extraction methods, synthesis mode, and duration.
- Added subrequest-limit handling (`Too many subrequests`) with deferred/retry behavior instead of hard failure.
- Added source-prioritized synthesis input selection:
  - favors `official` and `news`
  - de-emphasizes `social` links unless social links are all that exist
- Added synthesis context rule to treat record metadata dates as year-only precision.

### Source Extraction Improvements

- Added multi-stage extraction pipeline:
  1. stored `body_text`
  2. direct fetch + structured extraction (`article`, `main`, JSON-LD, metadata)
  3. optional summarize daemon fallback (`AI_FETCH_SUMMARIZE_DAEMON_URL`)
  4. optional `r.jina.ai` fallback
  5. optional `markdown.new` fallback
- Added RCMP URL normalization (`rcmp-grc.gc.ca` -> `rcmp.ca`) to improve retrieval.
- Added unsafe URL blocking for non-public targets (localhost/private/local IP ranges).

### Admin Workflow Enhancements

- Added manual per-record AI trigger endpoint: `POST /admin/api/records/:id/summarize`.
- Added bulk backfill endpoint: `POST /admin/api/records/summarize-all`.
- Added backfill filtering controls:
  - `only_missing` (default `true`)
  - `include_fallback` (default `true`)
- Added queueing from admin create/update flows for records and stories when auto-on-save is enabled.

### Frontend and Rendering

- Added Markdown-to-HTML rendering for AI summaries on public record pages.
- Added source badges and credibility status messaging to reflect source classification.

### Production/Environment Configuration

- Added staging queue bindings and production queue bindings in `wrangler.toml`.
- Tuned queue consumers:
  - staging: `max_batch_size=5`, `max_batch_timeout=10`
  - production: `max_batch_size=1`, `max_batch_timeout=5`
- Enabled `nodejs_compat` compatibility flag for Worker runtime compatibility with Sentry SDK.
- Enabled production AI auto-on-save (`AI_SUMMARY_AUTO_ON_SAVE=true`) with `AI_SUMMARY_STORIES_PER_JOB=5`.

### Error Monitoring (Sentry)

- Integrated `@sentry/cloudflare` at Worker entrypoint using `Sentry.withSentry(...)`.
- Added environment-based Sentry config (`SENTRY_DSN`, `SENTRY_RELEASE`, `SENTRY_ENVIRONMENT`).
- Added admin test endpoint `POST /admin/api/sentry-test` with flush confirmation response.
- Added safe behavior for environments without DSN (returns `412` instead of runtime failure for test endpoint).
- Added production deployment script with release automation:
  - `scripts/deploy-production-with-sentry.sh`
  - `npm run deploy:production:sentry`
  - creates/finalizes release and records deploy.

## Earlier Milestones

### Admin and API Foundation

- Added secure admin interface and authentication flow.
- Added CRUD APIs for records and news stories.
- Added session storage via KV with D1 fallback.

### Security Hardening

- Parameterized SQL queries across database operations.
- XSS mitigation through escaping and safe DOM patterns.
- Input validation for IDs, URLs, and date/year values.
- Path sanitization and improved error handling.
