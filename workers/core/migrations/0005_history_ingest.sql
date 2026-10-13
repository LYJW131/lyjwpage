CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  activity_type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  seconds_from_gmt INTEGER NOT NULL,
  duration_s REAL NOT NULL,
  distance_m REAL,
  energy_kcal REAL,
  avg_hr_bpm REAL,
  max_hr_bpm REAL,
  elevation_m REAL,
  indoor INTEGER,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS workouts_started_at ON workouts(started_at);

CREATE TABLE IF NOT EXISTS activity_days (
  date TEXT PRIMARY KEY,
  seconds_from_gmt INTEGER NOT NULL,
  move_kcal INTEGER NOT NULL,
  move_goal_kcal INTEGER NOT NULL,
  exercise_minutes INTEGER NOT NULL,
  exercise_goal_minutes INTEGER NOT NULL,
  stand_hours INTEGER NOT NULL,
  stand_goal_hours INTEGER NOT NULL,
  steps INTEGER,
  distance_m INTEGER,
  flights_climbed INTEGER,
  received_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS limit_snapshots (
  date TEXT NOT NULL,
  agent TEXT NOT NULL,
  limit_key TEXT NOT NULL,
  label TEXT,
  limit_group TEXT,
  window_minutes INTEGER,
  used_percent REAL NOT NULL,
  resets_at INTEGER,
  plan TEXT,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (date, agent, limit_key)
);

CREATE TABLE IF NOT EXISTS server_hours (
  host TEXT NOT NULL,
  hour_at INTEGER NOT NULL,
  samples INTEGER NOT NULL,
  cpu_percent_sum REAL NOT NULL,
  cpu_percent_max REAL NOT NULL,
  load1_sum REAL NOT NULL,
  load1_max REAL NOT NULL,
  memory_used_bytes_sum REAL NOT NULL,
  memory_total_bytes INTEGER NOT NULL,
  rx_bytes_per_sec_max REAL NOT NULL,
  tx_bytes_per_sec_max REAL NOT NULL,
  traffic_cycle_start INTEGER,
  traffic_rx_bytes INTEGER,
  traffic_tx_bytes INTEGER,
  uptime_seconds INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  PRIMARY KEY (host, hour_at)
);
