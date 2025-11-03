# Changelog

## Recent Changes

### Admin Interface Implementation
- Added secure admin interface for managing records and news stories
- Implemented REST API for CRUD operations
- Added authentication system with session management

### Security Improvements
- SQL injection protection (parameterized queries)
- XSS protection (HTML escaping, safe DOM methods)
- Path traversal protection (path segment validation)
- Input validation (UUIDs, URLs, dates)
- DoS protection (array size limits)
- Error handling improvements (generic error messages)

### UI Enhancements
- Year-only date input (simplified from full date picker)
- Auto-generated UUID v4 for record IDs
- Integrated news stories management in record forms
- Real-time form updates and validation

### Technical Changes
- Added KV namespace for session storage (staging)
- Fallback to D1 database for sessions if KV unavailable
- Improved error handling and validation
- Consistent UUID validation across all endpoints

## Files Added

- `src/auth.js` - Authentication system
- `src/admin.js` - REST API endpoints
- `src/admin-ui.js` - Admin dashboard UI
- `generate-password-hash.js` - Password hash utility

## Files Modified

- `src/index.js` - Added admin routes and security fixes
- `wrangler.toml` - Added KV namespace configuration

## API Changes

### New Endpoints
- `GET /admin/api/records` - List all records
- `GET /admin/api/records/:id` - Get specific record
- `POST /admin/api/records` - Create record (with newsStories array)
- `PUT /admin/api/records/:id` - Update record (with newsStories array)
- `DELETE /admin/api/records/:id` - Delete record
- `GET /admin/api/stories` - List all stories
- `GET /admin/api/stories/:id` - Get specific story
- `POST /admin/api/stories` - Create story
- `PUT /admin/api/stories/:id` - Update story
- `DELETE /admin/api/stories/:id` - Delete story

### Breaking Changes
- Record date format changed from full date to year-only (YYYY format)
- Record IDs now use UUID v4 format (auto-generated)

## Migration Notes

### Date Format
- Existing records with full dates (e.g., "2024-01-01") will continue to work
- Display code extracts year from any date format
- New records should use 4-digit year format (e.g., "2024")

### ID Format
- Existing records with old ID format will continue to work
- New records use UUID v4 format
- All ID validations now support UUIDs with dashes

