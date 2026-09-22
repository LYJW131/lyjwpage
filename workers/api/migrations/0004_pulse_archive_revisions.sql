-- 历史 Activity 桶会被 HealthKit 修订；范围版本阻止较旧的异步归档覆盖较新快照。
CREATE TABLE IF NOT EXISTS pulse_archive_state (
  domain TEXT PRIMARY KEY,
  revision INTEGER NOT NULL
);
