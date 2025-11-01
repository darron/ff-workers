-- Production database schema
-- Converted from SQLite dump

CREATE TABLE records (
    id TEXT NOT NULL PRIMARY KEY,
    date TEXT,
    name TEXT,
    city TEXT,
    province TEXT,
    licensed INTEGER,
    victims INT,
    deaths INT,
    injuries INT,
    suicide INTEGER,
    devices_used TEXT,
    firearms INTEGER,
    possessed_legally INTEGER,
    warnings TEXT,
    oic_impact INTEGER,
    ai_summary TEXT
);

CREATE TABLE news_stories (
    id TEXT NOT NULL PRIMARY KEY,
    record_id TEXT NOT NULL,
    url TEXT,
    body_text TEXT,
    ai_summary TEXT,
    FOREIGN KEY (record_id) REFERENCES records (id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
CREATE INDEX IF NOT EXISTS idx_news_stories_record_id ON news_stories(record_id);
