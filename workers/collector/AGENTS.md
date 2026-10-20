# workers/collector（采集 Worker）

站点所有定时的外部拉取都在这里：cron 每分钟响一次，按 `src/registry.ts` 挑出这一分钟到期的任务并行跑，一个失败不连累别的。Apple Music 的按需查询、MusicKit 令牌与「正在听」的补全也在这里，由 site 与上报入口经 Service Binding 调用。任务表、`COLLECTOR_KV` 的键与 Apple Music 的说明在 `README.md`，这里只写不变量、坑和须成对修改的文件。

## 不变量

- 只展示的结果直接写可滞后层 KV，**成功才写**：KV 里的值本身就是上次成功值，不另存 last-good；失败时旧值原样留着（github-repo 统计全丢时最近提交仍并进的例外见 `README.md`「任务」），过没过时由浏览器按各卡阈值判断。状态核心要拿来算的（最近在听）经 `CORE`（`core` 的 `StateCore`）交付。
- 缺令牌的任务干净地跳过，不算故障（不记 error）；没配是配置状态，不是失败。
- 一次调用同时只能有 6 个连接在等响应头。带 `headStart` 的任务先跑（`src/registry.ts#HEAD_START_MS`）；`uptime-probe` 靠它免得排队时间算进探测超时。新增任务时想想会不会在同一分钟大量并发出网。
- core 不挂 cron，它的定时一轮（pulse 归档、评分、断流告警、心跳）靠本 Worker 每分钟调 `CORE.cronRound`（`src/core-round.ts`）；这一调用停了，那些就全停，站点的 Core 在线行也跟着断。
- 预览与非生产分支构建关闭：`CORE` 指向生产 `core`，预览版一跑就会往生产状态里写。
- 新增 `StateCore` 方法先发布 `workers/core`，再发布本 Worker；`DIGEST`（ai 的 `Digest`）同理先发布 `workers/ai`。契约只加不改（`shared/state-core.ts`、`shared/collector.ts`、`shared/digest.ts`）。
- D1 表结构归 `workers/core/migrations`：新表先在 core 那边 `pnpm --dir workers/core exec wrangler d1 migrations apply lyjwpage-history --remote -c wrangler.toml`，再发布本 Worker。奖杯表由 core 写（`workers/core/src/stores/trophy-history.ts#archiveTrophies`），这里写 `site_deploys` 与 `health_buckets`（后者 core 的定时一轮也写心跳）。
- `shared/cache` 在这里背后是 KV（`src/storage-driver.ts`，由 `src/ports.ts` 装上）：TTL 最短 60 秒，KV 读还有最长 60 秒的边缘缓存，两分钟以内要读回的东西不走它；列表、哈希操作直接抛错。
- Workers Caching 只开在 `AppleLookups` 上（`wrangler.toml#exports`），默认入口和 `Collector` 不开：方法、来源和 CORS 头在默认入口（`src/apple-music-http.ts`）按每次请求判，经自绑定 `APPLE_LOOKUPS` 再进缓存层。缓存键只有 entrypoint、路径与查询串，`AppleLookups` 的响应不许带 CORS 头或随请求头变化的内容。
- 任务真失败只记一条 `console.error`，内容是 `{ event: "collector-job", job, status, detail, ms }` 的 JSON（`src/registry.ts#runJob`），盯防 routine 按这个结构查；已知外部故障（`outage: true`）同样的结构只记 warn。`uptime-probe` 只在定时轮次落库，手动触发（`Collector.refresh`、`/__dev/run`）不记，否则每格检查数对不上排定次数。

## 须成对修改

- 新增任务 ⇄ `shared/collector.ts#COLLECTOR_JOBS`（只加不改）与 `src/registry.ts`；退役任务只挪进 `RETIRED_COLLECTOR_JOBS`，不从契约删名字。`src/registry.test.ts` 核对两边全集相等（去掉退役的），不用类型断言或放宽测试绕过。
- 新增或改节奏的任务 ⇄ `shared/status-views.ts` 里对应视图的 `cadenceMs`，浏览器据此在下一次预期写入之后去取。
- `shared/collector.ts`（`Collector` 的 RPC 契约，只加不改）⇄ `workers/ingress/src/worker.ts`：部署通知点名重拉部署列表，手动跑采集按 `ACTIVE_COLLECTOR_JOBS` 逐个串行调 `refresh`，上报提交前后调补全。
- `shared/apple-music-paths.ts#APPLE_MUSIC_HTTP_PATHS` ⇄ 默认入口的分流（`src/index.ts`）与 `src/apple-music-http.ts`：加路径要同时决定它进不进缓存层。

## 本地开发与验证

- `pnpm dev:worker`（仓库根）起整套 Worker 栈（dev-router、core、ai、ingress、collector）；`curl -X POST 'localhost:8788/__dev/collector/run?job=<任务>'` 立刻跑一个任务，`curl localhost:8788/cdn-cgi/local/scheduled` 当作 cron 响一次。调试入口只在 `DEV_TRIGGERS=true`（只配在 `wrangler.test.toml`）时存在；本地没有 cron、没有 D1，令牌放 `workers/collector/.dev.vars`，不放的任务跳过。
- 验证：`pnpm --dir workers/collector typecheck`、`pnpm --dir workers/collector test`。
