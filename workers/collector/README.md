# collector

采集 Worker：站点所有**定时的外部拉取**都在这里。cron 每分钟响一次，按登记表
（`src/registry.ts`）挑出这一分钟到期的任务并行跑，一个失败不连累别的。

结果分两个去向：

- **只展示、不参与计算的**直接写可滞后层 KV（`LAG`，键表见 `shared/lag.ts`），每条带
  `updatedAt`。**成功才写**：KV 里的值本身就是上次成功值，失败时旧值原样留着，
  不另存 last-good；过没过时由浏览器按各卡片的阈值判断。
- **状态核心要拿来算的**（PlayStation、最近在听）经 Service Binding RPC 交给 api Worker
  的具名 entrypoint `StateCore`（binding `CORE`，契约见 `shared/state-core.ts`）：
  差分、推送、pulse 证据都在那边做。

另开一个具名 entrypoint `Collector`（契约见 `shared/collector.ts`）：同账号的 Worker 调
`refresh(jobs)` 就能点名立刻跑几个任务，比如站点部署完成后重拉部署列表。
没有路由、没有域名；生产上 `fetch` 一律 404。

## 任务

周期都整除 60，「第几分钟」按 UTC 时钟算：`每 10 分钟 · 第 1 分钟` 就是 :01、:11、:21……

| 任务 | 节奏 | 去向 | 需要 | Sentry 监控 · 报到 |
| --- | --- | --- | --- | --- |
| `playstation` | 每分钟（另有人头数门与退避，见下） | `CORE.ingest("playstation")`；奖杯另归档 D1 `trophies` | `PSN_NPSSO` 或 KV 里的登录 | `collector-playstation` · `*/5` |
| `apple-recent` | 每 2 分钟 | `CORE.commitRecentlyPlayed(items)` | 凭据 KV 里的 user token；developer token 经 `CORE` 取 | `collector-apple-recent` · `*/10` |
| `provider-status` | 每分钟 | `LAG agent-status:v1`；灯色变了才 `CORE.revalidate(["agent-status"])` | 无 | `collector-provider-status` · `*/5` |
| `pagespeed` | 每小时 · 第 7 分钟 | `LAG pagespeed:v1`（6 小时滚动中位数） | `PAGESPEED_API_KEY` | `collector-pagespeed` · `7 * * * *` |
| `github-chart` | 每 10 分钟 · 第 1 分钟 | `LAG github-chart:v1` | `GITHUB_TOKEN` | `collector-github-chart` · `1-59/10` |
| `github-repo` | 每 30 分钟 · 第 2 分钟 | `LAG github-repo:v1` | `GITHUB_TOKEN` | `collector-github-repo` · `2-59/30` |
| `vercel-deployments` | 每分钟 | `LAG vercel-deployments:v1`；每次部署另归档 D1 `site_deploys` | `VERCEL_TOKEN` | `collector-vercel-deployments` · `*/5` |
| `vercel-metrics` | 每 15 分钟 · 第 3 分钟 | `LAG vercel-metrics:v1`（函数、访问两组各带采集时刻） | `VERCEL_TOKEN` | `collector-vercel-metrics` · `3-59/15` |
| `cloudflare-deployments` | 每 2 分钟 | `LAG cloudflare-deployments:v1`（按 Worker 名存） | `CLOUDFLARE_METRICS_TOKEN` | `collector-cloudflare-deployments` · `*/10` |
| `cloudflare-metrics` | 每 15 分钟 · 第 4 分钟 | `LAG cloudflare-metrics:v1` | `CLOUDFLARE_METRICS_TOKEN` | `collector-cloudflare-metrics` · `4-59/15` |
| `sentry-status` | 每 5 分钟 | `LAG sentry:v1`（没取到的块沿用上一份） | `SENTRY_API_TOKEN` | `collector-sentry-status` · `*/5` |

几条取数口径：

- **缺令牌就干净地跳过**：每个 isolate 每个任务只 `console.warn` 一次
  （`{"event":"collector-skip",…}`），监控照常报 ok —— 没配是配置状态，不是故障。
