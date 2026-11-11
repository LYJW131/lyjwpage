CREATE TABLE IF NOT EXISTS listening_events (
  source TEXT NOT NULL,
  time_unix_nano TEXT NOT NULL,
  event TEXT NOT NULL,
  track_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  track_name TEXT,
  artist_name TEXT,
  album_name TEXT,
  duration_ms INTEGER,
  position_ms INTEGER,
  heard_ms INTEGER,
  service_name TEXT,
  service_version TEXT,
  attributes TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (source, time_unix_nano, event, track_id)
);
CREATE INDEX IF NOT EXISTS listening_events_occurred_at ON listening_events(occurred_at);
