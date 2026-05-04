# Admin Interface Setup Guide

This guide covers admin authentication, dashboard features, and admin API usage.

## Quick Start

1. Generate admin password hash (PBKDF2):

```bash
node generate-password-hash.js "your-password"
```

2. Set secret for your target environment:

```bash
npx wrangler secret put ADMIN_PASSWORD_HASH --env staging
# and/or
npx wrangler secret put ADMIN_PASSWORD_HASH --env production
```

3. Open `/admin/login`, authenticate, then use `/admin`.

## Authentication and Sessions

### Password storage

- Passwords are verified against `ADMIN_PASSWORD_HASH`.
- Hash format is PBKDF2:
  - `pbkdf2:<iterations>:<salt_hex>:<hash_hex>`

### Session storage

- Primary: KV namespace (`AUTH_TOKENS`) when configured.
- Fallback: D1 table `admin_sessions`.
- Cookie settings:
  - `HttpOnly`
  - `Secure`
  - `SameSite=Strict`
  - `Max-Age=86400` (24 hours)

## Dashboard Features

- Record CRUD.
- News story CRUD.
- Agent story ingest proposal review via API.
- Single-record AI generation (`Generate AI` button).
- Bulk AI backfill (`Backfill Missing AI` button).
- Single-record location enrichment (`Enrich Location` button).
- Bulk location backfill (`Backfill Missing Location` button).
- Sentry test event button (if enabled in environment).

## AI Behavior in Admin

### Manual trigger

- `Generate AI` queues one record for story summaries + synthesis.

### Bulk trigger

- `Backfill Missing AI` calls bulk queueing API repeatedly until no more eligible records.

### Auto-on-save

- Controlled per environment by `AI_SUMMARY_AUTO_ON_SAVE`.
- `true`: record/story create/update automatically queues AI work.
- `false`: only manual buttons/API queue jobs.

## Admin API Endpoints

All endpoints require admin authentication (session cookie).

### Authentication routes

- `GET /admin/login`
- `POST /admin/login`
- `POST /admin/logout`

### Records API

- `GET /admin/api/records`
- `GET /admin/api/records/:id`
- `POST /admin/api/records`
- `PUT /admin/api/records/:id`
- `DELETE /admin/api/records/:id`

### Stories API

- `GET /admin/api/stories`
- `GET /admin/api/stories/:id`
- `POST /admin/api/stories`
- `PUT /admin/api/stories/:id`
- `DELETE /admin/api/stories/:id`

### Agent ingestion APIs

These endpoints accept either an admin session cookie or `Authorization: Bearer <INGEST_API_TOKEN>`.

- `POST /admin/api/ingest/proposals`
  - creates Worker proposals for one `url` or up to 20 `urls`
- `GET /admin/api/ingest/proposals`
  - lists proposals, optionally filtered by `status`
- `GET /admin/api/ingest/proposals/:id`
  - returns one proposal
- `POST /admin/api/ingest/proposals/:id/approve`
  - applies only when the Worker proposal and agent approval agree
- `POST /admin/api/ingest/proposals/:id/reject`
  - marks a proposal rejected

See [INGESTION.md](./INGESTION.md) for setup, payloads, and agent rules.

### AI summary APIs

- `POST /admin/api/records/:id/summarize`
  - queues one record
- `POST /admin/api/records/summarize-all`
  - bulk queueing with options:
    - `limit` (1-100, default `25`)
    - `offset` (default `0`)
    - `only_missing` (default `true`)
    - `include_fallback` (default `true`)

### AI location enrichment APIs

- `POST /admin/api/records/:id/enrich-location`
  - enriches one record with AI-verified city + optional geocode
  - options:
    - `force` (default `false`)
    - `geocode` (default `true`)
    - `min_confidence` (0..1, optional)
- `POST /admin/api/records/enrich-location-all`
  - bulk enrichment with options:
    - `limit` (1-50, default `12`)
    - `offset` (default `0`)
    - `only_missing` (default `true`)
    - `force` (default `false`)
    - `geocode` (default `true`)
    - `min_confidence` (0..1, optional)

### Sentry test API

- `POST /admin/api/sentry-test`
  - sends test exception to Sentry
  - returns `412` if `SENTRY_DSN` is not configured in that environment

## Records Payload Notes

- `date` should be entered as a 4-digit year (`YYYY`) for new/edited records.
- Existing legacy values like `YYYY-01-01 ...` are still accepted and displayed.
- Story URL validation enforces public `http/https` URLs and blocks localhost/private ranges.

Example create payload:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "date": "2024",
  "name": "Example Incident",
  "city": "Toronto",
  "province": "ON",
  "victims": 5,
  "deaths": 3,
  "injuries": 2,
  "newsStories": [
    {
      "id": "story-uuid-here",
      "url": "https://example.com/article",
      "body_text": "",
      "ai_summary": ""
    }
  ]
}
```

## Troubleshooting

### "Admin password not configured"

- Confirm `ADMIN_PASSWORD_HASH` secret is set for the deployed environment.
- For local dev, ensure `.dev.vars` contains a valid PBKDF2 hash string.

### Session or auth issues

- Confirm cookies are enabled.
- Re-login to refresh session.
- Confirm `AUTH_TOKENS` binding exists or D1 fallback is operational.

### AI button reports queue/config error

- Ensure `AI_SUMMARY_ENABLED=true`.
- Ensure `SUMMARY_QUEUE` binding exists in that environment.

### Sentry test doesn't show events

- Confirm `SENTRY_DSN` secret in that environment.
- Use Worker logs (`wrangler tail`) to verify endpoint call and returned `eventId`.

## Related Documentation

- [SETUP.md](./SETUP.md)
- [SECURITY.md](./SECURITY.md)
- [NVM_GUIDE.md](./NVM_GUIDE.md)
- [CHANGELOG.md](./CHANGELOG.md)
