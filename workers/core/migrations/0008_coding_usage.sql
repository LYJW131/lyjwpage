CREATE TABLE IF NOT EXISTS coding_usage_days (
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  agent TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  cost_complete INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, source, agent)
);

CREATE TABLE IF NOT EXISTS coding_usage_models (
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, source, agent, model)
);

CREATE TABLE IF NOT EXISTS coding_usage_buckets (
  bucket_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  event_count INTEGER,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_at, source, agent, model)
);

CREATE TABLE IF NOT EXISTS coding_active_days (
  date TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  active_seconds INTEGER NOT NULL,
  PRIMARY KEY (date, agent, model)
);

INSERT OR IGNORE INTO coding_usage_buckets(bucket_at, source, agent, model, input_tokens, output_tokens, cache_read_tokens,
    cache_creation_tokens, reasoning_tokens, event_count, revision)
  SELECT bucket_at, 'mac', agent, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens, event_count, 0
  FROM coding_token_buckets;
INSERT OR IGNORE INTO coding_active_days
  SELECT date, agent, model, active_seconds FROM agent_usage_days WHERE active_seconds IS NOT NULL;
