-- Canonical story URLs and DB-backed dedupe for agent ingestion.

ALTER TABLE news_stories ADD COLUMN canonical_url TEXT;

-- Preserve all existing rows. If exact URL duplicates already exist, only the
-- first row gets a canonical_url so the unique index can be added safely.
UPDATE news_stories
SET canonical_url = url
WHERE url IS NOT NULL
  AND TRIM(url) <> ''
  AND id IN (
    SELECT MIN(id)
    FROM news_stories
    WHERE url IS NOT NULL
      AND TRIM(url) <> ''
    GROUP BY url
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_news_stories_canonical_url_unique
  ON news_stories(canonical_url)
  WHERE canonical_url IS NOT NULL;

-- Preserve the oldest active proposal per URL. Older test/import runs may have
-- left duplicate active proposals before DB-level dedupe existed.
UPDATE story_ingest_proposals
SET status = 'duplicate',
    error = COALESCE(error, 'Marked duplicate while adding active proposal URL uniqueness.'),
    updated_at = datetime('now')
WHERE normalized_url IS NOT NULL
  AND status IN ('worker_proposed', 'needs_review')
  AND id NOT IN (
    SELECT MIN(id)
    FROM story_ingest_proposals
    WHERE normalized_url IS NOT NULL
      AND status IN ('worker_proposed', 'needs_review')
    GROUP BY normalized_url
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_story_ingest_proposals_active_url_unique
  ON story_ingest_proposals(normalized_url)
  WHERE status IN ('worker_proposed', 'needs_review');
