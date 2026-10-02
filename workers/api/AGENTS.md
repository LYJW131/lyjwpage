# workers/api（状态核心）

StateHub 的 SQLite 是实时状态的唯一权威。人读的说明在 `README.md`，这里只写不变量、坑和须成对修改的文件。

## 不变量

- 上报器不直连这里：外部上报由 `workers/ingress` 验明身份、校验后，实时那一半经 Service Binding 调 `StateCore.commitIngest`；采集 Worker 同样经 `StateCore` 交数据。这里没有 `/api/ingest/*`。
- `StateCore` 的 RPC 契约是 `shared/state-core.ts`：只加不改；新增方法先发布本 Worker，再让 `workers/ingress`、`workers/collector` 去调。
- 从 `shared/ingest/` 只能 `import type`（源：`eslint.config.mjs#no-restricted-imports`）：校验与收敛在上报入口，改校验不该重新发布带 Durable Object 的本 Worker，Workers Builds 监视路径据此排除该目录。命令形状变了（新字段、新模块）要同时改 `src/stores/` 里提交那一半。
- `LivePushRoom` 只通过 `src/live-platform.ts#liveRoom` 取：`locationHint` 只在对象首次创建时生效，换位置只能换 `ROOM_ID`（旧对象不会搬家也不会删）；房间只存连接和 `audience` 标记，换名无数据要迁。
- 提交持久化确认后才返回 202；推送、首屏失效在 `waitUntil` 里做，失败只记日志，不让已落库的上报重发。
- 上报缺的外部信息（Apple 目录、动态封面、歌词预热）在 `StateCore` 交给 StateHub 之前补全，随状态落库（`src/listening-enrichment.ts`）；StateHub 里不请求网络，读取和推送只读存好的补全。只有 `/api/lyrics`、`/api/motion-artwork` 这两个按需端点允许现查 Apple。Apple 结果缓存在 `APPLE_CACHE` KV（`src/lib/apple-cache.ts`），不进 StateHub。
- 公开读取只输出明确的公开模型：没有通用 HTTP 数据库端点，凭据不进任何公开响应。可滞后层的端点只读 `LAG` KV，不持有外部令牌、不现拉、不推送，也不过公开读屏障、不唤醒 StateHub（`src/public-execution.ts`）：它的 loader 不许读 DO 存储。
- DO 算出、读时可滞后的视图走 KV 镜像（`src/lag-mirror.ts`）：待写标记必须和源视图同批提交，`flushLagMirrors` 只能在 `ingestTail` 串行队列里跑；加镜像只改 `MIRRORS`，构造时按 `LAG_MIRROR_SET` 补写一次。
- 没人在看时 StateHub 的 `commitIngest` 只回 `tags` 效果（`effectsForAudience`），状态由推送房间经 `noteAudience` 告知、缺省按有人；首屏失效不受此闸。绕过 `commitIngest` 的推送（`StateCore.broadcastVersion`、采集 Worker 的提交）不看这个状态。
- 首屏标签只在布局变化时失效（判据在 `src/lib/home-layout.ts`）；读数、标题、进度、纯心跳都不触发，交给首屏快照的定时重建。
- 新增公开状态视图只在 `src/lib/status-views.ts` 加一行、在 `src/lib/status-loaders.ts` 登记 loader，两张表由 `satisfies` 对齐；可滞后层视图不许带推送事件（模块加载时断言）。

## 迁移与部署

- Durable Object 迁移只追加新 tag、不改旧的；`v1-transfer-from-ingest` 把旧 Worker 的 SQLite 命名空间整体转移（ID 与数据不变），不要对这些类另加创建或删除迁移。
- D1 表结构只在 `migrations/` 里建。Workers Builds 不跑迁移：部署带 `HISTORY` 绑定的版本之前，先 `pnpm --dir workers/api exec wrangler d1 migrations apply lyjwpage-history --remote`；采集 Worker、上报入口要写的新表也先在这里 apply。
- 生产的 `wrangler.toml` 不配 `UPSTREAM_API_URL`（只在本地 `.dev.vars` 与 `[previews.vars]` 里出现）。本地用 `wrangler.test.toml`：生产配置里的 `deleted_classes` 迁移在空环境起不来，测试配置有从头开始的迁移链。
- 监视路径不放宽，否则无关的 `main` 提交也会重新发布生产版本；`dev-fixtures/` 在监视路径里，改夹具会触发一次同码重建。

## 须成对修改

- 浏览器与 Worker 共用 `shared/live-heartbeat.ts#LIVE_HEARTBEAT_MS`；可见连接失活窗口从这个间隔推导。
- 改 Coding 评估的判据要升 `shared/pulse-assessment.ts#PULSE_ASSESSMENT_VERSION`（升版本会让最近 24 小时全部重评），先用 `scripts/jev-probe.mts` 试。
- 状态端点新增或改形：登记表 `src/lib/status-views.ts`、loader 表 `src/lib/status-loaders.ts`、站点读取侧 `src/lib/status-reads.ts`、首屏 `src/lib/first-screen.ts` 一起看，推送事件和端点含义保持一致。

## 本地开发与验证

- `pnpm dev:worker`（仓库根）用一个 `wrangler dev` 进程起 dev-router、api、ingress、collector 四个 Worker；本地 api 的名字必须是 `api`，Service Binding 按生产名字互相找。`pnpm dev:worker:init` 只需一次，状态在 `.wrangler/dev-state`，想清库就删它再 init。
- 本地是空库：`.dev.vars` 配 `UPSTREAM_API_URL` 后生产为主、本地补缺；测上报链路要把它注释掉。`DEV_OVERRIDES=true` 才开假数据注入端点，夹具里的时间戳用 `"$now"` 令牌（用法见 `pnpm dev:override --help`）。
- 验证：`pnpm --dir workers/api typecheck`、`pnpm --dir workers/api test`、`node scripts/verify-api-worker.mjs --build`（隔离链路，不碰生产绑定和凭据）。
