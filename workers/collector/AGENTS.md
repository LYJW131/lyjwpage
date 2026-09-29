# workers/collector（采集 Worker）

站点所有定时的外部拉取都在这里：cron 每分钟响一次，按 `src/registry.ts` 挑出这一分钟到期的任务并行跑，一个失败不连累别的。任务表、PlayStation 的门与退避、`COLLECTOR_KV` 的键在 `README.md`，这里只写不变量、坑和须成对修改的文件。

## 不变量

- 只展示的结果直接写可滞后层 KV，**成功才写**：KV 里的值本身就是上次成功值，不另存 last-good；失败时旧值原样留着，过没过时由浏览器按各卡阈值判断。状态核心要拿来算的（PlayStation、最近在听）经 `CORE`（`api` 的 `StateCore`）交付。
- 缺令牌的任务干净地跳过，不算故障（监控照常报 ok）；没配是配置状态，不是失败。
- 一次调用同时只能有 6 个连接在等响应头：同一分钟到期的任务一起开跑，会把 PlayStation 门那 2.5 秒的人头数请求挤超时，所以带 `headStart` 的 PlayStation 先跑（`src/registry.ts#HEAD_START_MS`）。新增任务时想想会不会在同一分钟大量并发出网。
- 预览与非生产分支构建关闭：`CORE` 指向生产 `api`，预览版一跑就会往生产状态里写。
- 新增 `StateCore` 方法先发布 `workers/api`，再发布本 Worker；契约只加不改（`shared/state-core.ts`、`shared/collector.ts`）。
- D1 表结构归 `workers/api/migrations`：新表先在 api 那边 `pnpm --dir workers/api exec wrangler d1 migrations apply lyjwpage-history --remote`，再发布本 Worker。
- `src/lib/cache` 在这里背后是 KV（`src/storage-driver.ts`）：TTL 最短 60 秒，`ifAbsent` 先读后写、不是原子的，KV 读还有最长 60 秒的边缘缓存，两分钟以内要读回的东西不走它；列表、哈希操作直接抛错。
- PSN 的 refresh token 每次续期都会轮换：同一个账号不能有两处同时在跑（手动触发也走同一道门）；重新生成 NPSSO 会作废上一串，也不要从 PlayStation 网站登出。
- 手动触发（`Collector.refresh`、本地调试入口）不向 Sentry 报到；cron 监控名额不够，`collector-<任务>` 监控是停用的，任务真失败靠 `src/sentry.ts#reportJobFailure` 开 issue（tag `collector.job`）。

## 须成对修改

- PlayStation 的闲时间隔 `workers/collector/src/playstation/index.ts#IDLE_TICK_INTERVAL_MS` ⇄ 站点断流窗口 `src/lib/freshness.ts#PLAYSTATION_STALE_MS`：改闲时间隔要同步改那边。
- 新增或改节奏的任务 ⇄ `src/lib/status-views.ts` 里对应视图的 `cadenceMs`，浏览器据此在下一次预期写入之后去取。
- `shared/collector.ts`（`Collector.refresh` 的契约）⇄ `workers/ingress/src/worker.ts` 的部署通知，后者点名重拉部署列表。

## 本地开发与验证

- `pnpm dev:worker`（仓库根）起整套四个 Worker；`curl -X POST 'localhost:8788/__dev/collector/run?job=<任务>'` 立刻跑一个任务，`curl localhost:8788/cdn-cgi/local/scheduled` 当作 cron 响一次。调试入口只在 `DEV_TRIGGERS=true`（只配在 `wrangler.test.toml`）时存在；本地没有 cron、没有 D1，`PS_DRY_RUN=true`，令牌放 `workers/collector/.dev.vars`，不放的任务跳过。
- 验证：`pnpm --dir workers/collector typecheck`、`pnpm --dir workers/collector test`。
