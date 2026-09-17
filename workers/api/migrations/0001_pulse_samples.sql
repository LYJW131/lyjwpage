-- 长期活动历史归档：StateHub 的 pulse 序列只留 600 条 / 7 天，这里只增不删。
-- 主键 (domain, t) 让每分钟的重放用 INSERT OR IGNORE 天然幂等。
CREATE TABLE IF NOT EXISTS pulse_samples (
  domain TEXT NOT NULL,
  t INTEGER NOT NULL,
  level INTEGER NOT NULL,
  hint TEXT,
  PRIMARY KEY (domain, t)
);
