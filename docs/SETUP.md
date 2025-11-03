# Setup Guide

This guide covers setup instructions for the Mass Murder Canada Cloudflare Worker.

## Prerequisites

- Node.js v20+ (see `NVM_GUIDE.md` for version management)
- Cloudflare account with Workers enabled
- Wrangler CLI installed (via npm)

## Quick Start

1. **Clone and install dependencies**:
   ```bash
   npm install
   ```

2. **Set up authentication** (see `ADMIN_SETUP.md` for details):
   ```bash
   node generate-password-hash.js "your-password"
   # Add to .dev.vars for local dev, or set as secret for staging/production
   ```

3. **Run locally**:
   ```bash
   npm run dev
   ```

4. **Deploy to staging**:
   ```bash
   npx wrangler deploy --env staging
   ```

## Local Development

### Using `.dev.vars`

For local development, create a `.dev.vars` file (already gitignored):

```bash
ADMIN_PASSWORD_HASH="your-generated-hash-here"
```

Wrangler will automatically load this file during `wrangler dev`.

### Generating Password Hash

```bash
node generate-password-hash.js "your-secure-password"
```

This will output a SHA-256 hash that you can use in `.dev.vars` or as a Cloudflare secret.

## Environment Setup

### Development

1. Use `.dev.vars` for local secrets
2. Use default D1 database binding
3. KV namespace optional (falls back to D1 for sessions)

### Staging

1. Set secrets: `npx wrangler secret put ADMIN_PASSWORD_HASH --env staging`
2. KV namespace already configured in `wrangler.toml`
3. Uses separate D1 database

### Production

1. Set secrets: `npx wrangler secret put ADMIN_PASSWORD_HASH --env production`
2. Configure KV namespace if desired
3. Uses production D1 database

## Database Setup

### Running Migrations

```bash
npx wrangler d1 migrations apply massmurdercanada --env staging
# Or for production:
npx wrangler d1 migrations apply massmurdercanada --env production
```

### Database Structure

- **records** table: Stores mass murder records
- **news_stories** table: Stores related news articles
- **admin_sessions** table: Stores session tokens (created automatically if KV not available)

## Deployment

### Staging

```bash
npx wrangler deploy --env staging
```

Access at: `https://massmurdercanada-staging.darron.workers.dev`

### Production

```bash
npx wrangler deploy --env production
```

Access at: `https://massmurdercanada.org`

## Configuration Files

- **`wrangler.toml`**: Main configuration file
- **`.dev.vars`**: Local development secrets (gitignored)
- **`.gitignore`**: Ensures secrets aren't committed

## Troubleshooting

### Node.js Version Issues

If you get "Wrangler requires at least Node.js v20.0.0":

```bash
nvm use 20.11.0  # Or any v20+
```

See `docs/NVM_GUIDE.md` for detailed instructions.

### Secret Not Working

- Verify secret is set: Check Cloudflare dashboard or try setting again
- For local dev, ensure `.dev.vars` file exists with correct hash
- Check that environment matches (staging vs production)

### Database Connection Issues

- Verify D1 database binding in `wrangler.toml`
- Check database ID matches your Cloudflare database
- Ensure migrations have been run

## Related Documentation

- `ADMIN_SETUP.md` - Admin interface setup and usage
- `SECURITY.md` - Security documentation
- `NVM_GUIDE.md` - Node.js version management
- `CHANGELOG.md` - Recent changes and features

