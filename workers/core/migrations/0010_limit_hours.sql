CREATE TABLE IF NOT EXISTS limit_hours (
  agent TEXT NOT NULL,
  limit_key TEXT NOT NULL,
  hour_at INTEGER NOT NULL,
  window_minutes INTEGER,
  used_percent REAL NOT NULL,
  resets_at INTEGER,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (agent, limit_key, hour_at)
) WITHOUT ROWID;
