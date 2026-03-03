-- Location enrichment fields for AI-verified city and geocoded coordinates.

ALTER TABLE records ADD COLUMN city_verified TEXT;
ALTER TABLE records ADD COLUMN city_confidence REAL;
ALTER TABLE records ADD COLUMN city_verification_source TEXT;
ALTER TABLE records ADD COLUMN city_verification_notes TEXT;

ALTER TABLE records ADD COLUMN location_lat REAL;
ALTER TABLE records ADD COLUMN location_lon REAL;
ALTER TABLE records ADD COLUMN location_source TEXT;
ALTER TABLE records ADD COLUMN location_confidence REAL;
ALTER TABLE records ADD COLUMN location_updated_at TEXT;
ALTER TABLE records ADD COLUMN location_last_checked_at TEXT;

CREATE TABLE IF NOT EXISTS city_geocode_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    city TEXT NOT NULL,
    province TEXT NOT NULL,
    country TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    confidence REAL,
    provider TEXT,
    provider_raw TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_city_geocode_cache_key
  ON city_geocode_cache(city, province, country);

CREATE INDEX IF NOT EXISTS idx_records_city_verified
  ON records(city_verified);

CREATE INDEX IF NOT EXISTS idx_records_location_lat_lon
  ON records(location_lat, location_lon);
