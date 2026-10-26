# collector

采集 Worker：站点所有**定时的外部拉取**都在这里，Apple Music 的按需查询与「正在听」的补全也在这里（见下文「Apple Music」）。
cron 每分钟响一次，按登记表（`src/registry.ts`）挑出该跑的任务并行跑，一个失败不连累别的。每个任务按自己的周期分格（`src/schedule.ts#slotStart`，格从排定的那一分钟起），格内第一轮就跑，由 Durable Object `CronSlots`（`src/cron-slots.ts`，binding `CRON_SLOTS`）按任务认领、每格只跑一次：Cloudflare 晚投或漏投排定的那一分钟时，格内后面任一轮补上。认领调用失败时退回只跑正好到期的任务，记一条 `collector-slot-claim` warn；认领不设超时，免得超时后认领照样写进去、退回跑的任务和已认领的对不上。没绑定 `CRON_SLOTS`（本地 `wrangler.test.toml`）时不认领，只跑正好到期的任务。
同一次 cron 还调 core 的 `StateCore.cronRound`，传的是这一轮的时刻（`src/registry.ts#roundTime`，迟到时是收到的时刻）：core 不挂自己的 cron，由它把调用归进自己时刻表的一格、每格只跑一次（`src/core-round.ts`，失败只记 warn）。迟到的一轮（`src/registry.ts#isLateRound`，平台重投或晚投）记一条 `collector-late-round` warn，采集任务和 core 那一轮都改按收到的时刻跑（`src/registry.ts#roundTime`）：照旧 `scheduledTime` 跑会把 LAG 的 `updatedAt` 改回去，所以它只补得上到达时所在的格，重投的旧分钟早已认领过就不再重跑。

结果分两个去向：

- **只展示、不参与计算的**直接写可滞后层 KV（`LAG`，键表见 `shared/lag.ts`），每条带
  `updatedAt`。**成功才写**：KV 里的值本身就是上次成功值，失败时旧值原样留着，
  不另存 last-good；过没过时由浏览器按各卡片的阈值判断。
- **状态核心要拿来算的**（最近在听）经 Service Binding RPC 交给 core Worker
  的具名 entrypoint `StateCore`（binding `CORE`，契约见 `shared/state-core.ts`）：
  差分、推送、pulse 证据都在那边做。

