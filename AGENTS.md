# Agent Instructions

These instructions are for coding agents working in this repository.

## Repo Orientation

- This is a Cloudflare Workers app for Mass Murder Canada.
- Worker entrypoint: `src/index.js`.
- Admin REST API: `src/admin.js`.
- Auth/session and ingest bearer-token auth: `src/auth.js`.
- Agent-assisted story ingestion: `src/ingest.js`.
- Shared public URL safety checks: `src/url-safety.js`.
- AI record/story summaries: `src/ai-summary.js`.
- AI location enrichment and geocoding: `src/ai-location.js`.
- Public rendering and map UI: `src/templates.js`.
- Cloudflare config: `wrangler.toml`.

## Safety

- Do not commit secrets or local credential files.
- Use Wrangler secrets for deployed secrets such as:
  - `ADMIN_PASSWORD_HASH`
  - `INGEST_API_TOKEN` / `INGEST_API_TOKENS`
  - `AI_FETCH_SUMMARIZE_DAEMON_TOKEN`
  - `SENTRY_DSN`
  - `SENTRY_AUTH_TOKEN`
- `.dev.vars`, `.env*`, local key/cert files, `.wrangler/`, and generated local token files must stay out of git.
- Resource IDs in `wrangler.toml` are identifiers, not secrets, but do not add account-level credentials there.
- Treat production migrations and deploys as explicit human-approved operations.

## Staging Operations

- Prefer `Taskfile.yml` for staging operations instead of ad hoc Wrangler commands.
- Staging-only tasks include:
  - `task staging:deploy`
  - `task staging:migrate`
  - `task staging:secret:rotate-ingest-token`
  - `task staging:ingest:create ...`
  - `task staging:ingest:search ...`
  - `task staging:ingest:get ...`
  - `task staging:ingest:approve ...`
  - `task staging:ingest:reject ...`
  - `task staging:record:delete ...`
- Pass task variables after the task name so approval rules stay narrow.
- `task staging:secret:rotate-ingest-token` stores a staging-only local token at `/private/tmp/ff-workers-staging-ingest-token`; never move this into the repo.

## Story Ingestion

- Normal remote-agent story ingestion must use `/admin/api/ingest/*`, not the generic story CRUD endpoint.
- The ingest flow is:
  1. Agent submits URL.
  2. Worker extracts facts and proposes `attach_to_record`, `create_record`, `duplicate`, or `needs_review`.
  3. Agent independently approves or rejects.
  4. Worker validates again before writing.
- Ingestion docs live in `docs/INGESTION.md`.
- Remote-agent skill instructions live in `skills/massmurdercanada-story-ingest/SKILL.md`.
- Structured candidate search is read-only: `GET /admin/api/ingest/records/search`.
- For uncertain matches or `create_record` proposals, use structured search before approval.
- Do not silently update canonical record metadata from newly attached stories. Later facts, such as replacing `Unknown` after a suspect name is released, should be handled through a future reviewed `record_patch` proposal flow or a human/admin update.

## Database and Migrations

- Apply D1 migrations before using new schema-dependent code.
- Relevant migrations:
  - `0003_location_enrichment.sql` for verified city/geocode fields.
  - `0004_ingest_proposals.sql` for story ingest proposals.
- Code should return clear `412` responses when a required migration is missing.

## Mapping and Location

- `/map` redirects to `/map/canada`.
- The province map aggregates records by province and supports metric toggles.
- City-level drilldown uses Leaflet and verified coordinates from location enrichment.
- Location enrichment is probabilistic; preserve existing verified data when new AI confidence is weaker.
- Be mindful of geocoder rate limits. Bulk geocoding is intentionally throttled.

## Testing and Handoff

- Before handoff, run the checks that match the touched surface. For ingest changes, run:
  - `node --check src/ingest.js`
  - `npm test`
  - `git diff --check`
- If frontend/map rendering changes are made, verify in a browser or with screenshots before claiming it works.
- If staging deploys are requested, deploy and smoke test staging yourself when approval is available.
- Keep final summaries short and include what changed, what was tested, and any residual risk.

## Changelog

- Update `docs/CHANGELOG.md` for meaningful user-facing or operational changes.
- When backfilling older work, use dates from `git log` instead of putting everything under today.
- Current historical anchors:
  - `2026-02-26`: Canada province map.
  - `2026-03-02`: location enrichment and map drilldown.
  - `2026-05-04`: agent-assisted story ingestion.
