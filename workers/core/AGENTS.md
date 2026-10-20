# workers/core（状态核心）

StateHub 的 SQLite 是实时状态的唯一权威。人读的说明在 `README.md`，这里只写不变量、坑和须成对修改的文件。

## 不变量

- 上报器不直连这里：外部上报由 `workers/ingress` 验明身份、校验后，实时那一半经 Service Binding 调 `StateCore.commitIngest`；采集 Worker 同样经 `StateCore` 交数据。这里没有 `/api/ingest/*`。
- `StateCore` 的 RPC 契约是 `shared/state-core.ts`：只加不改；新增方法先发布本 Worker，再让 `workers/ingress`、`workers/collector` 去调。
- 本 Worker 不挂 Cloudflare cron（`wrangler.toml` 的 `crons = []`）：定时一轮由采集 Worker 每分钟调 `StateCore.cronRound` 驱动，加回 cron 会每轮跑两次。
- 从 `shared/ingest/` 只能 `import type`（源：`eslint.config.mjs#no-restricted-imports`）：校验与收敛在上报入口，改校验不该重新发布带 Durable Object 的本 Worker，Workers Builds 监视路径据此排除该目录。命令形状变了（新字段、新模块）要同时改 `src/stores/` 里提交那一半。
- `LivePushRoom` 只通过 `src/live-platform.ts#liveRoom` 取：`locationHint` 只在对象首次创建时生效，换位置只能换 `ROOM_ID`（旧对象不会搬家也不会删）；房间只有连接、不存数据，换名无数据要迁。
- 提交持久化确认后才返回 202；推送、首屏失效在 `waitUntil` 里做，失败只记日志，不让已落库的上报重发。
- core 不请求 Apple、不持有 Apple 私钥：「正在听」的补全（目录、动态封面）由采集 Worker 在上报提交前查好，命令带着 `enrichment` 进来就原样提交；回执后的预热与重查也归采集 Worker，重查结果经 `StateCore.commitEnrichmentPatch` 交给 `StateHub.commitEnrichmentPatch` 按 `trackKey` 补写。读取和推送只读存好的补全。`StateCore.appleDeveloperToken()` 留在只加不改的契约里、恒抛错，不在这里重新签令牌或加回 Apple 绑定。
- 公开读取只输出明确的公开模型：没有通用 HTTP 数据库端点，凭据不进任何公开响应。可滞后层的 loader 在 `shared/lag-views.ts#LAG_VIEW_LOADERS`，site Worker 直接调同一份读 `LAG` KV：只读 KV，不持有外部令牌、不现拉、不推送，也不过公开读屏障、不唤醒 StateHub（`src/public-execution.ts`），不许读 DO 存储（site 没有 DO）。两边回的信封逐字一致由 `src/lag-parity.test.ts` 守着。
- 首屏标签只在布局变化时失效（判据在 `shared/home-layout.ts`）；读数、标题、进度、纯心跳都不触发，交给首屏快照的定时重建。
- 新增公开状态视图只在 `shared/status-views.ts` 加一行、在 `shared/status-payloads.ts` 写载荷类型、在 `src/status-loaders.ts` 登记 loader（可滞后层的 loader 写进 `shared/lag-views.ts#LAG_VIEW_LOADERS`，这里引用它），几张表由 `satisfies` 对齐；可滞后层视图不许带推送事件（模块加载时断言）。
- `PublicStatus` 只接受 `shared/status-views.ts#STATUS_VIEWS` 中的精确路径，契约为 `shared/public-status.ts`；不开放参数查询、凭据、写入或通用存储接口。AI 只能经这个入口读公开状态。
- `shared/ai-paths.ts#AI_HTTP_PATHS` 中的 HTTP 请求经 `AI_SERVICE` 原样转发给 AI Worker；不要在 core 重建聊天、配额或 MCP 逻辑。Pulse 的 Coding 评估与租约仍属于本 Worker 和 StateHub。

## 迁移与部署

