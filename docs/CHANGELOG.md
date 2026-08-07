# Changelog

## 2026-08-06

### Crawl Rules

- Added a valid plain-text `/robots.txt` response that allows public crawling and excludes the `/admin` namespace.
- Added a dynamically generated `/sitemap.xml` for canonical public pages, referenced from `/robots.txt` and cached for one hour.
- Declared `ai-train=no`, `search=yes`, and `ai-input=yes` Content Signals for the site’s published content in `/robots.txt`.

### Markdown for Agents

- Added application-level Markdown templates and `Accept: text/markdown` negotiation for public home, map, filtered, and record pages while retaining HTML as the default.
- Added public-page `Link` headers advertising the Agent Skills index and each page's Markdown alternate representation.

### WebMCP for Agents

- Exposed read-only province, record-type, record-list, and record retrieval tools through the page's WebMCP integration when supported by the browser.
- Added public `.md` aliases for agent-facing links while keeping canonical browser and sitemap URLs unchanged.

### Agent Skills Discovery

- Published a digest-verified Agent Skills index and a site research skill describing the read-only WebMCP and Markdown workflows.

## 2026-06-24

### Agent Story Ingestion

- Added production ingest Taskfile targets for proposal creation, review, record search, approval, rejection, and listing so operator-approved `task` runs can use the bearer-token proposal flow without ad hoc curl commands.
- Tightened ingest extraction so dead suspects are excluded from victim-fatality counts while still counted in total deaths when the source says the suspect died.
- Allowed reviewed create-record ingestion for narrow non-fatal police-firearm ambushes with at least two injured officers, so dbrain-authoritative law-enforcement shooting sources can be represented without bypassing the proposal flow.
- Clarified AI record-summary synthesis prompts so record display names are not treated as incident locations and dead suspects are not described as apprehended unless a source says so.
- Classified `rcmp.ca` as official and `ckom.com` as news so source badges, credibility notes, and AI synthesis prompts treat those incident sources as credible.
- Added record page smoke-test Taskfile targets so agents can verify rendered staging or production record summaries through approved `task` commands instead of ad hoc `curl` pipelines.

## 2026-05-11

### Agent Story Ingestion

- Added a constrained `force_apply` approval path for already-`needs_review` ingest proposals so a bearer-token agent can attach a reviewed source to an existing record with explicit confidence and evidence.
- Kept force attachment out of normal `worker_proposed` approvals, create-record creation, and duplicate URL writes; force decisions are audited as `approve_force_attach`.
- Updated staging ingest approval tasks, ingestion docs, and remote-agent skill guidance for the force-attach path.

## 2026-05-08

### Workers AI Model Refresh

- Replaced the deprecated Workers AI default model with `@cf/zai-org/glm-4.7-flash`.
- Added OpenAI-compatible chat completion response handling for Workers AI models that return `choices`.
- Enabled JSON mode and disabled model thinking for ingest and location JSON extraction calls so newer reasoning models return parseable JSON within existing token budgets.
- Disabled model thinking for free-text story and record summaries, tightened summary prompts, and sanitized extractor/page chrome so generated record pages do not leak HTML, JavaScript, front matter, share links, or raw daemon metadata.
- Added staging summary Taskfile targets that can seed deterministic test records from one or more URLs, queue summarization with the staging ingest token, fetch rendered pages, and inspect stored story summaries.
- Added staging location-enrichment Taskfile targets and a staging-only bearer-token record action path for summary/location bakeoffs.
- Tightened ingest extraction and candidate matching so specific communities such as First Nations are preferred over nearby reference cities, avoiding duplicate-record proposals when a source says an incident occurred on a community east/west/near a larger city.
- Added CBC Lite story URL extraction for CBC article IDs so CBC sources summarize reliably when the main page extraction fails.
- Triggered location enrichment after admin-created and ingest-created records so new records populate verified city and coordinates without waiting for manual backfill.

## 2026-05-04

### Agent Story Ingestion

- Added bearer-token protected ingestion endpoints under `/admin/api/ingest/proposals`.
- Added Worker proposal and agent approval flow before writing `news_stories`.
- Added create-record proposal support for new incidents when no existing record matches.
- Added event-date-aware matching so same/near incident dates boost existing records and different years reduce false matches.
- Added bearer-token read-only structured record search for remote agents under `/admin/api/ingest/records/search`.
- Added `story_ingest_proposals` audit table with proposal status, extracted facts, confidence, decisions, and applied story IDs.
- Added duplicate URL checks, confidence thresholds, and review fallback for worker/agent disagreement.
- Added agent redirect approval for cases where the Worker proposes `create_record` but the agent finds a strong existing-record match.
- Moved admin story URL validation into a shared helper for reuse by ingestion.
- Documented remote-agent setup and API usage in `docs/INGESTION.md`.
- Added staging-only Taskfile targets for migration, deploy, token setup, and ingest smoke testing.
- Documented metadata-update gap for later facts, such as replacing `Unknown` after a name is released.
- Added focused Node tests for extraction, event-date derivation, name/date guardrails, hard candidate checks, and structured record search.

### Pre-Public Ingestion Hardening

- Added bounded public-source fetching with manual redirect validation, DNS checks, timeouts, and response-size caps.
- Added canonical story URL persistence, backfill normalization, and DB-level unique indexes for story URLs and active ingest proposals (`0005_story_canonical_urls.sql`, `0006_story_canonical_url_backfill.sql`).
- Reduced agent ingest batches to 5 URLs and added a Worker-side KV rate limiter.
- Locked create-record approvals so bearer-token agents cannot override Worker-reviewed canonical record fields.
- Made third-party source extraction fallbacks an explicit deploy config, documented disclosure tradeoffs, and reused those fallbacks for ingest when direct fetches fail.
- Tightened model JSON parsing, Sentry capture/PII settings, admin external-link rel attributes, and staging token rotation permissions.

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
