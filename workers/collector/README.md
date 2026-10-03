# collector

采集 Worker：站点所有**定时的外部拉取**都在这里。cron 每分钟响一次，按登记表
（`src/registry.ts`）挑出这一分钟到期的任务并行跑，一个失败不连累别的。

结果分两个去向：

- **只展示、不参与计算的**直接写可滞后层 KV（`LAG`，键表见 `shared/lag.ts`），每条带
  `updatedAt`。**成功才写**：KV 里的值本身就是上次成功值，失败时旧值原样留着，
  不另存 last-good；过没过时由浏览器按各卡片的阈值判断。
- **状态核心要拿来算的**（最近在听）经 Service Binding RPC 交给 api Worker
  的具名 entrypoint `StateCore`（binding `CORE`，契约见 `shared/state-core.ts`）：
  差分、推送、pulse 证据都在那边做。

另开一个具名 entrypoint `Collector`（契约见 `shared/collector.ts`）：同账号的 Worker 调
`refresh(jobs)` 就能点名立刻跑几个任务，比如上报入口（`workers/ingress`）收到站点部署通知后请它重拉
`vercel-deployments` 与 `cloudflare-deployments`。
没有路由、没有域名；生产上 `fetch` 一律 404。

## 任务

节奏在各任务 `Job` 的 `everyMinutes`（周期，整除 60）与 `offset`（周期里的第几分钟）：「第几分钟」按 UTC 时钟算，
`everyMinutes: 10, offset: 1` 就是 :01、:11、:21……任务全集是 `src/registry.ts` 的 `JOBS`，去向与需要的令牌如下。PlayStation 的拉取不在这张表里，在 `reporters/playstation-reporter`。

| 任务 | 去向 | 需要 |
| --- | --- | --- |
| `apple-recent` | `CORE.commitRecentlyPlayed(items)`；`CORE.commitRecentTracks(tracks)` | 凭据 KV 里的 user token；developer token 经 `CORE` 取 |
| `provider-status` | `LAG agent-status:v1`；灯色变了才 `CORE.revalidate(["agent-status"])` | 无 |
| `pagespeed` | `LAG pagespeed:v1`（滚动中位数） | `PAGESPEED_API_KEY` |
| `github-chart` | `LAG github-chart:v1` | `GITHUB_TOKEN` |
| `github-repo` | `LAG github-repo:v1` | `GITHUB_TOKEN` |
| `vercel-deployments` | `LAG vercel-deployments:v1`；每次部署另归档 D1 `site_deploys` | `VERCEL_TOKEN` |
| `vercel-metrics` | `LAG vercel-metrics:v1`（函数、访问两组各带采集时刻） | `VERCEL_TOKEN` |
| `cloudflare-deployments` | `LAG cloudflare-deployments:v1`（按 Worker 名存） | `CLOUDFLARE_METRICS_TOKEN` |
| `cloudflare-metrics` | `LAG cloudflare-metrics:v1` | `CLOUDFLARE_METRICS_TOKEN` |
| `sentry-status` | `LAG sentry:v1`（没取到的块沿用上一份） | `SENTRY_API_TOKEN` |

每个任务有一条 Sentry cron 监控 `collector-<任务>`，报到节奏由 `src/schedule.ts` 的 `checkinCrontab` 按 `everyMinutes` / `offset` 算出，见下文「Sentry 监控」。

几条取数口径：

- **缺令牌就干净地跳过**：每个 isolate 每个任务只 `console.warn` 一次
  （`{"event":"collector-skip",…}`），监控照常报 ok —— 没配是配置状态，不是故障。
- **部分成功**：GitHub 仓库统计的名单和总数、Vercel 指标的两组、Sentry 的五路查询（合成四块，其中 `errors` 要站点、后端两路
  都取到才更新）都是各拉各的，这一轮没取到的那一部分沿用可滞后层里上一份的（带着它原来的采集时刻）；全都没取到才算失败、不写。
  Sentry 各块取到的时刻记在 `blockAt`，卡片按它判过期（`SENTRY_STALE_MS`）；沿用最多 `SENTRY_BLOCK_CARRY_MS`，再旧那一块才回到「没有」。
  Cloudflare 部署逐个 Worker 查，单个查不到只空那一格（某个 Worker 还没部署时就是这样），
  全部查不到才算失败。
