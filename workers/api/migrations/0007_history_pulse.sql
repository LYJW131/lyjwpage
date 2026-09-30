CREATE TABLE IF NOT EXISTS listening_plays (
  source TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  certain INTEGER NOT NULL,
  title TEXT,
  artist TEXT,
  album TEXT,
  track_id TEXT,
  item_id TEXT,
  PRIMARY KEY (source, started_at)
);
CREATE INDEX IF NOT EXISTS listening_plays_started_at ON listening_plays(started_at);

CREATE TABLE IF NOT EXISTS watching_sessions (
  item_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  playing_seconds INTEGER NOT NULL,
  title TEXT,
  subtitle TEXT,
  PRIMARY KEY (item_id, started_at)
);
CREATE INDEX IF NOT EXISTS watching_sessions_started_at ON watching_sessions(started_at);

CREATE TABLE IF NOT EXISTS game_sessions (
  title_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  title TEXT,
  PRIMARY KEY (title_id, started_at)
);
CREATE INDEX IF NOT EXISTS game_sessions_started_at ON game_sessions(started_at);

CREATE TABLE IF NOT EXISTS charging_samples (
  t INTEGER PRIMARY KEY,
  watts REAL NOT NULL,
  device TEXT
);
CREATE TABLE IF NOT EXISTS charging_sessions (
  started_at INTEGER PRIMARY KEY,
  ended_at INTEGER NOT NULL,
  peak_w REAL NOT NULL,
  energy_wh REAL NOT NULL,
  device TEXT
);

CREATE TABLE IF NOT EXISTS activity_buckets (
  started_at INTEGER PRIMARY KEY,
  ended_at INTEGER NOT NULL,
  steps INTEGER,
  move_kcal REAL,
  exercise_minutes REAL
);

CREATE TABLE IF NOT EXISTS coding_observations (
  t INTEGER PRIMARY KEY,
  available INTEGER NOT NULL,
  application TEXT,
  coding INTEGER,
  agents TEXT
);

CREATE TABLE IF NOT EXISTS coding_token_buckets (
  bucket_at INTEGER NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  event_count INTEGER NOT NULL,
  PRIMARY KEY (bucket_at, agent, model)
);

CREATE TABLE IF NOT EXISTS agent_usage_days (
  date TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  reasoning_tokens INTEGER,
  total_tokens INTEGER,
  event_count INTEGER,
  cost_usd REAL,
  active_seconds INTEGER,
  PRIMARY KEY (date, agent, model)
);
