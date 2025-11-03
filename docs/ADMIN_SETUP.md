# Admin Interface Setup Guide

This guide explains how to set up and use the admin interface for managing records and news stories.

## Quick Start

1. Generate password hash: `node generate-password-hash.js "your-password"`
2. Set secret: `npx wrangler secret put ADMIN_PASSWORD_HASH --env staging` (or add to `.dev.vars` for local dev)
3. Access: Navigate to `/admin/login` and log in

## Authentication Setup

### Option 1: Using `.dev.vars` (Recommended for Local Development)

1. Generate a password hash:
   ```bash
   node generate-password-hash.js "your-secure-password"
   ```

2. Add to `.dev.vars` (already gitignored):
   ```bash
   ADMIN_PASSWORD_HASH="your-generated-hash-here"
   ```

### Option 2: Using Cloudflare Secrets (Recommended for Production)

1. Generate a password hash:
   ```bash
   node generate-password-hash.js "your-secure-password"
   ```

2. Set it as a secret:
   ```bash
   npx wrangler secret put ADMIN_PASSWORD_HASH --env staging
   # Or for production:
   npx wrangler secret put ADMIN_PASSWORD_HASH --env production
   ```

### Option 3: Using KV Store for Sessions (Optional)

For better session management, KV is automatically configured in staging. For production:

```bash
npx wrangler kv:namespace create "AUTH_TOKENS" --env production
```

Then add to `wrangler.toml` under the production environment.

If KV is not configured, the system automatically falls back to D1 database for session storage.

## Using the Admin Interface

1. Navigate to `/admin/login` in your browser
2. Enter your password
3. You'll be redirected to the admin dashboard at `/admin`

## Features

- **Record Management**: Create, edit, and delete records
- **News Stories**: Manage news stories directly within record forms
- **Year-Only Dates**: Simple year input (no need for full dates)
- **UUID Generation**: Record IDs are automatically generated as UUIDs
- **Bulk Operations**: Manage multiple news stories per record in one form

## Admin API Endpoints

All API endpoints require authentication via session cookie.

### Records API

- `GET /admin/api/records` - List all records
- `GET /admin/api/records/:id` - Get a specific record (includes news stories)
- `POST /admin/api/records` - Create a new record
  ```json
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "date": "2024",
    "name": "John Doe",
    "city": "Toronto",
    "province": "ON",
    "victims": 5,
    "deaths": 3,
    "injuries": 2,
    "licensed": true,
    "suicide": false,
    "firearms": true,
    "newsStories": [
      {
        "id": "story-uuid-here",
        "url": "https://example.com/article",
        "body_text": "Article text",
        "ai_summary": "Summary"
      }
    ]
  }
  ```
- `PUT /admin/api/records/:id` - Update a record (same JSON format, newsStories optional)
- `DELETE /admin/api/records/:id` - Delete a record (also deletes associated news stories)

### News Stories API

- `GET /admin/api/stories` - List all stories (optionally filter by `?record_id=xxx`)
- `GET /admin/api/stories/:id` - Get a specific story
- `POST /admin/api/stories` - Create a new story
- `PUT /admin/api/stories/:id` - Update a story
- `DELETE /admin/api/stories/:id` - Delete a story

## Alternative: Cloudflare Access

For enterprise-grade authentication, you can use Cloudflare Access (Zero Trust):

1. Set up Cloudflare Access in your Cloudflare dashboard
2. Create an application policy that protects `/admin/*` routes
3. Configure identity providers (Google, GitHub, email, etc.)
4. The current implementation can work alongside Cloudflare Access

## Security Best Practices

1. **Use strong passwords**: Generate a long, random password for the admin account
2. **Keep secrets secure**: Never commit password hashes to version control
3. **Use HTTPS**: Always access the admin interface over HTTPS (Cloudflare default)
4. **Regular audits**: Regularly review admin access logs
5. **Session timeout**: Sessions expire after 24 hours of inactivity
6. **Limit exposure**: Consider using Cloudflare Access for additional protection

## Troubleshooting

### "Admin password not configured" error
- Make sure `ADMIN_PASSWORD_HASH` is set in your environment variables or secrets
- For local dev, check `.dev.vars` file exists and contains the hash

### Session not persisting
- Check that cookies are enabled in your browser
- Verify KV namespace is configured (or system will use D1 fallback)
- Check browser console for cookie-related errors

### API returns 401 Unauthorized
- Make sure you're logged in at `/admin/login`
- Check that the session cookie is being sent with requests
- Try logging out and logging back in

### Node.js version issues
- Wrangler requires Node.js v20+
- Use `nvm use 20.11.0` to switch versions
- See `docs/NVM_GUIDE.md` for more details

## Development Workflow

1. **Local Development**: Use `.dev.vars` for password hash
2. **Staging**: Use `npx wrangler secret put ADMIN_PASSWORD_HASH --env staging`
3. **Production**: Use `npx wrangler secret put ADMIN_PASSWORD_HASH --env production`

## Related Documentation

- See `SECURITY.md` for comprehensive security documentation
- See `SETUP.md` for general setup instructions
- See `NVM_GUIDE.md` for Node.js version management

