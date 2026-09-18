# Worker 数据后端与首屏缓存

Worker 是唯一数据后端。上报、状态 API、Apple / GitHub 获取和缓存、WebSocket、在线人数均在 Cloudflare。Vercel 只在生成或后台重建首页时 GET `/api/home`；浏览器挂载后直接请求 Worker，不存在 Vercel 状态代理。`lyjw131.com` 经 ESA 回源 `lyjw.me`（回源 Host 同为 `lyjw.me`），ESA 缓存首页 HTML 与静态 JS。

## 数据及权限

- `StateHub` 使用 SQLite Durable Object，`entries`、`fields`、`samples` 分别保存快照、字段和历史。SQLite 是唯一持久状态，DO 重启不丢数据。
- 上报读改写按对象队列串行执行；每次公开查询和上报有独立工作副本。存储批次由同步事务提交。返回 202 前已确认写入，失败不能成功应答。
- TTL 读取时检查，闹钟每小时分批回收过期项；导入保留原始绝对过期时间，重试不覆盖目标已有值。
- `/api/status/*`、`/api/home`、`/api/lyrics`、`/api/motion-artwork` 只输出明确的公开模型。没有 HTTP 通用数据库读写端点，服务端凭据不进入 Vercel、HTML 或状态响应。CORS 限制浏览器来源；公开 API 不以 CORS 当作秘密鉴权。
- `/api/ingest/*` 使用 `TELEMETRY_INGEST_SECRET`。临时 `/api/internal/storage/import` 使用独立 `STATE_IMPORT_SECRET`，不授予 Vercel，迁移后删除 Secret。
- 跨域活动脉搏（pulse）键为 `pulse:<domain>`（`coding` / `listening` / `watching` / `gaming` / `charging`）。每域最多 600 条，TTL 7 天；同水平非空闲最多每 5 分钟再确认一次，空闲只留一条。公开出口是 `GET /api/status/pulse`（裁最近 24 小时、剥掉 `hint`）；`hint` 只留在库里和送去打分的那份里。
- API Worker 的 `LIVE_PUSH` 使用可休眠 WebSocket，`api.homepage.lyjw.llc/count` 返回 `connections`（包含后台页面）。独立 `online-counter` Worker 的 `ONLINE_COUNTER` 维护可见连接，按空闲超时清扫；`online.homepage.lyjw.llc/count` 返回 `online`。三个调频上报器并行读取两个计数口，各自失败时仅该端归零。

## 长期归档（D1）

- 归档库 `lyjwpage-history`，Worker 里的绑定叫 `HISTORY`，只有一张表 `pulse_samples(domain, t, level, hint)`，主键 `(domain, t)`。StateHub 仍是唯一权威，这里只增不删：StateHub 每域只留 600 条 / 7 天，归档保留全部历史。
- 写入由 cron 每分钟从 StateHub 驱动（`archivePulse()` → `workers/api/src/pulse-archive.ts`），不挂在上报路径上：上报不等 D1。每域一条水位线存在 StateHub 的 `metadata` 表里，键为 `pulse-archive:<domain>`，值是已归档的最大 `t`；只有 `INSERT OR IGNORE` 的那一批落地后水位线才前进，失败就留在原处，下一分钟重试。每批最多 100 条语句，一域失败只丢这一域，错误只进 `[pulse-archive]` 日志。
- 本地和夹具环境不写归档：`historyArchiveEnabled` 和读模型用同一套闸门，配了 `DEV_OVERRIDES` 或 `UPSTREAM_API_URL` 就停用，没有 `HISTORY` 绑定也停用。
- 归档暂时没有公开 HTTP 读路径，只作备份；公开的那份走 `GET /api/status/pulse`，从 StateHub 的 7 天序列里裁最近 24 小时，不读 D1。读归档的入口另开时再补这一节。
- 建表只在迁移里做，Worker 不会自己建：`pnpm --dir workers/api exec wrangler d1 migrations apply lyjwpage-history --remote`。Workers Builds 不跑 D1 迁移，必须在带 `HISTORY` 绑定的版本部署前先应用，否则第一趟 cron 就会在日志里报表不存在。
- 回滚就是从 `wrangler.toml` 删掉 `[[d1_databases]]`，归档随即停用，StateHub 与站点行为不变；库和已归档的数据留着，重新加回绑定后从水位线继续。

## 活动分（pulse:scores）

- 键 `pulse:scores`（前缀之后），一份 JSON、五个域，**不设 TTL**：失败时留着上一次的判断，卡片宁可显示十分钟前的分，也不该空一格；超过 6 小时的分公开端点不再给。旁边的 `pulse:scores:attempt` 记上一次向网关尝试的时刻（失败也记），DO 重启后节流不归零。形状见 `PulseScoreRecord`（`src/lib/types.ts`），写入方是 `workers/api/src/pulse-score.ts`，读取方是 `getPulseStatus()` 与评分器自己（判断有没有新样本）。
- 由 cron 每分钟驱动，真正调用外部模型最多十分钟一次，契约与闸门见 [遥测与实时状态子系统](telemetry-subsystems.md) 第 14 节。解析不出的存量按「没有分」处理，不做兼容分支。

## 首屏与浏览器

