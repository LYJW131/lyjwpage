-- 采集 Worker（workers/collector）写入的长期归档。迁移仍归 api 这边统一管理：
-- 先 `pnpm --dir workers/api exec wrangler d1 migrations apply lyjwpage-history --remote`，再发布采集 Worker。
-- 和 0005 同一个原则：存事实、只追加，靠主键去重；整份反复出现的数据只在值变了时改写。

-- PSN 上已获得的奖杯，每个一行。奖杯 id 在同一个 np communication id 下唯一。
-- 稀有度随全网玩家变动，变了就改写；屏蔽名单里的游戏不进表（采集侧交付前就去掉了）。
CREATE TABLE IF NOT EXISTS trophies (
  np_communication_id TEXT NOT NULL,
  trophy_id INTEGER NOT NULL,
  -- 奖杯目录对上的第一个游戏 SKU（PPSA… / CUSA…），对不上为空
  title_id TEXT,
  game_name TEXT NOT NULL,
  trophy_name TEXT NOT NULL,
  -- platinum / gold / silver / bronze
  grade TEXT NOT NULL,
  -- 获得时刻，epoch 毫秒；上游偶尔不给
  earned_at INTEGER,
  rarity_percent REAL,
  platform TEXT NOT NULL,
  -- 最后一次改写这一行时那封奖杯信的 observedAt
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (np_communication_id, trophy_id)
);
CREATE INDEX IF NOT EXISTS trophies_earned_at ON trophies(earned_at);

-- 站点（Vercel）的部署，生产和预览都记。构建中 → 就绪这类状态变化改写同一行。
CREATE TABLE IF NOT EXISTS site_deploys (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  build_duration_ms INTEGER,
  -- READY / BUILDING / QUEUED / INITIALIZING / ERROR / CANCELED / UNKNOWN
  state TEXT NOT NULL,
  -- production / preview
  target TEXT NOT NULL,
  commit_sha TEXT,
  commit_branch TEXT,
  commit_message TEXT,
  -- 最后一次改写这一行时那份部署列表的 fetchedAt
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS site_deploys_created_at ON site_deploys(created_at);