- **厂商状态**已登记的各家（`src/lib/agent-status-parse.ts` 的 `FALLBACK`）各自降级：某一家失败沿用上一轮那一行并标 `stale`；
  全部失败是这边出不去，整轮抛错、不写，监控报 error。上一轮是 KV 里那份，同一 isolate 里自己上一轮写的更新时用它
  （KV 读可能落后一分钟）。
- **同一响里的出站**：一次调用同时只能有 6 个连接在等响应头。带 `headStart` 的任务先跑一阵
  （`src/registry.ts` 的 `HEAD_START_MS`，或先跑完），其余再开跑。目前没有任务设置它。
- **PageSpeed** 桌面、移动并行测，单端通常二三十秒，偶尔长尾到一分钟以上，所以单端等到 `PAGESPEED_TIMEOUT_MS`
  才放弃，合成一个样本并进滚动窗口（窗口与样本上限见 `src/lib/pagespeed.ts` 的 `WINDOW_MS`、`MAX_SAMPLES`），样本窗口存在 `COLLECTOR_KV`。
  密钥只进查询参数，日志里只有状态码。任一端失败这一轮就空过，可滞后层沿用上一份。
- **最近在听**：user token 只能来自 Mac 上报器，凭据 KV 里还没有就跳过；developer token 由
  状态核心签（私钥只在 api 上），本 isolate 缓存到离到期 `RENEW_BEFORE_MS`。封面、时长的缓存经 `src/lib/cache`
  存在 `COLLECTOR_KV`（期限见 `apple-recent.ts` 的 `LIBRARY_ARTWORK_TTL_MS`、`DURATION_TTL_MS`），稳定状态下一轮只有拉两份列表出网。
  节奏分两档：任务每分钟排期，闲时只在整 `IDLE_EVERY_MINUTES` 分钟真去拉；任一份列表变了就记下时刻（`COLLECTOR_KV`），
  之后 `ACTIVE_HOLD_MS` 内每分钟都拉，并在同一响里接着每 `ACTIVE_POLL_MS` 再拉一次单曲列表（专辑列表仍是一响一次），
  最后一次在本响的 `ACTIVE_FOLLOW_MS` 内开始，不和下一响叠在一起。换歌最多晚一个 `ACTIVE_POLL_MS` 被看见，窗口也窄到这么宽；
  `commitRecentTracks` 回执里的 `nextBy`（照推断接着放、下一首最晚上榜的时刻）早于下一次拉时，提前到那一刻拉，接着放的下一首一上榜就被看见。
  接着拉的某一次失败只记一条 warn（`apple-recent-follow`）并停在这一响，持续的故障由下一响的头一次报出来。手动 `refresh` 只拉一次，不受闲档限制。

### Sentry 监控

每个任务一条 cron 监控，slug `collector-<任务>`，设置随报到同步（`src/schedule.ts`）：
连续两次 error 或漏报开 issue，一次恢复就关，时区 UTC。周期不短于 `MIN_CHECKIN_MINUTES` 的每轮都报到；
更短的只在「既是它的一轮、又是 `MIN_CHECKIN_MINUTES` 的倍数分钟」那几轮报（`checkinEveryMinutes`），否则那一格它根本不跑，
会被记成漏报。报到的开始、结束各是一次请求，分钟级的任务每轮都报太费。

手动触发（`Collector.refresh`、本地调试入口）不报到。

**名额**：组织的 cron 监控名额只有一个（见 [仓库外事实](../../docs/ops-facts.md)），给了 api 的 `api-minute-cron`；这些 `collector-<任务>` 监控是报到时自动建出来的，
超出名额所以都是停用状态，报到被 Sentry 丢弃。加了名额之后在 Sentry 的 Crons 页启用即可，代码不用动。
另一路：任务真失败（已知的外部故障除外）会直接开一个 Sentry issue，
按任务分组（fingerprint `collector-job` + 任务名，tag `collector.job`），同一任务在一个 isolate 里最多隔 `REPORT_EVERY_MS` 报一次
（`src/sentry.ts` 的 `reportJobFailure`）。

## COLLECTOR_KV 的键