- Durable Object 迁移只追加新 tag、不改旧的；`v1-transfer-from-api` 把旧 `api` Worker 的 SQLite 命名空间整体转移（ID 与数据不变），不要对这些类另加创建或删除迁移。
- 分支预览走组合入口，Preview 的空库迁移由 `scripts/preview-migrations.mjs#previewMigrations` 把转移折成新建，并带上 ai 的类；不连接生产 Service Binding，配置只在 `docs/workers-builds.md` 维护。
- D1 表结构只在 `migrations/` 里建。Workers Builds 不跑迁移：部署带 `HISTORY` 绑定的版本之前，先 `pnpm --dir workers/core exec wrangler d1 migrations apply lyjwpage-history --remote -c wrangler.toml`；采集 Worker、上报入口要写的新表也先在这里 apply。
- 生产的 `wrangler.toml` 不配 `UPSTREAM_API_URL`（只在本地 `.dev.vars` 与 `[previews.vars]` 里出现）。本地用 `wrangler.test.toml`：生产配置里的转移迁移在空环境起不来，测试配置有从头开始的迁移链。
- 监视路径不放宽，否则无关的 `main` 提交也会重新发布生产版本；`dev-fixtures/` 在监视路径里，改夹具会触发一次同码重建。

## 须成对修改

- ai 新增 Durable Object 类：同时加进 `scripts/preview-migrations.mjs#PREVIEW_ONLY_CLASSES`、`src/preview-entry.ts` 的导出和本目录 `wrangler.toml` 的 `[[previews.durable_objects.bindings]]`，组合 Preview 才建得出来。
- 浏览器与 Worker 共用 `shared/live-heartbeat.ts#LIVE_HEARTBEAT_MS`；可见连接失活窗口从这个间隔推导。
- 改 Coding 评估的判据要升 `shared/pulse-assessment.ts#PULSE_ASSESSMENT_VERSION`（升版本会让最近 24 小时全部重评），先用 `scripts/clef-probe.mts` 试。
- 状态端点新增或改形：登记表 `shared/status-views.ts`、载荷类型表 `shared/status-payloads.ts`、loader 表 `src/status-loaders.ts`（可滞后层另有 `shared/lag-views.ts`）、站点读取侧 `src/lib/status-reads.ts`、首屏 `src/lib/first-screen.ts` 一起看，推送事件和端点含义保持一致；新增视图还要在 `workers/ai/src/tools/site-status.ts#VIEW_NOTES` 写一行说明，否则 ai 的类型检查失败。

## 本地开发与验证

- `pnpm dev:worker`（仓库根）用一个 `wrangler dev` 进程起 dev-router、core、ai、ingress、collector；本地名字须与 Service Binding 对齐。状态在 `.wrangler/dev-state`，空目录直接以空状态起，想清库就删它。
- 本地 core 绑了空 D1，只给 `limits/history` 读；建表与灌数的命令见 `README.md`「本地开发」。
- 本地是空库：`.dev.vars` 配 `UPSTREAM_API_URL` 后按端点整份兜底：生产 `ok:true` 的端点整份用生产的，已有端点的新字段本地看不到，要用 `pnpm dev:override` 注入（见 `README.md`「本地开发」）；测上报链路要把它注释掉。`DEV_OVERRIDES=true` 才开假数据注入端点，夹具里的时间戳用 `"$now"` 令牌（用法见 `pnpm dev:override --help`）；成套场景（`dev-fixtures/scenes/`）用 `pnpm dev:scene`，摘要三格由 `scripts/dev-scene.ts` 调 ai 的 `workers/ai/src/digest/` 同一份规则重算，改那里的规则或载荷形状时一并跑 `scripts/dev-scene.test.ts`。
- 验证：`pnpm --dir workers/core typecheck`、`pnpm --dir workers/core test`、`node scripts/verify-core-worker.mjs --build`（隔离链路，不碰生产绑定和凭据）。
- AI 转发链路的协议与真实 MCP 客户端验证见 `workers/ai/README.md`「MCP」，不能只验证 core 返回了 HTTP 200。
