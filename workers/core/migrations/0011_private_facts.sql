CREATE TABLE IF NOT EXISTS watching_events (
  observed_at INTEGER PRIMARY KEY,
  item_id TEXT,
  title TEXT,
  subtitle TEXT,
  paused INTEGER,
  position_ms INTEGER,
  runtime_ms INTEGER,
  client TEXT,
  device TEXT,
  play_method TEXT,
  media TEXT
);

CREATE TABLE IF NOT EXISTS game_play_snapshots (
  title_id TEXT NOT NULL,
  play_duration_ms INTEGER NOT NULL,
  play_count INTEGER NOT NULL,
  last_played_at INTEGER,
  name TEXT,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (title_id, play_duration_ms)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS game_play_snapshots_observed_at ON game_play_snapshots(observed_at);

CREATE TABLE IF NOT EXISTS trophy_profile_days (
  date TEXT PRIMARY KEY,
  level INTEGER NOT NULL,
  level_progress INTEGER NOT NULL,
  trophy_points INTEGER NOT NULL,
  platinum INTEGER NOT NULL,
  gold INTEGER NOT NULL,
  silver INTEGER NOT NULL,
  bronze INTEGER NOT NULL,
  observed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quest_activities (
  started_at INTEGER NOT NULL,
  title_key TEXT NOT NULL,
  details TEXT NOT NULL,
  state TEXT NOT NULL,
  name TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (started_at, title_key, details, state)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS quest_activities_first_seen_at ON quest_activities(first_seen_at);

CREATE TABLE IF NOT EXISTS homepod_events (
  entity_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  title TEXT,
  artist TEXT,
  album TEXT,
  position_ms INTEGER,
  duration_ms INTEGER,
  PRIMARY KEY (entity_id, observed_at)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS homepod_events_observed_at ON homepod_events(observed_at);

CREATE TABLE IF NOT EXISTS powerbank_minutes (
  minute_at INTEGER PRIMARY KEY,
  connected INTEGER NOT NULL,
  battery_percent REAL,
  charging INTEGER NOT NULL,
  health_percent REAL,
  input_w REAL NOT NULL,
  output_w REAL NOT NULL,
  temperature_c REAL,
  thermal_limited INTEGER NOT NULL,
  observed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS charging_port_minutes (
  minute_at INTEGER NOT NULL,
  port TEXT NOT NULL,
  watts REAL,
  volts REAL,
  amps REAL,
  protocol TEXT,
  cable TEXT,
  device TEXT,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (minute_at, port)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS desktop_changes (
  t INTEGER PRIMARY KEY,
  application TEXT NOT NULL,
  bundle_id TEXT,
  window_title TEXT
);

CREATE TABLE IF NOT EXISTS timezone_changes (
  t INTEGER PRIMARY KEY,
  identifier TEXT NOT NULL,
  abbreviation TEXT,
  seconds_from_gmt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS focus_changes (
  t INTEGER PRIMARY KEY,
  mode TEXT
);

ALTER TABLE server_hours ADD COLUMN load5_max REAL;
ALTER TABLE server_hours ADD COLUMN load15_max REAL;
ALTER TABLE server_hours ADD COLUMN memory_available_bytes_min INTEGER;
ALTER TABLE server_hours ADD COLUMN disk_used_bytes INTEGER;
ALTER TABLE server_hours ADD COLUMN disk_total_bytes INTEGER;
ALTER TABLE server_hours ADD COLUMN rx_bytes INTEGER;
ALTER TABLE server_hours ADD COLUMN tx_bytes INTEGER;

CREATE TABLE IF NOT EXISTS server_identity (
  host TEXT NOT NULL,
  public_ip TEXT NOT NULL,
  os TEXT NOT NULL,
  kernel TEXT NOT NULL,
  country TEXT,
  city TEXT,
  isp TEXT,
  asn INTEGER,
  asn_org TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (host, public_ip, os, kernel)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS server_identity_first_seen_at ON server_identity(first_seen_at);