- **部分成功**：GitHub 仓库统计的名单和总数、Vercel 指标的两组、Sentry 的五块都是各拉各的，
  这一轮没取到的那一部分沿用可滞后层里上一份的（带着它原来的采集时刻）；全都没取到才算失败、不写。
  Sentry 的块沿用最多 30 分钟（和卡片判它过期的阈值一致），各块取到的时刻记在 `blockAt`，
  再旧那一格就回到「没有」。
  Cloudflare 部署逐个 Worker 查，单个查不到只空那一格（`ingress` 还没部署时就是这样），
  全部查不到才算失败。
- **厂商状态**九家各自降级：某一家失败沿用上一轮那一行并标 `stale`；九家全失败是这边出不去，
  整轮抛错、不写，监控报 error。上一轮是 KV 里那份，同一 isolate 里自己上一轮写的更新时用它
  （KV 读可能落后一分钟）。
- **同一响里 PS 先起步**：一次调用同时只能有 6 个连接在等响应头，同一分钟到期的任务一起开跑时，
  PS 门那 2.5 秒的人头数请求会排在状态页、CF 部署那十几个请求后面被挤超时。所以带 `headStart`
  的 PS 先跑 3 秒（或先跑完），其余任务再开跑（`registry.ts` 的 `HEAD_START_MS`）。
- **PageSpeed** 桌面、移动并行测（各二三十秒，一起一分半上下），合成一个样本并进 6 小时窗口，
  样本窗口存在 `COLLECTOR_KV`。密钥只进查询参数，日志里只有状态码。任一端失败这一小时就空过。
- **最近在听**：user token 只能来自 Mac 上报器，凭据 KV 里还没有就跳过；developer token 由
  状态核心签（私钥只在 api 上），本 isolate 缓存到离到期 10 分钟。封面、时长的缓存经 `src/lib/cache`
  存在 `COLLECTOR_KV`（12 小时、24 小时），稳定状态下一轮只有拉列表那一次出网。

### Sentry 监控

每个任务一条 cron 监控，slug `collector-<任务>`，设置随报到同步（`src/schedule.ts`）：
连续两次 error 或漏报开 issue，一次恢复就关，时区 UTC。周期不短于 5 分钟的每轮都报到；
更短的只在「既是它的一轮、又是 5 的倍数分钟」那几轮报 —— 每分钟的任务每 5 分钟报一次，
每 2 分钟的每 10 分钟报一次（否则奇数个 5 分钟那一格它根本不跑，会被记成漏报）。
报到的开始、结束各是一次请求，分钟级的任务每轮都报太费。

手动触发（`Collector.refresh`、本地调试入口）不报到。

## PlayStation

cron 每分钟响一次，**不等于每分钟跑一轮**：先看退避，再过一道门，门开了才是一轮完整 tick。

### 门

- 读 `COLLECTOR_KV` 的 `meta:lastFullTick`（上一轮完整 tick 的**开始**时刻），和 isolate 本地那份
  取较晚的一枚（KV 的读有最长 60 秒边缘缓存，正好压在 55 秒阈值上）；
- 攒够 29.5 分钟就直接放行，连人头数都不问 —— 闲时节奏不该依赖状态核心可不可达；
- 不到 55 秒直接挡回去；
- 中间那段并行读三样（各自超时 2.5 秒）：online-counter 的 `GET /count`（`online`，可见页面）、
  `CORE.connections()`（推送连接数，含后台标签页）、`CORE.playstationPower()`（主机电源）。
  电源在上一轮之后翻过面就立刻放行；关着就只走 30 分钟那一档；否则 `online > 0` 放行，
  攒够 115 秒且 `connections > 0` 也放行。

两个人头数读不到一律当 0（只会变慢）；电源读不到当「不知道」、按开机走（反过来会把卡片冻在闲档）。
于是有人正看着时 60 秒一轮，页面只是开着 2 分钟一轮，一个页面都没开 30 分钟一轮。
站点的断流窗口（`src/lib/freshness.ts` 的 `PLAYSTATION_STALE_MS`，95 分钟）锚的是闲时那一档，
改闲时间隔要同步改那边。