另开一个具名 entrypoint `Collector`（契约见 `shared/collector.ts`）：同账号的 Worker 调
`refresh(jobs)` 就能点名立刻跑几个任务，比如上报入口（`workers/ingress`）收到站点部署通知后请它重拉
部署相关任务（`workers/ingress/src/worker.ts#DEPLOYMENT_JOBS`）；`enrichTrack`、`followUpTrack` 见「Apple Music」。
生产上要手动跑一遍全部任务（含 `digest`），走上报入口的 `POST /api/internal/collector-refresh`，或在 GitHub Actions
手动运行 `.github/workflows/collector-refresh.yml`，见[上报入口 README](../ingress/README.md#手动跑采集)。
没有路由、没有域名，只能经 Service Binding 调到；默认 `fetch` 只答 Apple Music 的三条路径（`shared/apple-music-paths.ts#APPLE_MUSIC_HTTP_PATHS`），
其余一律 404。

## 任务

节奏在各任务 `Job` 的 `everyMinutes`（周期，整除 60）与 `offset`（周期里的第几分钟）：「第几分钟」按 UTC 时钟算，
`everyMinutes: 10, offset: 1` 就是 :01、:11、:21……任务全集是 `src/registry.ts` 的 `JOBS`，去向与需要的令牌如下。PlayStation 的拉取不在这张表里，在 `reporters/playstation-reporter`。

| 任务 | 去向 | 需要 |
| --- | --- | --- |
| `apple-recent` | `CORE.commitRecentlyPlayed(items, container)`；`CORE.commitRecentTracks(tracks)` | 凭据 KV 里的 user token；`APPLE_MUSIC_PRIVATE_KEY` 与 `APPLE_MUSIC_TEAM_ID`、`APPLE_MUSIC_KEY_ID`（自签 developer token）；`APPLE_MUSIC_OWNER_NAME`（真名打码） |
| `provider-status` | `LAG agent-status:v1`；灯色变了才 `CORE.revalidate(["agent-status"])` | 无 |
| `pagespeed` | `LAG pagespeed:v1`（滚动中位数） | `PAGESPEED_API_KEY` |
| `github-chart` | `LAG github-chart:v1` | `GITHUB_TOKEN` |
| `github-repo` | `LAG github-repo:v1`（含首页「最近提交」读的 `recentCommits`；站点部署通知也会点名重拉）；提交列表变了才 `CORE.revalidate(["github-repo"])` | `GITHUB_TOKEN` |
| `site-deployments` | `LAG site-deployments:v1`；每次部署另归档 D1 `site_deploys` | `CLOUDFLARE_METRICS_TOKEN`；`CLOUDFLARE_ACCOUNT_ID`；`SITE_WORKER_TAG` |
| `site-analytics` | `LAG site-analytics:v1`（Cloudflare Web Analytics 两站 pageviews，截至采集时刻的滚动 7×24 小时窗） | `CLOUDFLARE_METRICS_TOKEN`；`CLOUDFLARE_ACCOUNT_ID`；`SITE_ANALYTICS_SITES` |
| `vercel-deployments` | 已退役：名字留在契约里，点名时回 `skipped`，不进定时轮次（`shared/collector.ts#RETIRED_COLLECTOR_JOBS`） | 无 |
| `vercel-metrics` | 已退役：同上 | 无 |
| `cloudflare-deployments` | `LAG cloudflare-deployments:v1`（按 Worker 名存） | `CLOUDFLARE_METRICS_TOKEN`；`CLOUDFLARE_ACCOUNT_ID` |
| `cloudflare-metrics` | `LAG cloudflare-metrics:v1` | `CLOUDFLARE_METRICS_TOKEN`；`CLOUDFLARE_ACCOUNT_ID` |
| `sentry-status` | 已退役：同上 | 无 |
| `uptime-probe` | 每分钟 GET `shared/health.ts#SITE_UPTIME_URL`，成败累进 D1 `health_buckets`（只有定时轮次记，手动点名不记） | D1 `HISTORY` |
| `site-health` | `LAG health:v1`：D1 里的在线探测与 core 心跳汇成 30 天每天一格，加上 Workers Observability 报错数与 Web Analytics 真实访客 Web Vitals（没取到的块沿用上一份）；顺带清掉超出 `HEALTH_RETENTION_MS` 的格子（每个序列保留期外总留最新一格） | D1 `HISTORY`；`CLOUDFLARE_METRICS_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`SITE_ANALYTICS_SITES`（缺了只空出报错与 Web Vitals，在线条照常） |
| `digest` | `DIGEST.compose`（ai 的 `Digest`，带上一份的输入哈希与标题）写成的近况摘要进 `LAG digest:v1`；输入没变时 ai 回 `unchanged`，这里照样重写一次刷新 `updatedAt`；第一次写出、或摘要与 `quiet`（时钟卡）互换时才 `CORE.revalidate(["digest"])` | 无（ai 回 `unconfigured` 时这里跳过） |
| `avatar-watch` | 不写状态：GitHub 头像的 sha256 与 main 上 `.github/github-avatar.sha256` 不一致时触发 `.github/workflows/avatar-sync.yml`，由它提交新哈希、触发站点重建；同一哈希在 `REDISPATCH_AFTER_MS` 内只触发一次 | `GITHUB_DISPATCH_TOKEN` |

任务失败怎么被看见见下文「失败」。

几条取数口径：

- **最近提交跟随默认分支**：允许强推后提交日期回退。`src/jobs/github-repo.ts#publish` 在采集期间观察到别的轮次改写提交列表时保留已发布列表，下一轮再与 GitHub 对齐；KV 的读写不是原子比较交换，不保证并发强一致。
- **缺令牌就干净地跳过**：每个 isolate 每个任务只 `console.warn` 一次
  （`{"event":"collector-skip",…}`），不记错误 —— 没配是配置状态，不是故障。
- **部分成功**：GitHub 仓库统计的名单和总数、健康汇总的四块（`uptime`、`heartbeat` 读 D1，`errors` 读遥测查询与 Issues 汇总，`vitals` 读 Web Analytics）
  都是各拉各的，这一轮没取到的那一部分沿用可滞后层里上一份的（带着它原来的采集时刻）。仓库统计整块取不到时，
  新拉到的最近提交照样并进上一份（`updatedAt` 留旧值，卡片照显统计过时），定时轮次仍记失败；健康四块全丢才算失败、不写。
  健康各块取到的时刻记在 `blockAt`，卡片按它判过期（`HEALTH_STALE_MS`）；沿用最多 `HEALTH_BLOCK_CARRY_MS`，再旧那一块才回到「没有」。
  报错数是遥测查询按 `$metadata.service` 分组的 error 级事件数，按采样率放大的估计值，并排除 `*.workers.dev` 上的分支预览（`shared/health-cloudflare.ts`）。
  Cloudflare 部署逐个 Worker 查，单个查不到只空那一格（某个 Worker 还没部署时就是这样），
  全部查不到才算失败。
- **Cloudflare 故障行**：首页 `cloudflare-outage-row.tsx` 在 `cloudflare` 行为 `major_outage` 时显示，持续时间读 `AgentStatusRow.outageSince`（`withOutageSince`：沿用上一轮，首次看到取活跃故障开始时间，再没有取采集时刻；恢复即清除）。
- **厂商状态**已登记的各家（`src/agent-status-parse.ts` 的 `FALLBACK`）各自降级：某一家失败沿用上一轮那一行并标 `stale`；
  全部失败是这边出不去，整轮抛错、不写，记成任务失败。上一轮是 KV 里那份，同一 isolate 里自己上一轮写的更新时用它
  （KV 读可能落后一分钟）。
- **同一响里的出站**：一次调用同时只能有 6 个连接在等响应头。带 `headStart` 的任务先跑一阵
  （`src/registry.ts` 的 `HEAD_START_MS`，或先跑完），其余再开跑。`uptime-probe` 设了它：排队等连接的时间也算进探测超时，会把站点误判成掉线。
- **PageSpeed** 桌面、移动并行测，单端常要一分钟上下，长尾更久，所以单端等到 `PAGESPEED_TIMEOUT_MS`
  才放弃，合成一个样本并进滚动窗口（窗口与样本上限见 `src/pagespeed.ts` 的 `WINDOW_MS`、`MAX_SAMPLES`），样本窗口存在 `COLLECTOR_KV`。
  密钥只进查询参数，日志里只有状态码。两端各算各的：一端失败，这一轮样本里那端为空，另一端照常进窗口并写可滞后层，
  另记一条 `status: "partial"` 的 warn；两端都失败才算任务失败、不写。窗口里某端一条样本都没有时也算任务失败：样本照存、可滞后层不写。
  轮次上限截不掉某端在窗口里仅剩的那条。结果的 `fetchedAt` 与可滞后层的写入时刻都取两端最近一次实测里较旧的那个，
  一端一直测不出时卡片和 freshness-watch 照样按它判过期。
- **最近在听**：user token 只能来自 Mac 上报器，凭据 KV 里还没有就跳过；developer token 由本 Worker 自签
  （`shared/musickit-token.ts#issueApiDeveloperToken`，同一 isolate 里过了签发到期的中点才重签），签名配置缺了也跳过。
  列表首项的动态封面在这里查好再交给状态核心（`shared/track-enrichment.ts#enrichRecentlyPlayed`），查不出结果时
  `motion` 留 `undefined`，状态核心沿用同一项已存的那份。封面、时长的缓存经 `shared/cache`
  存在 `COLLECTOR_KV`（期限见 `apple-recent.ts` 的 `LIBRARY_ARTWORK_TTL_MS`、`CONTAINER_TTL_MS`），稳定状态下一轮只有拉两份列表出网。
  节奏分两档：任务每分钟排期，闲时只在整 `IDLE_EVERY_MINUTES` 分钟真去拉；任一份列表变了就记下时刻（`COLLECTOR_KV`），
  之后 `ACTIVE_HOLD_MS` 内每分钟都拉，并在同一响里接着每 `ACTIVE_POLL_MS` 再拉一次单曲列表（专辑列表仍是一响一次），
  最后一次在本响的 `ACTIVE_FOLLOW_MS` 内开始，不和下一响叠在一起。换歌最多晚一个 `ACTIVE_POLL_MS` 被看见，窗口也窄到这么宽；
  `commitRecentTracks` 回执里的 `nextBy`（照推断接着放、下一首最晚上榜的时刻）早于下一次拉时，提前到那一刻拉，接着放的下一首一上榜就被看见。
  接着拉的某一次失败只记一条 warn（`apple-recent-follow`）并停在这一响，持续的故障由下一响的头一次报出来。手动 `refresh` 只拉一次，不受闲档限制。

### 失败

任务真失败（已知的外部故障除外）由 `src/registry.ts#runJob` 记一条 error 级的 JSON 日志 `{ event: "collector-job", job, status, detail, ms }`，进 Workers Issues，盯防 routine 也按它查；
带 `outage: true` 的已知外部故障记同样结构的 warn。没有逐任务的 cron 报到：漏跑本身看不出来，只有 core 心跳与在线探测按排定次数算漏跑。

## Apple Music

站点域名上的三条路径由 site Worker 经 `COLLECTOR_SERVICE` 原样转来（`src/lib/site-policy.ts#classifyGatewayRequest`），
首屏那首的歌词也从这里取；上报入口在提交前调 `enrichTrack`、收下之后调 `followUpTrack`（见 [ingress README](../ingress/README.md#拆分)）。

- **按需查询**：`/api/lyrics`、`/api/motion-artwork`（实现在 `shared/apple-lookups.ts`）在具名 entrypoint `AppleLookups` 里跑，
  它开了 Workers Caching（`wrangler.toml` 的 `[exports.AppleLookups.cache]`）：按 entrypoint、路径与查询串缓存，不分主机名，
  每次部署从空缓存开始，期限按响应的 `Cache-Control`（出错的响应是 `no-store`，不进缓存）。默认 `fetch` 是挡在它前面的一层，
  预检、方法、来源判断和 CORS 头每次按这次请求现做（`src/apple-music-http.ts`），再经 `APPLE_LOOKUPS` 调 `AppleLookups`，
  所以缓存里的响应不带 CORS 头。
- **`/api/musickit/token`**：给网页播放器按来源签 MusicKit token（`shared/musickit-token.ts#issueMusicKitToken`），
  由默认 `fetch` 直接回、不进缓存，规则见下文「MusicKit 令牌」。
- **写入时补全**：`Collector.enrichTrack(music, upcomingTracks)` 查当前曲目与队列里接下来几首（`shared/playing-queue.ts#PRELOAD_AHEAD`）的目录、当前曲目的动态封面，每段各自限时
  （`shared/track-enrichment.ts` 的 `WRITE_BUDGET`），目录与队列并行、动态封面排在目录之后；某段失败或超时只丢那一段、
  打一条带阶段与曲目的 `[enrichment]` warn，记为未知，不抛错。`Collector.followUpTrack(followUp)` 立即返回，
  在 `waitUntil` 里预热歌词，写入时有段没查出的在新的请求状态里按 `RETRY_BUDGET` 整份重查一次（`shared/track-enrichment.ts#followUpEnrichment`），
  查到更多就经 `CORE.commitEnrichmentPatch` 补写（按块合并，见 `shared/track-enrichment.ts#mergeEnrichment`）。
- Apple 的结果缓存在 `APPLE_CACHE` KV（`shared/apple-cache.ts`）：键以 `STORAGE_PREFIX` 开头，查询按 `APPLE_MUSIC_STOREFRONT` 的店面。

### MusicKit 令牌

访客用自己的 Apple Music 订阅跟听之前，先得有一份 developer token 才能把 MusicKit JS 配起来。
这份令牌发给**任何一个访客**，和凭据 KV 里 Mac 上报的那份私人凭据（带 music user token）
不是一回事、不共用路径。

`ALLOWED_ORIGINS` 一份名单，两道限制：

1. **谁能来要令牌** —— 比请求的来源：带 `Origin` 头就看它；浏览器的同源 GET 不带 `Origin`，
   只带 `Sec-Fetch-Site: same-origin`，这时按请求自己的源算（`shared/http-origins.ts#requestOrigin`，
   经站点 Service Binding 转来的请求 URL 仍是站点的源）。配了名单之后两样都没有的一律拒绝。这道只是让
   「拿一份」不那么随手，这两个头非浏览器都伪造得了。
2. **令牌只在这些域上有效** —— 名单里写死的域签进 JWT 的 `origin` 声明，由 Apple 校验。
   通配项（`https://*.lyjw.workers.dev`）Apple 不解析，匹配到的预览域名和 localhost **只签它自己一个**，
   不把生产域名一起捎上；否则任何人带一句 `Origin: http://localhost:3000` 就能要走一份在
   `lyjw.me` 上可用的令牌。

同一份 origin 声明的令牌在 isolate 里复用，过了「签发 → 到期」的中点才重签；`issuedAt` 和
`expiresAt` 一起给，站点用同一条半衰期规则决定何时再要。响应一律 `Cache-Control: no-store`。
出错时 `{ "error": "..." }`：403 来源不对、405 方法不对、500 变量没配或私钥坏（只有自己写死
的配置提示外带，运行时异常只进日志）。

私钥与两个 ID 来自 [Apple Developer](https://developer.apple.com/account/resources/authkeys/list) 勾了
**MusicKit** 的密钥（放哪见下文「配置」）；`APPLE_MUSIC_PRIVATE_KEY` 是 `.p8` 全文，带不带 PEM 头尾、换行是真的还是 `\n` 都吃。
有效期 `MUSICKIT_TOKEN_TTL_SECONDS` 不填按 `DEFAULT_TTL_SECONDS`，上限 `MAX_TTL_SECONDS`（Apple 允许的最长期限）；不取上限是因为令牌一旦被复制走，
域名限制之外就只剩有效期这一道闸。

## COLLECTOR_KV 的键

命名空间由 `wrangler.toml` 的 `COLLECTOR_KV` 绑定（ID 也记在 [仓库外事实](../../docs/ops-facts.md)）。
里面是 `shared/cache` 的键。

| 键 | 内容 |
| --- | --- |
| `lyjwpage:cache:*` | `shared/cache` 的键：Apple 封面 `apple-music:library-art:v1:*`、容器曲目与时长 `apple-music:container-tracks:v2:*`、GitHub 增删行的锚 `github-repo:churn`、PageSpeed 样本窗口 `pagespeed:history:v1:*`、已触发过的头像哈希 `avatar-watch:dispatched:v1`、apple-recent 活跃档的最近变化时刻 `apple-recent:last-change`、失败短负缓存 `neg:*` |

`shared/cache` 在这里背后是 KV（`src/storage-driver.ts`，由 `src/ports.ts` 装上）：TTL 最短 60 秒（5 秒的负缓存会活满一分钟），KV 的读还有最长 60 秒的边缘缓存 ——
两分钟以内要读回的东西不走它。列表、哈希操作直接抛错。

## 配置

变量在 `wrangler.toml` 的 `[vars]`。Secret（`wrangler secret put`，缺哪个跳过哪个任务）：

| Secret | 用途 |
| --- | --- |
| `GITHUB_TOKEN` | classic PAT：贡献日历（GraphQL）、仓库统计与最近提交（REST + GraphQL 取协作者） |
| `GITHUB_DISPATCH_TOKEN` | fine-grained PAT，只授权 `LYJW131/lyjwpage`：Actions 读写（触发 `avatar-sync.yml`）、Contents 只读（读标记文件） |
| `CLOUDFLARE_METRICS_TOKEN` | 账号分析、Workers 脚本与构建读取；健康汇总另要 Workers Observability 写（遥测查询接口只认写权限） |
| `PAGESPEED_API_KEY` | Google PageSpeed Insights |
| `APPLE_MUSIC_PRIVATE_KEY` | Apple Music 开发者私钥（`.p8`）：签服务端调 Apple 用的 developer token 和给网页播放器的 MusicKit token；缺了 `apple-recent` 跳过，令牌路由回 500 |
| `APPLE_MUSIC_OWNER_NAME` | Apple ID 上的真名：`apple-recent` 出站前把它（含 URL 编码形式）换成 `src/jobs/apple-recent.ts#OWNER_ALIAS`，自己的歌单、音乐回忆署名与个人电台标题不露真名；缺了 `apple-recent` 跳过，宁可不更新也不漏 |

`SITE_WORKER_TAG`（site Worker 的 Builds tag）与 `SITE_ANALYTICS_SITES`（JSON：`{"lyjw.me":"<site_tag>","lyjw131.com":"<site_tag>"}`，两站缺一不可）是 `[vars]` 配置；缺哪个跳过哪个任务，不算故障。

Apple Music 的 user token 读共享凭据 KV（`CREDENTIALS`，Mac 上报器推来的）；`APPLE_MUSIC_TEAM_ID`、`APPLE_MUSIC_KEY_ID`、
`ALLOWED_ORIGINS`（MusicKit token 按它签 origin 声明）在 `[vars]`。

绑定：`COLLECTOR_KV`、`LAG`、`CREDENTIALS`、`APPLE_CACHE` 四个 KV，`CORE`（`core` 的 `StateCore`），
`APPLE_LOOKUPS`（指向本 Worker 自己的 `AppleLookups`），`DIGEST`（`ai` 的 `Digest`，契约 `shared/digest.ts`），D1 `HISTORY`（`lyjwpage-history`），Durable Object `CRON_SLOTS`（本 Worker 自己的 `CronSlots`，按任务认领格；迁移在 `wrangler.toml#migrations`）。D1 表结构归 `workers/core/migrations` 管：新表先在 core 那边
应用（命令见 [长期归档](../../docs/state-storage.md#长期归档d1)），再发布本 Worker。

## 部署

推到 `main` 由 Cloudflare Workers Builds 原生 Git 集成部署（根目录 `/`，配置与监视路径见
[原生部署配置](../../docs/workers-builds.md)）；不开分支预览：预览版的 `CORE` 会调到生产的 core。

新增 `StateCore` 方法时先发布 core，再发布这里；`Digest` 的契约同理，先发布 ai。各自独立构建。

## 本地开发

根目录 `pnpm dev:worker` 以多配置方式起整套 Worker（配置清单见 `scripts/dev-worker.mjs`）：`workers/dev-router`（拿端口，按路径分发）、
core、ai、上报入口，和这里的 `wrangler.test.toml`。本地没有 cron、没有 D1（归档、在线探测与健康汇总跳过），
KV 都是本地的（`LAG`、`CREDENTIALS` 和上报入口共用同一个本地 id，`LAG` 还和 core 共用）。
令牌照需要放 `workers/collector/.dev.vars`（照 `.dev.vars.example`），不放的任务直接跳过。本地不开 Workers Caching。

```sh
curl -X POST 'localhost:8788/__dev/collector/run?job=provider-status'     # 立刻跑一个任务，返回结果
curl 'localhost:8788/__dev/collector/refresh?jobs=github-chart,site-health'    # 经 Collector RPC 点名跑
curl localhost:8788/cdn-cgi/local/scheduled                                  # 当作 cron 响了一次：跑这一分钟到期的任务（本地不认领格）
```

调试入口只在 `DEV_TRIGGERS=true` 时存在（只配在 `wrangler.test.toml`）。

## 验证

```sh
pnpm --dir workers/collector typecheck
pnpm --dir workers/collector test
```

单测覆盖节奏、KV 存储驱动（含 `shared/cache` 跑在它上面）、D1 `site_deploys` 的 upsert
（真实 SQLite 跑 core 的全部迁移）、厂商状态变了才失效首屏、几处部分成功的合并口径，以及 Apple Music 的
入口层（预检、来源、令牌）、`APPLE_CACHE` 命中不出网和补全后的补写。
