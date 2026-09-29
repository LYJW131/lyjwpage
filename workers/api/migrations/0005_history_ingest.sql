-- 整站长期历史归档：上报入口收下一封就顺手追加（docs/state-storage.md「长期归档」）。
-- 存事实、不存展示结果；只追加，靠主键去重，重试不产生重复行。
-- pulse_samples 是旧档位数据的表，保留原样，不迁移也不再写。

-- iPhone 上报的训练。HealthKit 会事后修订同一条（补心率、改类型），按 id 覆盖成最新一份。
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

-- 每天的活动圆环，按手表本地日。同一天多次上报取观测最晚的一份，这一天过完留下的就是终值。
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

-- 各厂商限额的每日快照：站点统计日（Asia/Shanghai）里同一 agent、同一窗口只留最后一次读数。
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

-- 服务器按 UTC 整点汇总：每分钟一封的读数不逐条存。每封 upsert 进所在小时，
-- 均值 = 和 / samples，这一小时在线的分钟数就是 samples。流量存计费周期累计值
-- 在这小时里最后一次的读数，相邻两小时相减就是这小时用了多少。
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
