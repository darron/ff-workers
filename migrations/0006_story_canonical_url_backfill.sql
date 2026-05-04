-- Normalize common canonical URL variants after the initial exact-URL backfill.

DROP INDEX IF EXISTS idx_news_stories_canonical_url_unique;

UPDATE news_stories
SET canonical_url = substr(canonical_url, 1, instr(canonical_url, '#') - 1)
WHERE canonical_url IS NOT NULL
  AND instr(canonical_url, '#') > 0;

UPDATE news_stories
SET canonical_url = substr(canonical_url, 1, length(canonical_url) - 1)
WHERE canonical_url IS NOT NULL
  AND length(canonical_url) > 1
  AND substr(canonical_url, -1) = '/'
  AND substr(
    substr(canonical_url, instr(canonical_url, '://') + 3),
    instr(substr(canonical_url, instr(canonical_url, '://') + 3), '/') + 1
  ) <> '';

UPDATE news_stories
SET canonical_url = NULL
WHERE canonical_url IS NOT NULL
  AND id NOT IN (
    SELECT MIN(id)
    FROM news_stories
    WHERE canonical_url IS NOT NULL
    GROUP BY canonical_url
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_news_stories_canonical_url_unique
  ON news_stories(canonical_url)
  WHERE canonical_url IS NOT NULL;
