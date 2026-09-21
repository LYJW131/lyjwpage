-- 展示状态的长期存档。StateHub 里每个 subject 只留最近 4000 条 / 7 天，这里只增不删。
-- 主键 (subject, t) 让每分钟的重放用 INSERT OR IGNORE 幂等；t 在 subject 内单调。
CREATE TABLE IF NOT EXISTS state_changes (
  subject TEXT NOT NULL,
  t INTEGER NOT NULL,
  at INTEGER NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY (subject, t)
);
