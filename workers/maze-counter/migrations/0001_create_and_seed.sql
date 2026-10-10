CREATE TABLE IF NOT EXISTS game_counters (
  name TEXT PRIMARY KEY,
  total INTEGER NOT NULL CHECK (total >= 0)
);

INSERT OR IGNORE INTO game_counters (name, total)
VALUES ('stock-gap-maze', 1013);