电源由 Home Assistant 上报（`switch.ps5_210_power` 翻面时 POST `/api/ingest/playstation`
的 `{version:1, power}`），状态核心把它并进 `/api/status/playing/now`；门经 `CORE` 读同一份。

间隔算的是上一轮**开始**的时刻：这枚时间戳在打 PSN 之前就写下，PSN 持续故障时重试节奏
和平时一样，tick 被硬杀掉也不会让门以为「还没开始过」。

### 一轮做什么

1. presence 和奖杯总览并行；
2. 游玩列表走 KV 缓存：在玩 29.5 分钟、闲着 1 小时过期才拉；奖杯没变时只翻最近窗口
   （`PLAYED_GAMES_LIMIT`）盖进缓存。带 `Accept-Language`；
3. 购买库（PS4 / PS5）6 小时才翻一遍，标预购与 Plus，失败沿用旧缓存；
4. 奖杯：总览的等级 / 总杯数 / 屏蔽名单没变就收工；个人资料（onlineId / 头像 / Plus）按 1 天
   TTL 单独判断。变了才翻目录，跟 `trophies:last` 比，只重爬对不上的那几款（两款并行），
   定义没变只打「获得情况」两个接口。然后做 `titleId` 对齐，只补还没映射的；
5. 按 `PLAYSTATION_HIDDEN_TITLE_IDS` 去掉屏蔽的游戏，再按 `PLAYED_GAMES_LIMIT`（默认 100）切开，
   接上没开过档的预购；
6. 交付两封 v1 信封：第一封必带 presence（状态核心靠它的 `observedAt` 判死活），playedGames
   变了才一起带；奖杯只在整份目录拼齐后另发一封。两封各自成功才写各自的指纹。
   奖杯那封交付成功后，把其中每个已获得的奖杯 upsert 进 D1 `trophies`（没变的行不写，
   每批最多 100 条，失败只记日志；dry-run 与没绑 D1 时跳过）。

交付走 `CORE.ingest("playstation", raw)`：回执 2xx 且 `body.ok === true` 才算收下。
`PS_DRY_RUN=true` 时信封只打进日志（本地默认如此）。

会越界的值在 Worker 里钳好（百分比 0–100、id 非负整数、空串回落）：状态核心的校验是信封级
全有全无。psn-api 2.18.1 有一半取数函数遇 429 / 401 既不抛也不看状态码，原样把 `{error:{…}}`
交回来，所以这边自己断言一遍；分页端点另外拿 `totalItemCount` 对条数。

### 上游不可用与退避

psn-api 的取数外壳不看 HTTP 状态码、直接 `.json()`，于是 PSN 前面那层 CDN（Akamai）的拒绝页
变成 `Unexpected token '<', "<HTML><HEA"... is not valid JSON`，纯文本网关错误变成
`Unexpected token 'e', "error code: 504"...`；游玩列表那一路自己 fetch，报成
`PSN 返回 403：<HTML>…Access Denied…`。这几种归为 `PsnUpstreamUnavailable`（`src/playstation/util.ts`），
贴上先撞上的那一路（`presence` / `trophy-summary` / `played-games` / `auth` …），
以 `{"event":"playstation-upstream-unavailable","call":…}` 记 warn，不混进报错。

整轮因为它失败时退避：`meta:backoffUntil` = 现在 + 5 分钟，每连败一轮翻倍，封顶 30 分钟，
成功一轮清零；退避期间每一响都不碰 PSN（isolate 本地另存一份，理由同门）。
连败次数（不分原因）记在 `meta:failureStreak`。

监控 `collector-playstation` 的判定：真跑了的那一轮失败就报 error；没跑的那一响（门没开、退避中）
在**连败两轮以上**时报 error，否则报 ok。所以单次抖动之后的等待（闲档半小时、退避几分钟）不吵人，
持续断流时每次报到都是 error，连续两次就开 issue —— 这一条是有意偏离「失败的那一轮才报 error」的
字面做法：失败那一轮多半落不在报到的那一分钟上，不这样长时间断流永远报不出来。

### 鉴权

整条链由 `psn-api` 2.18.1 的三个 exchange 函数负责：

```text
NPSSO → access code → access token + refresh token → refresh 续期
```

