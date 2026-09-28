-- Pulse 事实时间线的长期归档。写入方是状态核心：cron 每分钟从 StateHub 取一份有界快照，
-- 普通 Worker 写这里，再向 StateHub 确认水位（workers/api/src/pulse-archive.ts）。
-- 存事实、不存展示结果；每张表都按自然键幂等 upsert，重放不产生重复行。
-- 0006 留给采集 Worker 那一步，这里不占。

-- 听歌。certain = 1：Mac / HomePod 实测在放的一段（每次暂停、换曲都是新的一行）；
-- certain = 0：「最近在听」列表变动，只知道落在 (started_at, ended_at] 之间某处，
-- source = 'recent'，album 是列表条目（专辑 / 歌单）的名字、item_id 是它的目录 id，没有曲名。
CREATE TABLE IF NOT EXISTS listening_plays (
  source TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  certain INTEGER NOT NULL,
  title TEXT,
  artist TEXT,
  album TEXT,
  track_id TEXT,
  item_id TEXT,
  PRIMARY KEY (source, started_at)
);
CREATE INDEX IF NOT EXISTS listening_plays_started_at ON listening_plays(started_at);

-- 看剧：同一条目首尾相接的播放 + 暂停并成一次，playing_seconds 只算在播的部分。
CREATE TABLE IF NOT EXISTS watching_sessions (
  item_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  playing_seconds INTEGER NOT NULL,
  title TEXT,
  subtitle TEXT,
  PRIMARY KEY (item_id, started_at)
);
CREATE INDEX IF NOT EXISTS watching_sessions_started_at ON watching_sessions(started_at);

-- 在游戏里的时段（PSN 在线状态）。精度受 PSN 轮询节奏限制：没人看站点时最慢半小时一次。
CREATE TABLE IF NOT EXISTS game_sessions (
  title_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  title TEXT,
  PRIMARY KEY (title_id, started_at)
);
CREATE INDEX IF NOT EXISTS game_sessions_started_at ON game_sessions(started_at);

-- 充电头的实测瓦数，过了写入闸门的那些（跨待机门槛立刻、通电时 ≥ 30 秒且变化明显、最迟 5 分钟一笔）。
CREATE TABLE IF NOT EXISTS charging_samples (
  t INTEGER PRIMARY KEY,
  watts REAL NOT NULL,
  device TEXT
);
-- 一次充电：连续通电（高于 1 W）的一串样本，中间不断流。能量按每笔的有效期积分，还在充时每分钟改写。
CREATE TABLE IF NOT EXISTS charging_sessions (
  started_at INTEGER PRIMARY KEY,
  ended_at INTEGER NOT NULL,
  peak_w REAL NOT NULL,
  energy_wh REAL NOT NULL,
  device TEXT
);

-- HealthKit 闭合的五分钟桶原值；缺了哪项就是 NULL。iPhone 每次查询权威替换一段范围，
-- 用 pulse_archive_state 里 domain = 'activity_buckets' 那一行的版本挡住较旧的异步替换。
CREATE TABLE IF NOT EXISTS activity_buckets (
  started_at INTEGER PRIMARY KEY,
  ended_at INTEGER NOT NULL,
  steps INTEGER,
  move_kcal REAL,
  exercise_minutes REAL
);

-- Coding 的原始观测：前台应用、是不是 coding 应用、各 agent 在不在跑（agents 是 JSON 数组）。
CREATE TABLE IF NOT EXISTS coding_observations (
  t INTEGER PRIMARY KEY,
  available INTEGER NOT NULL,
  application TEXT,
  coding INTEGER,
  agents TEXT
);

-- Mac 本机扫描的五分钟 token 桶（codex / claude），按 agent × 模型；model = '' 是没有模型名的事件。
-- 只有有事件的桶才有行：报告范围内缺席的桶是 0，范围外是未知（范围本身不归档）。
CREATE TABLE IF NOT EXISTS coding_token_buckets (
  bucket_at INTEGER NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  event_count INTEGER NOT NULL,
  PRIMARY KEY (bucket_at, agent, model)
);

-- 每天（Asia/Shanghai）× agent × 模型的用量。各来源只填自己真有的列，其余为 NULL：
-- - model 为具体模型：codex / claude 由上面的五分钟桶汇总（token 分类、reasoning、事件数）；
--   cursor / claude-cloud 的云端日桶只有每个模型的 total_tokens。
-- - model = '*' 是这个 agent 当天的合计：token 分类与 API 等值费用 cost_usd（费用没有按模型的）。
--   codex / claude 取 Mac 用量摘要的 today（只归档到每天最后一次采集，午夜前几分钟可能没赶上），
--   cursor / claude-cloud 取各自的云端日桶。
-- - active_seconds 来自 Coding 观测（agent 在跑的时长，3 分钟保持）；Cursor 只有账号级、没有模型。
CREATE TABLE IF NOT EXISTS agent_usage_days (
  date TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  reasoning_tokens INTEGER,
  total_tokens INTEGER,
  event_count INTEGER,
  cost_usd REAL,
  active_seconds INTEGER,
  PRIMARY KEY (date, agent, model)
);