`cachedHomeSnapshot` 一次读取公开聚合快照；单个数据源不可用使用卡片降级信封。网络失败抛出错误，不用错误快照覆盖已有 Next 缓存。Next cacheLife 为 stale 300、revalidate 600、expire 604800 秒；所有状态标签使用 `page:` 前缀。

Worker 写入完成后，只有展示变化才 POST `/api/revalidate`。接口校验 Bearer 和标签白名单，调用 `revalidateTag(tag, "max")`，已有 HTML 优先返回并后台重建。不使用 `expire: 0`，不因纯心跳刷新首页。ESA 首页不走通知：控制台缓存规则「首页遵循源站缓存」让边缘按源站 `Cache-Control` 的 SWR（`max-age=300, stale-while-revalidate=86400`，见 `next.config.ts`）自行过期与后台取新；`/` 无文件后缀，没有这条规则会被判 DYNAMIC、每次回源。Vercel 的后台重建与 ESA 后台回源独立完成，ESA 可能取到重建中的旧 HTML，下一轮收敛；不能把标签失效当成两层 HTML 同步更新完成。浏览器查询直接访问 Worker，时间相关的新鲜度每次读取现算。

## 配置

Vercel 参照根 `.env.example`，仅公开后端源、缓存通知鉴权和 R2 公开源（`/img/*` rewrite 的目的地与首屏图标内联的来源；Worker 不配交付域）。Worker 参照 `workers/api/.dev.vars.example` 与 wrangler.toml；状态数据用的 GitHub Token 使用 Worker Secret，Apple Music 凭据来自 Mac 上报。`UPSTREAM_API_URL` 只存在于本地 `.dev.vars`：本地 Worker 以生产为主、本地补缺，生产 `ok:true` 的快照字段和端点用生产的，生产没有的才用本地的（只读），生产配置不设它。`NEXT_PUBLIC_BACKEND_URL` 与 `NEXT_PUBLIC_ONLINE_COUNTER_URL` 构建期写入前端，分别提供状态/推送源与独立在线人数源，改值需要重新部署。

Vercel 可选配一份 `GITHUB_TOKEN`，只给构建期读公开仓的首页「最近提交」列表用（`use cache` + `cacheLife("max")`，随每次部署取一次）。不配也能匿名读，配上只是避开匿名限额；它不参与状态端点，浏览器和 HTML 拿不到。「本仓库」卡的贡献统计和贡献日历一样由 Worker 取数、缓存并经 `/api/home` 与 `/api/status/github-repo` 提供。贡献者名单走 REST `/stats/contributors`（匿名也能读），顶部 COMMITS / ADDITIONS / DELETIONS 三个总数走 GraphQL，必须有 Worker 上的 `GITHUB_TOKEN`，没有就显示「—」；这三个数不能由名单加总得出，因为 `Co-authored-by` 的提交在贡献口径下会按人各记一遍。增删行要翻整条提交历史，结果以 `github-repo:churn` 锚在当前 HEAD 上存 30 天，之后每轮只补新增的那几条。

迁移后从 Vercel 移除 `REDIS_URL`、R2 写入凭据及旧推送地址；保留 `TELEMETRY_INGEST_SECRET` 用于缓存通知。环境变量删除不影响已有部署的环境快照，必须在清理后通过 Git 生成新部署。删除项目变量不等于撤销原始凭据，源 Redis 可在回退观察期继续保留。

## 验证与发布

1. `pnpm test`、`pnpm typecheck`、`pnpm exec tsc --noEmit -p workers/api/tsconfig.json`。
2. `node scripts/verify-api-worker.mjs` 启动隔离 SQLite 和模拟缓存通知服务器，验证鉴权、CORS、直接查询、WebSocket、心跳无失效、并发合并及重启持久化。
3. `NEXT_PUBLIC_BACKEND_URL=<测试 Worker 源> pnpm build`；在小号仓库和小号 Vercel 验证静态首页、缓存后台刷新以及浏览器网络路径。
4. 测试 Worker 用 `wrangler.test.toml`，独立对象命名空间，无生产域名或 cron。fork 的生产 Worker workflow 有仓库身份限制。
5. 测试通过后才合并主分支。生产采用 Git 自动部署，不手动发布 Vercel。腾讯云 EdgeOne 已退役，Vercel 提供源站，ESA 加速 `lyjw131.com`。缓存通知改动还需核验 ESA 刷新任务与域名响应。

## 生产导入顺序

新 StateHub 未初始化时拒绝上报和查询（503），避免空库被当成有效状态。保留源 Redis，暂停旧写侧后等待在途请求完成，运行 `scripts/migrate-state-storage.mjs --export <私有文件>`。导出文件含凭据，权限为 0600，不提交、不输出值。

给目标 Worker 临时设置独立 `STATE_IMPORT_SECRET`，配置 `STATE_SERVICE_URL`、`STORAGE_PREFIX` 后运行 `--import <私有文件>`，分批幂等导入、最后标记初始化完成。空的独立测试环境可用 `--initialize`。验证历史、新上报、实时响应和 HTML 后，移除导入密钥并清理临时文件。

部署前保留旧版本和源 Redis 作为回退点。切换失败时回退 Worker 和 Vercel 到同一套旧版本；测试阶段不触碰源数据或生产路由。迁移过程需覆盖从暂停写入到激活新对象的短暂重试窗口。
