CREATE TABLE IF NOT EXISTS pulse_samples (
  domain TEXT NOT NULL,
  t INTEGER NOT NULL,
  level INTEGER NOT NULL,
  hint TEXT,
  PRIMARY KEY (domain, t)
);
