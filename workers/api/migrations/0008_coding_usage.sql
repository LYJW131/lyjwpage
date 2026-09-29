-- coding agent token 用量改成「来源只报原始事实、状态核心一处合并」之后的归档（见 workers/api/README.md 的长期归档）。
-- 三种事实各一张表，都带来源：mac（Mac 本机日志）、agents（Cursor 账号历史）、agents-otlp（Claude Code 云端遥测）。

-- 日事实：来源 × agent × 站点日（Asia/Shanghai）。按 (来源, agent) 整份替换的语义在状态核心；这里按自然键 upsert。
-- total_tokens ≥ 四列之和，多出的是来源没分列的量；reasoning 是 output 的子集。cost_usd 按公开 API 价估算，不是账单。
-- revision 是写下这一行的那份账本的修订号（状态核心的 coding:usage:revision）：upsert 只在新来的修订号更大时才改这一行，
-- 两轮归档重叠、旧快照晚写时不会把新值盖回去。桶表同理（pulse:token-buckets:revision）。
CREATE TABLE IF NOT EXISTS coding_usage_days (
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  agent TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  cost_complete INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, source, agent)
);

-- 同一天按来源的模型拆分。只增不删：来源事后把某个模型从那一天拿掉时，旧行留着。
CREATE TABLE IF NOT EXISTS coding_usage_models (
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, source, agent, model)
);

-- 5 分钟 token 桶，各来源都进来；model = '' 是没有模型名的事件。Mac / agents 只写起点被报告范围盖住的桶
-- （跨着范围起点的那一桶只数了一截）；云端 OTLP 的桶是正差值累加，没有覆盖区间，event_count 为 NULL。
CREATE TABLE IF NOT EXISTS coding_usage_buckets (
  bucket_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  event_count INTEGER,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_at, source, agent, model)
);

-- agent 在跑的秒数（来自 Coding 观测，3 分钟保持），从 agent_usage_days 拆出来；model = '*' 是这个 agent 当天的合计，
-- Cursor 只有账号级、没有模型。
CREATE TABLE IF NOT EXISTS coding_active_days (
  date TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  active_seconds INTEGER NOT NULL,
  PRIMARY KEY (date, agent, model)
);

-- 旧表 coding_token_buckets、agent_usage_days 冻结（同 pulse_samples），能搬的搬过来。日事实不从旧表回填：
-- 旧表只有每天最后一次 today，新契约第一封就带完整历史。
INSERT OR IGNORE INTO coding_usage_buckets(bucket_at, source, agent, model, input_tokens, output_tokens, cache_read_tokens,
    cache_creation_tokens, reasoning_tokens, event_count, revision)
  SELECT bucket_at, 'mac', agent, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens, event_count, 0
  FROM coding_token_buckets;
INSERT OR IGNORE INTO coding_active_days
  SELECT date, agent, model, active_seconds FROM agent_usage_days WHERE active_seconds IS NOT NULL;
