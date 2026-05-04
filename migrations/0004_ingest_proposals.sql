-- Agent-assisted story ingestion proposal/audit table.

CREATE TABLE IF NOT EXISTS story_ingest_proposals (
    id TEXT NOT NULL PRIMARY KEY,
    url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    status TEXT NOT NULL,
    proposed_action TEXT,
    proposed_record_id TEXT,
    proposed_story_id TEXT,
    worker_confidence REAL,
    worker_reason TEXT,
    agent_decision TEXT,
    agent_confidence REAL,
    agent_reason TEXT,
    extracted_title TEXT,
    extracted_text TEXT,
    extracted_facts_json TEXT,
    decision_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    applied_at TEXT,
    applied_story_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_story_ingest_proposals_status
  ON story_ingest_proposals(status);

CREATE INDEX IF NOT EXISTS idx_story_ingest_proposals_normalized_url
  ON story_ingest_proposals(normalized_url);

CREATE INDEX IF NOT EXISTS idx_story_ingest_proposals_record
  ON story_ingest_proposals(proposed_record_id);
