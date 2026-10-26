CREATE TABLE IF NOT EXISTS reward_claims (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES campaign_sessions(id),
  wallet TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  usd_cents INTEGER NOT NULL CHECK (usd_cents IN (70, 140)),
  multiplier INTEGER NOT NULL CHECK (multiplier IN (1, 2)),
  quote_price TEXT NOT NULL,
  quote_published_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'signed', 'paid', 'failed', 'indeterminate')),
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  signature TEXT,
  signed_transaction TEXT,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS reward_claims_wallet_cooldown
  ON reward_claims (wallet, status, paid_at);

CREATE UNIQUE INDEX IF NOT EXISTS reward_claims_one_pending_per_wallet
  ON reward_claims (wallet)
  WHERE status IN ('reserved', 'signed', 'indeterminate');
