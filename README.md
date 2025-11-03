# Mass Murder Canada - Cloudflare Workers

This is the Cloudflare Workers version of the Mass Murder Canada application, converted from the original Go/Echo application.

**Original Project:** [github.com/darron/ff](https://github.com/darron/ff)

## Features

- Same URL structure as the original application
- Modern, improved UI design
- Cloudflare D1 database (SQLite-compatible)
- **Admin Interface**: Secure admin dashboard for managing records and news stories
- **REST API**: Full CRUD API for programmatic access
- All public routes preserved:
  - `/` - Home page with all records
  - `/records/group/:group` - Filtered records by group
  - `/records/provinces/:province` - Filtered by province
  - `/records/:id` - Individual record detail page

## Setup

See **[docs/SETUP.md](./docs/SETUP.md)** for detailed setup instructions.

Quick start:
1. `npm install`
2. Configure admin password (see [docs/ADMIN_SETUP.md](./docs/ADMIN_SETUP.md))
3. `npm run dev` for local development
4. `npx wrangler deploy --env staging` for staging deployment

## Documentation

All documentation is in the **[docs/](./docs/)** folder:

- **[SETUP.md](./docs/SETUP.md)** - General setup and deployment guide
- **[ADMIN_SETUP.md](./docs/ADMIN_SETUP.md)** - Admin interface setup and usage
- **[SECURITY.md](./docs/SECURITY.md)** - Security documentation and best practices
- **[NVM_GUIDE.md](./docs/NVM_GUIDE.md)** - Node.js version management
- **[CHANGELOG.md](./docs/CHANGELOG.md)** - Recent changes and features

## Project Structure

```
ff-workers/
├── src/
│   ├── index.js      # Main worker entry point with routing
│   ├── db.js         # Database query functions
│   └── templates.js  # HTML template rendering functions
├── migrations/
│   ├── 0001_initial.sql  # Database schema
│   ├── 0002_data.sql     # Generated data migration (after running migrate-data.cjs)
│   └── prod-data/        # Production database migration files
├── wrangler.toml     # Cloudflare Workers configuration
├── package.json      # Node.js dependencies
├── migrate-data.cjs  # Script to migrate data from SQLite to D1
├── import-prod-dump.cjs  # Script to import production database dump
└── database_dump.sql     # Production database dump file
```

## URL Routes

All original routes are preserved:

- `/` - Home page listing all records
- `/records/group/mass` - Mass killings (4+ victims)
- `/records/group/massother` - Non-firearms mass killings
- `/records/group/massfirearms` - Firearms mass killings
- `/records/group/massfirearmslicensed` - Licensed firearms mass killings
- `/records/group/oic` - OIC impact records
- `/records/group/suicide` - Suicide records
- `/records/provinces/:province` - Filter by province (e.g., `/records/provinces/bc`)
- `/records/:id` - Individual record detail page

## Database Schema

The database uses the same schema as the original SQLite database:

- **records** table: Contains all record data
- **news_stories** table: Contains associated news stories linked to records

## Environments

The project has two deployment environments configured:

- **staging**: Uses a separate database with a complete copy of production data, deployed to `massmurdercanada-staging.darron.workers.dev` (for testing changes before deploying to production)
- **production**: Uses the production database, deployed to `massmurdercanada.org` and `www.massmurdercanada.org`

All environments use Cloudflare D1 databases. The staging database is kept in sync with production data for realistic testing. See `wrangler.toml` for database configurations.

## Development

The worker uses Cloudflare Workers with D1 database. Local development uses `wrangler dev` which provides a local D1 database for testing.

## Notes

- The UI has been modernized with improved styling
- Production data has been migrated from the original Go/SQLite application
- The application maintains the same URL structure for compatibility
- Dates display as years only (e.g., "2024" instead of "January 1, 2024")
- News story body_text is not displayed in detail views (only URLs shown)
- Column sorting works for all table columns (numeric and text)
