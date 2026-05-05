# Setup Guide

This guide covers local development, staging, and production deployment for the Cloudflare Worker.

## Prerequisites

- Node.js 20+
- Cloudflare account with Workers, D1, Queues, and AI enabled
- Wrangler CLI available via `npx` or local install

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Generate admin password hash (PBKDF2):

```bash
node generate-password-hash.js "your-password"
```

3. Add local secret(s) to `.dev.vars`:

```bash
ADMIN_PASSWORD_HASH="pbkdf2:..."
```

4. Run locally:

```bash
npm run dev
```

5. Deploy:

```bash
npx wrangler deploy --env staging
# or
npx wrangler deploy --env production
```

## Environment Configuration

Environment bindings are defined in `wrangler.toml`.

### Shared runtime

- `compatibility_flags = ["nodejs_compat"]`
- `DB` (D1)
- `AUTH_TOKENS` (KV, where configured)
- `AI` (Workers AI binding in staging/production)
- `SUMMARY_QUEUE` (Queue producer/consumer in staging/production)

### Staging defaults

- `AI_SUMMARY_ENABLED = "true"`
- `AI_SUMMARY_AUTO_ON_SAVE = "false"`
- `AI_SUMMARY_STORIES_PER_JOB = "10"`
- `AI_FETCH_JINA_FALLBACK = "true"`
- `AI_FETCH_MARKDOWN_NEW_FALLBACK = "true"`
- `AI_FETCH_SUMMARIZE_DAEMON_URL = ""`

### Production defaults

- `AI_SUMMARY_ENABLED = "true"`
- `AI_SUMMARY_AUTO_ON_SAVE = "true"`
- `AI_SUMMARY_STORIES_PER_JOB = "5"`
- `AI_FETCH_JINA_FALLBACK = "true"`
- `AI_FETCH_MARKDOWN_NEW_FALLBACK = "true"`
- `AI_FETCH_SUMMARIZE_DAEMON_URL = ""`

## Required Secrets

Set admin hash in each deployed environment:

```bash
npx wrangler secret put ADMIN_PASSWORD_HASH --env staging
npx wrangler secret put ADMIN_PASSWORD_HASH --env production
```

Optional/production observability:

```bash
npx wrangler secret put SENTRY_DSN --env production
```

Optional summarize daemon token:

```bash
npx wrangler secret put AI_FETCH_SUMMARIZE_DAEMON_TOKEN --env staging
npx wrangler secret put AI_FETCH_SUMMARIZE_DAEMON_TOKEN --env production
```

Optional agent ingestion token:

```bash
npx wrangler secret put INGEST_API_TOKEN --env staging
npx wrangler secret put INGEST_API_TOKEN --env production
```

Optional agent ingestion rate limit:

- `INGEST_RATE_LIMIT_PER_MINUTE` defaults to `60` when `AUTH_TOKENS` KV is configured.

## Queue Setup

Create queues once (recommended with latest Wrangler):

```bash
npx wrangler@latest queues create massmurdercanada-staging-summary \
  --message-retention-period-secs 86400 \
  --delivery-delay-secs 0

npx wrangler@latest queues create massmurdercanada-production-summary \
  --message-retention-period-secs 86400 \
  --delivery-delay-secs 0
```

After queue creation, deploy Worker environments so producer/consumer bindings activate.

## Database

Apply migrations:

```bash
npx wrangler d1 migrations apply massmurdercanada --env staging
npx wrangler d1 migrations apply massmurdercanada --env production
```

Core tables:

- `records`
- `news_stories`
- `story_ingest_proposals`
- `admin_sessions` (D1 fallback session store if KV unavailable)

## Deployment Workflows

### Standard deploy

```bash
npx wrangler deploy --env staging
npx wrangler deploy --env production
```

### Production deploy with Sentry release tracking

Set shell env once (for example in `.envrc`):

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

Then run:

```bash
npm run deploy:production:sentry
```

This wraps deploy and automates:

- release version proposal
- release creation
- commit association
- worker deploy with `SENTRY_RELEASE` and `SENTRY_ENVIRONMENT`
- release finalize and deploy marker

## Operations

Tail logs:

```bash
npx wrangler tail --env production --format pretty
```

Backfill missing/fallback AI summaries from admin dashboard:

- Open `/admin`
- Click `Backfill Missing AI`

Equivalent API (from an authenticated admin session):

```bash
curl -X POST "https://massmurdercanada.org/admin/api/records/summarize-all" \
  -H "Content-Type: application/json" \
  -d '{"limit":25,"offset":0,"only_missing":true,"include_fallback":true}'
```

## Troubleshooting

### Queue create fails with "The specified queue settings are invalid"

- Use `npx wrangler@latest ...` for queue creation.
- Older Wrangler versions may fail with this generic error.

### Sentry package errors referencing `node:async_hooks`

- Ensure `nodejs_compat` compatibility flag remains enabled in `wrangler.toml`.

### Admin password not working

- Confirm `ADMIN_PASSWORD_HASH` is in PBKDF2 format:
  - `pbkdf2:<iterations>:<salt_hex>:<hash_hex>`
- Re-run `node generate-password-hash.js "new-password"` and reset secret.

### D1/route issues

- Confirm correct `--env` is used for deploy and D1 commands.
- Verify `wrangler.toml` database IDs and queue names match Cloudflare resources.

## Related Documentation

- [ADMIN_SETUP.md](./ADMIN_SETUP.md)
- [SECURITY.md](./SECURITY.md)
- [NVM_GUIDE.md](./NVM_GUIDE.md)
- [CHANGELOG.md](./CHANGELOG.md)
