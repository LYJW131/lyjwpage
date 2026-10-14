CREATE TABLE IF NOT EXISTS health_buckets (
  series TEXT NOT NULL,
  hour_start INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  failure INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  last_ok INTEGER NOT NULL,
  PRIMARY KEY (series, hour_start)
) WITHOUT ROWID;
