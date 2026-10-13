CREATE TABLE IF NOT EXISTS trophies (
  np_communication_id TEXT NOT NULL,
  trophy_id INTEGER NOT NULL,
  title_id TEXT,
  game_name TEXT NOT NULL,
  trophy_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  earned_at INTEGER,
  rarity_percent REAL,
  platform TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (np_communication_id, trophy_id)
);
CREATE INDEX IF NOT EXISTS trophies_earned_at ON trophies(earned_at);

CREATE TABLE IF NOT EXISTS site_deploys (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  build_duration_ms INTEGER,
  state TEXT NOT NULL,
  target TEXT NOT NULL,
  commit_sha TEXT,
  commit_branch TEXT,
  commit_message TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS site_deploys_created_at ON site_deploys(created_at);