命名空间由 `wrangler.toml` 的 `COLLECTOR_KV` 绑定（ID 也记在 [仓库外事实](../../docs/ops-facts.md)）。
里面是 `src/lib/cache` 的键。

| 键 | 内容 |
| --- | --- |
| `lyjwpage:cache:*` | `src/lib/cache` 的键：Apple 封面 `apple-music:library-art:v1:*`、时长 `apple-music:duration:v1:*`、GitHub 增删行的锚 `github-repo:churn`、PageSpeed 样本窗口 `pagespeed:history:v1:*` |

`src/lib/cache` 在这里背后是 KV（`src/storage-driver.ts`）：TTL 最短 60 秒（5 秒的负缓存会活满一分钟），
`ifAbsent` 是先读后写、不是原子的，也不是锁（同一任务可能被 cron 与 `Collector.refresh` 同时触发，别拿它当互斥），KV 的读还有最长 60 秒的边缘缓存 ——
两分钟以内要读回的东西不走它。列表、哈希操作直接抛错。

## 配置

变量在 `wrangler.toml` 的 `[vars]`。Secret（`wrangler secret put`，缺哪个跳过哪个任务）：

| Secret | 用途 |
| --- | --- |
| `GITHUB_TOKEN` | classic PAT：贡献日历（GraphQL）、仓库统计 |
| `VERCEL_TOKEN` | 团队范围：部署列表、函数与访问统计（只读用） |
| `CLOUDFLARE_METRICS_TOKEN` | 账号分析、Workers 脚本与构建读取 |
| `SENTRY_API_TOKEN` | Sentry 组织只读：`org:read` / `project:read` / `event:read` |
| `PAGESPEED_API_KEY` | Google PageSpeed Insights |

Apple Music 不在这里配：user token 读共享凭据 KV（`CREDENTIALS`，Mac 上报器推来的），
developer token 经 `CORE.appleDeveloperToken()` 由 api 签。

绑定：`COLLECTOR_KV`、`LAG`、`CREDENTIALS` 三个 KV，`CORE`（`api` 的 `StateCore`），D1 `HISTORY`
（`lyjwpage-history`）。D1 表结构归 `workers/api/migrations` 管：新表先在 api 那边
`pnpm --dir workers/api exec wrangler d1 migrations apply lyjwpage-history --remote`，再发布本 Worker。
Sentry 项目 `collector-worker`，DSN 写在 `[vars]`，release 取 `CF_VERSION_METADATA`。

## 部署

推到 `main` 由 Cloudflare Workers Builds 原生 Git 集成部署（根目录 `/`，配置与监视路径见
[原生部署配置](../../docs/workers-builds.md)）；不开分支预览：预览版的 `CORE` 会调到生产的 api。

新增 `StateCore` 方法时先发布 api，再发布这里；两边独立构建。

## 本地开发

根目录 `pnpm dev:worker` 以多配置方式起四个 Worker（配置清单见根 `package.json` 的 `dev:worker`）：`workers/dev-router`（拿端口，按路径分发）、
api、上报入口，和这里的 `wrangler.test.toml`。本地没有 cron、没有 D1（归档那一步跳过），
三个 KV 都是本地的（`LAG`、`CREDENTIALS` 和 api 共用同一个本地 id）。
令牌照需要放 `workers/collector/.dev.vars`（照 `.dev.vars.example`），不放的任务直接跳过。

```sh
curl -X POST 'localhost:8788/__dev/collector/run?job=provider-status'     # 立刻跑一个任务，返回结果
curl 'localhost:8788/__dev/collector/refresh?jobs=github-chart,sentry-status'  # 经 Collector RPC 点名跑
curl localhost:8788/cdn-cgi/local/scheduled                                  # 当作 cron 响了一次：跑这一分钟到期的任务
```

调试入口只在 `DEV_TRIGGERS=true` 时存在（只配在 `wrangler.test.toml`）。

## 验证

```sh
pnpm --dir workers/collector typecheck
pnpm --dir workers/collector test
```

单测覆盖节奏与报到、KV 存储驱动（含 `src/lib/cache` 跑在它上面）、D1 `site_deploys` 的 upsert
（真实 SQLite 跑 api 的全部迁移）、厂商状态变了才失效首屏，以及几处部分成功的合并口径。