access token 过「签发 → 到期」的中点就续；业务请求遇到 401 会强制续一次并重试一次。refresh 被
上游拒绝时才退回 NPSSO，网络错误原样抛出。refresh token 实测约 10 天，期限以上游响应为准。
**每次续期都会轮换 refresh token**，所以同一个账号不能有两处同时在跑（手动触发也走同一道门）。

NPSSO 是 secret `PSN_NPSSO`，可以缺席：KV 的 `auth` 里还有有效 refresh token 时不需要它；两样都没有
时这个任务干净地跳过。重新生成 NPSSO 会立即作废上一串；也不要从 PlayStation 网站登出。

### 语言与规范化

`PSN_LANGUAGE` 默认 `zh-Hans`，presence 和奖杯接口经 psn-api 的 `headerOverrides` 发
`Accept-Language`。psn-api 的 `getUserPlayedGames` 不接 `headerOverrides`，所以游玩列表直接请求
同一个 `…/users/:accountId/titles` 端点。时间戳转 epoch 毫秒、ISO-8601 时长转毫秒、平台名大写。
`category`、`service` 是上游枚举，已见值和信封样例见 git 历史里的 `workers/playstation-reporter/README.md`。

## COLLECTOR_KV 的键

沿用原 playstation-reporter 的命名空间（`0f9b584f71634776ba3bc081a7aa4498`），PSN 登录不用重来。

| 键 | 内容 |
| --- | --- |
| `auth` | PSN token 状态：`accessToken`、`refreshToken` 与四个 epoch 毫秒时刻 |
| `fp:playedGames` / `fp:trophies` | 上次交付成功的游玩列表 / 奖杯目录指纹 |
| `trophies:last` | 上次成功交付的整份奖杯目录 + 索引快照，增量重爬的对照面；`profile.fetchedAt` 是资料上次拉取时刻 |
| `cache:playedGames` / `cache:library` | 游玩列表、购买库缓存 |
| `meta:lastTick` | 最近一轮的时间、成败、有没有变、dry-run，收尾时写 |
| `meta:lastFullTick` | 上一轮完整 tick 的开始时刻（纯数字），门用，开跑前写 |
| `meta:backoffUntil` | 上游不可用的退避截止时刻（纯数字），0 表示没在退避 |
| `meta:failureStreak` | `{streak, at}`：连着失败了几轮 |
| `lyjwpage:cache:*` | `src/lib/cache` 的键：Apple 封面 `apple-music:library-art:v1:*`、时长 `apple-music:duration:v1:*`、GitHub 增删行的锚 `github-repo:churn`、PageSpeed 样本窗口 `pagespeed:history:v1:*` |

`src/lib/cache` 在这里背后是 KV（`src/storage-driver.ts`）：TTL 最短 60 秒（5 秒的负缓存会活满一分钟），
`ifAbsent` 是先读后写、不是原子的（任务同一时刻只有一份在跑，够用），KV 的读还有最长 60 秒的边缘缓存 ——
两分钟以内要读回的东西不走它。列表、哈希操作直接抛错。

## 配置

变量在 `wrangler.toml` 的 `[vars]`。Secret（`wrangler secret put`，缺哪个跳过哪个任务）：

| Secret | 用途 |
| --- | --- |
| `PSN_NPSSO` | KV 里的 refresh token 过期时重新登录 PSN |
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

根目录 `pnpm dev:worker` 以多配置方式起三个 Worker：`workers/dev-router`（拿端口，按路径分发）、
api（`wrangler.test.toml`）和这里的 `wrangler.test.toml`。本地没有 cron、没有 D1（归档那一步跳过），
三个 KV 都是本地的（`LAG`、`CREDENTIALS` 和 api 共用同一个本地 id），`PS_DRY_RUN=true`。
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

单测覆盖节奏与报到、KV 存储驱动（含 `src/lib/cache` 跑在它上面）、PS 交付适配、上游不可用的
分类与退避、D1 `trophies` / `site_deploys` 的 upsert（真实 SQLite 跑 api 的全部迁移）、
厂商状态变了才失效首屏，以及几处部分成功的合并口径。
