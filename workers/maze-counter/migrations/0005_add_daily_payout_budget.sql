ALTER TABLE reward_claims ADD COLUMN budget_day TEXT NOT NULL DEFAULT '';

UPDATE reward_claims
SET budget_day = strftime('%Y-%m-%d', CAST(created_at / 1000 AS INTEGER), 'unixepoch')
WHERE budget_day = '';

CREATE TABLE IF NOT EXISTS daily_payout_budgets (
  day_utc TEXT PRIMARY KEY,
  cap_usd_cents INTEGER NOT NULL CHECK (cap_usd_cents >= 0),
  reserved_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (reserved_usd_cents >= 0),
  paid_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_usd_cents >= 0)
);

CREATE TABLE IF NOT EXISTS daily_payout_reservations (
  claim_id TEXT PRIMARY KEY REFERENCES reward_claims(id),
  day_utc TEXT NOT NULL REFERENCES daily_payout_budgets(day_utc),
  usd_cents INTEGER NOT NULL CHECK (usd_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'paid', 'released'))
);

INSERT INTO daily_payout_budgets (day_utc, cap_usd_cents, reserved_usd_cents, paid_usd_cents)
SELECT
  budget_day,
  0,
  SUM(CASE WHEN status IN ('reserved', 'signed', 'indeterminate') THEN usd_cents ELSE 0 END),
  SUM(CASE WHEN status = 'paid' THEN usd_cents ELSE 0 END)
FROM reward_claims
GROUP BY budget_day;

INSERT INTO daily_payout_reservations (claim_id, day_utc, usd_cents, status)
SELECT
  id,
  budget_day,
  usd_cents,
  CASE
    WHEN status = 'paid' THEN 'paid'
    WHEN status = 'failed' THEN 'released'
    ELSE 'reserved'
  END
FROM reward_claims;

CREATE TRIGGER reward_claim_budget_reserve_after_insert
AFTER INSERT ON reward_claims
WHEN NEW.status IN ('reserved', 'signed', 'indeterminate')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM daily_payout_budgets
    WHERE day_utc = NEW.budget_day
      AND cap_usd_cents > 0
      AND reserved_usd_cents + paid_usd_cents + NEW.usd_cents <= cap_usd_cents
  ) THEN RAISE(ABORT, 'DAILY_PAYOUT_CAP_REACHED') END;

  UPDATE daily_payout_budgets
  SET reserved_usd_cents = reserved_usd_cents + NEW.usd_cents
  WHERE day_utc = NEW.budget_day;

  INSERT INTO daily_payout_reservations (claim_id, day_utc, usd_cents, status)
  VALUES (NEW.id, NEW.budget_day, NEW.usd_cents, 'reserved');
END;

CREATE TRIGGER reward_claim_budget_reserve_after_retry
BEFORE UPDATE OF status ON reward_claims
WHEN OLD.status = 'failed' AND NEW.status IN ('reserved', 'signed', 'indeterminate')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM daily_payout_budgets
    WHERE day_utc = NEW.budget_day
      AND cap_usd_cents > 0
      AND reserved_usd_cents + paid_usd_cents + NEW.usd_cents <= capUsdCents
  ) THEN RAISE(ABORT, 'DAILY_PAYOUT_CAP_REACHED') END;

  UPDATE daily_payout_budgets
  SET reserved_usd_cents = reserved_usd_cents + NEW.usd_cents
  WHERE day_utc = NEW.budget_day;

  INSERT INTO daily_payout_reservations (claim_id, day_utc, usd_cents, status)
  VALUES (NEW.id, NEW.budget_day, NEW.usd_cents, 'reserved')
  ON CONFLICT(claim_id) DO UPDATE SET
    day_utc = excluded.day_utc,
    usd_cents = excluded.usd_cents,
    status = 'reserved';
END;

CREATE TRIGGER reward_claim_budget_settle_after_update
AFTER UPDATE OF status ON reward_claims
WHEN OLD.status IN ('reserved', 'signed', 'indeterminate') AND NEW.status = 'paid'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM daily_payout_budgets
    WHERE day_utc = OLD.budget_day
      AND reserved_usd_cents >= OLD.usd_cents
  ) THEN RAISE(ABORT, 'DAILY_PAYOUT_BUDGET_STATE_INVALID') END;

  UPDATE daily_payout_budgets
  SET reserved_usd_cents = reserved_usd_cents - OLD.usd_cents,
      paid_usd_cents = paid_usd_cents + NEW.usd_cents
  WHERE day_utc = OLD.budget_day;

  UPDATE daily_payout_reservations
  SET status = 'paid'
  WHERE claim_id = NEW.id AND status = 'reserved';
END;

CREATE TRIGGER reward_claim_budget_release_after_update
AFTER UPDATE OF status ON reward_claims
WHEN OLD.status IN ('reserved', 'signed', 'indeterminate') AND NEW.status = 'failed'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM daily_payout_budgets
    WHERE day_utc = OLD.budget_day
      AND reserved_usd_cents >= OLD.usd_cents
  ) THEN RAISE(ABORT, 'DAILY_PAYOUT_BUDGET_STATE_INVALID') END;

  UPDATE daily_payout_budgets
  SET reserved_usd_cents = reserved_usd_cents - OLD.usd_cents
  WHERE day_utc = OLD.budget_day;

  UPDATE daily_payout_reservations
  SET status = 'released'
  WHERE claim_id = NEW.id AND status = 'reserved';
END;
