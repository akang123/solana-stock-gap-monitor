ALTER TABLE campaign_sessions ADD COLUMN current_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaign_sessions ADD COLUMN level_started_at INTEGER;

CREATE TABLE IF NOT EXISTS campaign_level_completions (
  session_id TEXT NOT NULL REFERENCES campaign_sessions(id),
  level_index INTEGER NOT NULL CHECK (level_index >= 0 AND level_index < 4),
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  PRIMARY KEY (session_id, level_index)
);
