CREATE TABLE IF NOT EXISTS auth_challenges (
  wallet TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS campaign_sessions (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  challenge_nonce TEXT UNIQUE,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  duration_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active', 'complete', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS campaign_sessions_wallet_status
  ON campaign_sessions (wallet, status);

CREATE TABLE IF NOT EXISTS maze_leaderboard (
  wallet TEXT PRIMARY KEY,
  best_ms INTEGER NOT NULL CHECK (best_ms >= 0),
  completed_at INTEGER NOT NULL,
  run_id TEXT NOT NULL REFERENCES campaign_sessions(id)
);

CREATE INDEX IF NOT EXISTS maze_leaderboard_order
  ON maze_leaderboard (best_ms ASC, completed_at ASC);
