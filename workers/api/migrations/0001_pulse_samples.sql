-- 档位时代的活动历史归档（已冻结，不再写）。
-- 主键 (domain, t) 让每分钟的重放用 INSERT OR IGNORE 天然幂等。
CREATE TABLE IF NOT EXISTS pulse_samples (
  domain TEXT NOT NULL,
  t INTEGER NOT NULL,
  level INTEGER NOT NULL,
  hint TEXT,
  PRIMARY KEY (domain, t)
);
