# 讲解动画 · 事实基线

> 类型：reference

按这份仓库里的代码核对，文档和代码不一致时以代码为准。动画里出现的每一个端点、数字、谁做什么，都要能在这里找到出处；架构改动时先改这份，再改分镜。

第 3 节（第 03 章用到的部分）和第 2 节的 202 时机，又在 **34eb555** 上逐条回代码复核过：eb429ed..34eb555 之间 `workers/`、`shared/`、`src/` 只有 7d88247 的注释改动，下面引的行号没有偏移。这次复核改了几处口径（纯心跳写几样、切应用和换歌各交回什么、LivePushRoom 的出处），并补了出处。

线上这一版讲解片按 bf6c14b 的代码写成，之后约 50 个提交重构了中枢：上报入口拆成无状态 Worker、可滞后层、采集 Worker、D1 历史、首屏按卡读取、在线判断交给浏览器、在线人数并回推送房间。

## 一句话总览

仍是三段：**采集 → 中枢 → 展示**。中枢由三部分组成：

- **ingress**：无状态的上报入口，负责鉴权、校验、分流。
- **api**：状态核心 `StateCore`（RPC 入口）加上 `StateHub` DO，以及推送房间 `LivePushRoom`。
- **collector**：每分钟一响的采集 Worker。

数据按层落地：实时层在 DO，可滞后层在 KV `LAG`，长期历史在 D1 `lyjwpage-history`，凭据在 KV `CREDENTIALS`。

## 1 采集端

### 来源

片中开场按「**七个外部上报器 + 一个采集 Worker**」画（下表前七行就是这七个上报器）；Claude Code 云端遥测（OTLP）不是我们写的上报器，另算一个入口。上报器和采集任务有几个，只按代码画，旁白和标注里不说。其中 n100 上的 playstation-reporter，把 presence、游玩列表和奖杯 POST 到同一个 `/api/ingest/playstation`。入口来源是 `shared/ingest/prepare.ts#INGEST_SOURCES` 那一份（playstation 是其中之一）；OTLP 走 `/api/ingest/agents/otlp`，不在这份清单里。Home Assistant 的 token 开 homepod 和 playstation 两扇门。容器自己的 Access service token 是 `lyjwpage-playstation`，登记在 `workers/ingress/wrangler.toml#ACCESS_CLIENTS`，权限只有 `ingest:playstation`。

第 01 章用到的部分（编码用量、collector 的任务与节奏、PlayStation 上报器、Mac 信封的 90 秒和 400 ms）按 main 2489e10 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

| 来源 | 程序 / 在哪跑 | 入口 · token | 报什么 |
|---|---|---|---|
| Mac | Mac Telemetry Hub，菜单栏 App | `/api/ingest/mac` · `lyjwpage-mac` | 前台应用、窗口标题、Apple Music、充电设备、编码用量（本机的日行、最近一次用量事件、5 分钟 token 桶）、时区、Apple Music user token |
| iPhone | iPhone Telemetry Hub，HealthKit 唤醒：圆环按小时（`.hourly`；README 说这一条传 `.immediate` 也会被系统钳到 `.hourly`），训练申请 `.immediate`（`reporters/iphone-telemetry-hub/App/iPhoneTelemetryHub/Modules/ActivityModule.swift#observe`、`reporters/iphone-telemetry-hub/App/iPhoneTelemetryHub/Modules/WorkoutsModule.swift#startObserving`、`reporters/iphone-telemetry-hub/README.md` 的「什么时候会上报」） | `/api/ingest/iphone` · `lyjwpage-iphone` | 活动圆环、训练、五分钟步数桶 |
| Home Assistant | 家里 | `/api/ingest/homepod` 和 `/api/ingest/playstation` · `lyjwpage-home-assistant` | HomePod 正在播放；PS5 电源 `{version:1, power}` |
| PlayStation | playstation-reporter，n100 上的容器 | `/api/ingest/playstation` · `lyjwpage-playstation` | presence、游玩列表、奖杯。不发 `power` |
| Emby | emby-reporter，NAS 上的容器 | `/api/ingest/emby` · `lyjwpage-emby` | 在看什么；海报先传 R2 |
| 服务器 | server-reporter，东京 misaka-jp 容器 | `/api/ingest/server` · `lyjwpage-server` | 服务器状态，固定每 60 秒一次（`reporters/server-reporter/src/config.ts#intervalMs` 的默认值，容器 `.env` 可覆盖） |
| 编码账号 | agents-reporter，misaka-jp 容器 | `/api/ingest/agents` · `lyjwpage-agents` | 各家编码工具限额；Cursor 账号的用量日行、最近一次用量事件、5 分钟 token 桶 |
| Claude Code 云端 | OTLP JSON（可 gzip），Claude Code 自己发，不是我们写的上报器 | `/api/ingest/agents/otlp` · `lyjwpage-claude-cloud` | 云端 token 与费用的累计值（只收 cumulative）；状态核心按序列做差，落成和另两个来源同形的日行、5 分钟桶、最近一次用量事件（`workers/api/src/stores/claude-cloud.ts`）。三处怎么合并见下文「编码用量」 |
| collector Worker | Cloudflare，cron 每分钟一响，任务表 `workers/collector/src/registry.ts#JOBS` 里的任务各按自己的节奏 | 不走 ingress | 见下文 |

PlayStation 的 presence、游玩列表和奖杯由 `reporters/playstation-reporter` POST 原始信封。采集 Worker 不拉 PSN。电源由 Home Assistant 上报。

第 01 章 FIG. 3 画它：容器跟 PS5 在同一个局域网里，用 UDP 发现包探测主机状态（`reporters/playstation-reporter/src/probe.ts#probeOnce`），按醒着、没醒两档调整打 PSN 的频率（`reporters/playstation-reporter/src/cadence.ts#shouldRunTick`，展开见 §7）。两档对调时立刻打一轮，所以开机后第一探读到醒着，紧跟着就寄一封。片中不出间隔的数。

### Mac 信封

- 结构是 `{version:4, presence, heartbeatAt, activeModules, modules:{…}}`，`heartbeatAt` 是 epoch 毫秒；只带变了的模块（`reporters/mac-telemetry-hub/Sources/TelemetryCore/TelemetryEnvelope.swift#TelemetryEnvelope`、`reporters/mac-telemetry-hub/Sources/TelemetryCore/ReportDecision.swift#ReportDecision`、`shared/ingest/telemetry.ts#prepareTelemetryEnvelope`）。
- 没变化时每 **90 秒**发一个空信封报平安（`reporters/mac-telemetry-hub/Sources/TelemetryCore/ReportDecision.swift#heartbeatInterval`）。
- 切应用先等 **400 ms** 落定，是防抖：落定前再切一次就重新等（`reporters/mac-telemetry-hub/App/MacTelemetryHub/ServiceController.swift#desktopSettleDelay`）。
- 窗口标题上报前先过隐私判断，Jev 参与；只有放行的进信封（`reporters/mac-telemetry-hub/App/MacTelemetryHub/WindowTitleJudge.swift#WindowTitleJudge`）。判据不写；第 01 章问题横条的条数是示意，不对应判断的题数。

### 图片

- 字节在源头定好，文件名是 `sha256(内容).扩展名`，直传 R2，带 `Cache-Control: public, max-age=31536000, immutable`（`reporters/emby-reporter/src/r2.ts#uploadImage`；`reporters/mac-telemetry-hub/Sources/TelemetryCore/R2IconUploader.swift#upload`、`reporters/mac-telemetry-hub/Sources/TelemetryCore/R2IconUploader.swift#objectKey`）。
- 三种图：
  - Mac 应用图标：重画成 96×96 PNG（`reporters/mac-telemetry-hub/App/MacTelemetryHub/TelemetryModules.swift#pngData`）
  - Emby 海报：转成 WebP q88（`reporters/emby-reporter/src/r2.ts#uploadImage`）
  - Mac 充电头封面：Anker 的源 JPEG 原样上传，扩展名 jpg（`reporters/mac-telemetry-hub/App/MacTelemetryHub/ServiceController.swift#confirmedCoverIconObjectKey`）
- 信封里只带 `objectKey`。入口按 `src/lib/asset-url.ts#IMAGE_OBJECT_KEY` 的正则校验（64 位十六进制加 png / webp / jpg）。Mac 的应用图标在 `desktop` 模块里是 `iconHash` 加 `iconObjectKey`（`shared/ingest/telemetry.ts#PreparedDesktop`）。

### 编码用量（三个来源）

- 三个来源只报自己观测到的原始事实，三种形状一样：日行（来源 × agent × 站点日）、5 分钟 token 桶、最近一次用量事件（契约 `shared/coding-usage.ts`）。来源登记在 `shared/coding-usage-sources.ts#CODING_USAGE_SOURCES`：Mac 本机的会话记录、agents-reporter 里 Cursor 账号的完整历史、Claude Code 云端的 OTLP（状态核心做差后才成形，见上表）。
- 合计、排名、去重、年度格子都不归来源，在状态核心一处算（`shared/coding-usage-view.ts#buildCodingUsageView`）：同一个 agent 有账号级来源（Cursor 账号）就只用它，本机和云端相加（`shared/coding-usage-sources.ts#resolveCodingUsageSources`）。读出口是 `/api/status/coding`、`/api/status/coding/now`、`/api/status/coding/year`（`src/lib/status-views.ts#STATUS_VIEWS`）。
- Pulse 多一条 Tokens 道：三个来源的 5 分钟桶全部相加，画每分钟新处理的 token 数，不含缓存读（`src/lib/pulse.ts#tokensLaneView`）。
- 片中只讲到「三处各报原始数，站点这边合并，Pulse 上多一条 token 速率」，不点存储键和模块名。

### collector 的任务

- 节奏：每个任务登记「每 N 分钟、第 offset 分钟」（各任务的 `everyMinutes` / `offset`），cron 每分钟一响时挑出到期的一起跑（`workers/collector/src/schedule.ts#isDue`）。第 01 章表盘的时序图按这张表从整点起画 12 分钟。
- 最近在听：每 2 分钟调 `CORE.commitRecentlyPlayed`。用的 user token 是 Mac 推进 `CREDENTIALS` 的那一份，形成一次凭据接力。
- GitHub、Vercel、Cloudflare、Sentry、PageSpeed、厂商状态：直接写 `LAG`；Vercel 部署列表那一轮另把站点部署记录写进 D1（`workers/collector/src/jobs/vercel.ts#vercelDeploymentsJob`、`workers/collector/src/history.ts#archiveSiteDeploys`）。第 01 章表盘的注只说「直接交给状态核心，或写 LAG」，不画 D1。
- PlayStation 不在这张表里。

## 2 上报入口（workers/ingress，`ingest.homepage.lyjw.llc`）

第 02 章用到的部分按 main 7fcfacb 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

### 鉴权

- 走 Cloudflare Access service token，**每个上报方一把钥匙，只开权限表上写着的门**（`workers/ingress/wrangler.toml#ACCESS_CLIENTS`）。钥匙按上报方发、不按来源：Home Assistant 那一把开 homepod 和 playstation 两扇；`/playstation` 这扇门另有 n100 上 playstation-reporter 容器自己的一把。两家往同一个来源写不同的字段：Home Assistant 只报 `power`，容器报 presence、游玩列表和奖杯（`shared/ingest/playstation.ts#preparePlaystationReport`）。验钥匙分三步：
  1. Access 在边缘先挡一道。
  2. Worker 再验 `Cf-Access-Jwt-Assertion`（RS256，校验 aud / iss / exp；`shared/access-jwt.ts#verifyAccessJwt`）。
  3. 用 `common_name` 查 `ACCESS_CLIENTS` 权限表。
- 结果码：无 JWT 回 401，越权（例如拿 Emby 的钥匙写 mac）回 403，验不了回 503（`workers/ingress/src/access-auth.ts#authorize`）。
- 共用 Bearer 密钥已退役（d7f9811）。

### 判定顺序（worker.ts）

| 步骤 | 条件 | 返回 |
|---|---|---|
| 1 | 预览版本 | 403 |
| 2 | 不是 POST | 405 |
| 3 | 来源未知 | 404 |
| 4 | Access 鉴权不过 | 401 / 403 / 503 |
| 5 | OTLP 压缩格式不对 | 415 |
| 6 | 读不出请求体，或超过 **4 MiB**（按实际读到的字节数） | 400（storage-contract.ts:14） |
| 7 | 不是 JSON | 400 |
| 8 | prepare 失败 | 状态核心未初始化回 503，否则 400 |
| 9 | `CORE.commitIngest` 返回 `ready:false` | 503 |
| 9 | `CORE.commitIngest` 拒收 | 400 |

- Emby 海报在 prepare 里 HEAD R2 确认存在，带 5 分钟正缓存（r2-assets.ts:17）。回执里的 `missingImages` 告诉上报器还要补传哪些图。

### 分流：一封上报按数据层拆成四路

| 路 | 去向 | 例子 |
|---|---|---|
| 实时 | `CORE.commitIngest` → StateHub | desktop、Apple Music、充电、编码、HomePod、PS、Emby、Cursor |
| 可滞后 | KV `LAG` | server（整封只走可滞后和归档两路）、限额、时区、圆环读数、训练列表、上报器账本 |
| 归档 | D1 `HISTORY` | 训练、圆环日读数、限额快照、服务器小时汇总 |
| 凭据 | KV `CREDENTIALS` | Mac 推来的 Apple Music user token |

- `server` 整封**不经过状态核心**：写 `LAG` 和上报器账本，另把小时汇总归档进 D1（`shared/ingest/prepare.ts#CoreCommand`；`workers/ingress/src/worker.ts#commitIngest`；`workers/ingress/src/ingest-archive.ts#ingestHistoryStatements`）。
- 四路都按自然键幂等，重发不会重复写。

### 202 的时机

**202 要等三样**，而且是依次等：StateCore 回执 → `LAG` 写完 → 凭据写完 → 回 202。D1 归档在拿到回执后放进 waitUntil，不等（`workers/ingress/src/worker.ts#commitIngest`）。

可滞后层的写入方（ingress、collector）没有 Vercel 密钥。写入时发现布局变了，就调 `CORE.revalidate(tags)` 请状态核心代发（同一函数）。

特例：iPhone 的训练收下了、圆环被拒时，已收下的那份照写，然后回 400。

### 好处

改校验只需要发布 ingress。DO 不重启，WebSocket 不断。

## 3 状态核心（workers/api）

### StateCore 与 StateHub

- `StateCore` 是 WorkerEntrypoint，ingress 和 collector 经 Service Binding `CORE` 调它。这条路不鉴权，因为边界鉴权只在 ingress 做一次（state-core.ts:15-37）。
- `StateHub` 是 DO（binding `STATE`，`idFromName("global")`），**唯一的状态 DO，全站只有一个实例**（state-core.ts:72-74）。推送房间 `LivePushRoom` 是另一个单例 DO（房间名 `global`，live-platform.ts:98；binding 在 workers/api/wrangler.toml:52-55）。它的命名空间是从旧 ingest Worker 整体迁来的 SQLite 类（wrangler.toml:91-111），但代码不读写 SQL：每条连接的可见性记在各自的 attachment 上（origin-worker.ts:161-172）。
- 提交走 `ingestTail`，**排成一条队列逐个提交**（state-hub.ts:91-110）。进这条队的上报都经上报入口的 `CORE.commitIngest`（ingress worker.ts:134），PlayStation 那几封也走这条 HTTP 路。
- 四张表：`entries` / `fields` / `samples` / `metadata`（shared/sqlite-store.ts:17-23；state-hub.ts:29）。
- pulse 事实时间线也写在同一个库里，TTL 7 天（`PULSE_TTL_MS`，src/lib/limits.ts:32）。

### 效果清单

- **DO 不发网络请求，只交回「要做的事」**：`event` / `listening` / `tags` 三种（ingest-effects.ts:25-28）。
- StateCore 用自己的 `ctx.waitUntil` 执行这份清单，然后把结果回给 ingress（state-core.ts:30-37；live-platform.ts:12-17）：
  1. 先并行向 `LivePushRoom` 广播。
  2. 再把布局标签一次性发给 `POST {SITE}/api/revalidate`，5 秒超时（ingest-effects.ts:106-120；live-platform.ts:19、66-95）。
- 所以**广播和 202 是并行的**，不是 202 之后才广播。
- 换歌推送前，先查 Apple 目录补封面、链接、songId、有没有歌词（shared/telemetry.ts:176-201）。
- 各模块交回什么（workers/api/src/stores/telemetry.ts）：
  - **切应用**只交回一条 `desktop` 事件，不失效首屏：页头那一格定宽，换应用只换内容（354-355）。所以片中「切应用」不配「通知 Vercel」。
  - **换歌**交回 `listening`：StateCore 先查 Apple 目录，再广播 `listening-now`（ingest-effects.ts:76-103）。只有开始或停止放歌才另失效在听那张卡的标签 `NOW_LISTENING_TAG`（telemetry.ts:392-393），换一首不失效。
  - iPhone 那一半只进 Pulse（五分钟桶和训练区间），不推送、不失效（phone-telemetry.ts:7-9、42-44）。
  - 清单里的通知（`event`、`listening`）先并行发完，再把所有标签合成一次失效（ingest-effects.ts:106-120）。

### 心跳不是什么都不做

纯心跳也会写：存活时间（workers/api/src/stores/telemetry.ts:186）、在听和 coding 各一笔 pulse 观测（450-451），外加遥测状态里的 `telemetryReceivedAt` 和 `activeModules`（456，字段见 46-73）；充电头模块开着时，还续一次充电头心跳和一笔充电采样（318-326）。片中只说「存活 + pulse 观测」，不说「三样」。它**不推送、也不失效首屏**。唯一的例外是在线 / 离线翻转：这时推 `presence`，并失效 3 个标签：页头、在听、充电头三张卡的 `DESKTOP_TAG` / `NOW_LISTENING_TAG` / `CHARGER_TAG`（同文件 199-202；src/lib/status-tags.ts:4-12）。

### 推送房间 `LivePushRoom`

- 地址 `/ws`（binding `LIVE_PUSH`，房间 `global`；origin-worker.ts:463）。
- 事件共 14 种，其中 11 种带数据；`presence`、`version` 不带数据；`online` 带 `{online}`（src/lib/live-events.ts:24-110）。
- 用 Hibernation API：ping/pong 由运行时自动应答，不唤醒 DO（origin-worker.ts:185）。只有接入、断开、切换可见性、清扫闹钟这几件事会唤醒它。

### 在线人数（f6cda45 起并回推送房间，online-counter Worker 已退役）

- 同一条 `/ws` 同时数两种口径：
  - `connections`：开着的页面，含后台；静默 5 分钟不计，30 分钟关闭。
  - `online`：正在看的页面；心跳 30 秒，静默 90 秒不计，清扫 30 秒一次。
- 页面握手时带 `?visible=1`，切后台只发 `hidden`，不断开连接（origin-worker.ts:202；use-live-events.ts:283）。
- `/count` 一次返回 `{ok, connections, online}`；RPC 的 `audience()` 返回同样的两个数（live-census.ts；shared/state-core.ts）。
- 可见人数变了才广播 `online`。

### D1 长期历史 `lyjwpage-history`

- 表见 `workers/api/migrations/` 的 `CREATE TABLE`（片中不说几张），其中记归档水位的是 `pulse_archive_state`，冻结不再写、原样保留的旧表是 `pulse_samples`、`coding_token_buckets`、`agent_usage_days`（`workers/api/README.md`）。长期保存、不按时间清理。写入按自然键 upsert（`shared/history-ingest.ts` 的各 `…Statements`），活动桶会按区间删掉重写（`workers/api/src/pulse-archive.ts#DELETE_ACTIVITY_RANGE`），所以不能说「只增不删」。DO 里的 pulse 时间线只留 7 天。
- 写 D1 的有三方：上报入口（训练、圆环日读数、限额快照、服务器小时汇总）、采集 Worker（站点部署记录，`workers/collector/src/history.ts#archiveSiteDeploys`）、api（分钟 cron 的 pulse 归档，含编码用量的账本和 5 分钟桶；以及收下奖杯信封后的 `workers/api/src/stores/trophy-history.ts#archiveTrophies`）。
- 活动历史桶在入口量化（eb429ed），防止 HealthKit 的浮点抖动让 D1 每次重写整个 24 小时窗口。

### api 的分钟 cron（`workers/api/src/index.ts#runScheduled`）

这一节和下面的「Pulse 事实时间线」是第 08 章用的，按 main 2489e10 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

- 每轮只做两件事：
  1. 把 pulse 归档到 D1：StateHub 给出一份有界快照 → 写事实表 → 回头确认水位。各路独立，一路坏了不挡别的路（`workers/api/src/pulse-archive.ts#ARCHIVE_STREAMS`：三条状态道、在听的曲目痕迹、充电、活动桶、Coding 观测，加上编码用量的账本和 5 分钟 token 桶）。
  2. PulseScorer 调 Jev（`jev-1.13.0`），**只给 Coding 打分**，一窗是 `shared/pulse-coding.ts#PULSE_SCORE_WINDOW_MS`（三个 5 分钟桶，15 分钟），窗结束两分钟后才打（`workers/api/src/pulse-score.ts#PulseScorer`）：
     - 交给 Jev 的是这一窗的特征：Mac 的前台应用与 agent 观测、容器里 Cursor 账号的活动，外加三个来源的 5 分钟 token 桶（Mac 本机扫描、Cursor 账号历史、Claude Code 云端遥测），按来源、agent、模型相加（同文件 `windowTokenUsage`）。Mac 扫描范围里缺的桶是测到的 0；另两个来源只作正证据，没有行不等于 0。
     - 全零的窗不问 Jev，直接记最低档：整窗都看得见、Mac 本机扫描盖满三个桶、没有任何活动和 token（同文件 `definiteZero`）。Mac 不在、只有 Cursor 看得见且没有活动时也不问，按半置信记最低档（`quietIndependentSource`）。一点观测都没有的窗不打分。
     - 每轮最多 36 个窗，从新到旧，每批并发 3，超时 10 秒。
     - 打分写回 StateHub 的评估列表，和 pulse 时间线一样只留 `src/lib/limits.ts#PULSE_TTL_MS`（`workers/api/src/pulse-score-state.ts#finishPulseScore`）；归档的各路（`ARCHIVE_STREAMS`）里没有它，**不进 D1**。第 08 章在 Jev 那一格上方注「打分只在屋里放 7 天，不进 D1」。
- 整 5 分钟那一轮（按 UTC 分钟）包在 `Sentry.withMonitor` 里，向 `api-minute-cron` 报到（`workers/api/src/cron-heartbeat.ts#heartbeatDue`、`src/lib/sentry.ts#CRON_HEARTBEAT_EVERY_MINUTES`）；其余几轮照跑、不报到。
- 两件事都 `.catch` 吞错，所以心跳**只证明 cron 跑完了**，不证明归档或打分成功（`workers/api/src/index.ts#runScheduled`）。

### 闹钟

- StateHub 每小时清一次过期键；一轮删满 1000 条就 1 秒后接着删（state-hub.ts:153-160）。
- LivePushRoom 在有人可见时每 30 秒清扫一次。

### Pulse 事实时间线

- 时间线只存原始值，档位、颜色、摘要都在展示时现算（`shared/pulse-timeline.ts`）：三条状态道（听、看、玩）是状态区间；充电是实测瓦数样本；活动是 HealthKit 的五分钟步数桶加训练区间。
- Coding 不进这条时间线：它的三色带（前台是 coding 应用 / 有 agent 在跑 / 两者同时）读的时候从 Mac 的观测和 Cursor 账号的观测现算（`shared/pulse-coding.ts#codingBand`）；Jev 的打分只出现在悬停提示里。
- Tokens 道：三个来源的 5 分钟 token 桶读的时候相加，画每分钟新处理的 token（输入 + 输出 + 缓存写入，不含缓存读；`src/lib/pulse.ts#tokensLaneView`）。
- Pulse 卡的道按 `src/components/live/pulse-card.tsx#LANES`，写章时从上到下是 Coding、Tokens、Listening、Watching、Gaming、Charging、Activity（第 08 章的地层照这个顺序一层一层画，旁白不说几条）；卡上画最近 24 小时（`src/lib/limits.ts#PULSE_WINDOW_MS`），屋里留 7 天（`PULSE_TTL_MS`），D1 长期保存。

## 4 首屏（Vercel 上的 Next.js）

第 04 章用到的部分按 main 7fcfacb 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

### 按卡缓存

- `/api/home` 已删除（8977457）。首屏按视图并行调 `firstScreen(key)`，一个视图一次（按 7fcfacb 现数 **26 次**），外加头像和最近提交；第二轮再取图标内联、封面占位和歌词（`src/app/page.tsx#Home`）。一张卡读几个视图就有几条缓存，卡与视图的对应见 `src/app/page.tsx#READS`。
- 每张卡读自己的 `/api/status/*`：实时卡读 DO，可滞后卡读 `LAG`（`src/lib/first-screen.ts#firstScreen`）。
- 所有公开读取都先过 `publicBarrier()`（`workers/api/src/public-execution.ts#executePublicRequest`）。
- **每张卡一条 `'use cache'`**，cacheLife 为 stale 300 / revalidate 600 / expire 7 天（`src/lib/first-screen.ts#firstScreen`）。歌词另是 300 / 3600 / 86400（`src/lib/first-screen.ts#firstScreenLyrics`）。
- 标签：按 7fcfacb 现数 19 个视图挂 `page:` 标签；另有 7 个视图不带标签（GitHub 两份、Vercel、Cloudflare、Sentry、上报器账本、pulse），只靠 600 秒定时重建（`src/lib/status-views.ts#STATUS_VIEWS`）。
- 一个标签失效，只让那张卡回源；整页在后台重建，旧页照给（`revalidateTag(…, "max")`，status-revalidation.ts:5）。
- 第 00 章把首屏画成浏览器窗口里的线框：卡片框按 `src/app/page.tsx` 的版面、尺寸取第 04 章 P 表的实测比例；画的那一刻没在充电，充电那一格收起、「最近播放」占满一行（`src/components/live/media-pair.tsx#LiveMediaPair`）。卡上的标注照站点原文（`src/components/live/listening-card.tsx` 的 Recently Played、Now Playing，界面上是大写）。

### 来源出问题时

- Worker 降级：回 `ok:false` 加 HTTP 200。
- 404：显示 "Status unavailable"。
- 5xx 或网络错误：抛出，Next **继续用上一份缓存**（`src/lib/first-screen.ts#firstScreen`）。

## 5 浏览器

第 05 章用到的部分按 main 7fcfacb 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

### 早开连接

- head 里的内联脚本解析到它时就 `new WebSocket("wss://…/ws?visible=1")` 起手，把收到的消息原样攒下：最多 `EARLY_LIVE_SOCKET_QUEUE_LIMIT` 条（50），没人接手就在 `EARLY_LIVE_SOCKET_WATCHDOG_MS`（15 秒）后自己关（`src/lib/live-socket-boot.ts#earlyLiveSocketScript`）。
- 这样**不用等整棵树 hydrate 完**才发起连接。hydrate 后由 `useLiveEvents` 接管这条连接，攒下的按到达顺序重放（`src/hooks/use-live-events.ts#adoptEarlySocket`）。房间在连上的那一刻就发一条 `online` 人数，所以托盘里通常至少有这一封。
- 代码里不记实测延迟，注释只讲为什么要早开。**片中不标毫秒**，时间轴只画先后；要标得先重测。
- 重连退避从 1 秒起、每次 ×1.5，封顶 30 秒。重连后所有实时视图立刻补取一次（同文件 `open` 里的 `onReady`）。

### 推送进卡片

- 带数据的事件按 `src/hooks/use-live-events.ts#FORWARDS` 直接 `mutate(path, data, {revalidate:false})` 写进对应的 SWR 键，卡片当场更新：desktop、listening-now、listening、watching-now、watching、playing-now、playing、trophies、charger、powerbank、coding-now。事件名到端点的对应登记在 `src/lib/status-views.ts#STATUS_VIEWS`。
- `online` 只写页脚的人数；`presence`、`version` 不带数据，只让几张卡重取（同文件的 `INVALIDATIONS`；presence 重取的是 Mac 供数的几张，含 coding-now）。
- 时间戳挡旧：推送先经 `acceptPush` 登记这一代，轮询回来经 `guardPolled` 比，慢回来的旧数据盖不掉新的（`src/lib/status-reads.ts#guardPolled`）。带单调戳的只有 desktop、listening、listening-now、powerbank、trophies（同文件的 `STAMPS`），listening-now 比的是 `receivedAt`。

### 取数节奏（`src/lib/poll-schedule.ts`）

- 实时卡的间隔由卡片组件自己给（各组件里 `REFRESH_MS` 一类常量）：
  - 充电头、充电宝：30 秒
  - desktop：60 秒
  - 编码（coding、coding-now）：2 分钟
  - pulse：5 分钟
  - 在听 / 在看 / 在玩「此刻」：60 秒
  - 列表类和奖杯：10 分钟（在听列表空着时 60 秒）
- 推送连着、且视图登记了 `pushCovers`（listening、watching、watching-now、playing、playing-now、trophies）时，间隔取 `max(cardMs, PUSH_SAFETY_NET_MS)`，也就是不快于 5 分钟的兜底（`src/lib/poll-schedule.ts#realtimeInterval`）：真被放宽的只有 60 秒的「此刻」卡（watching-now、playing-now）和空着的在听列表，10 分钟的列表和奖杯不变。desktop、充电头、充电宝、listening-now、编码没登记 `pushCovers`，照旧按自己的间隔。
- 可滞后卡不固定轮询，在 `due = updatedAt + cadenceMs + LAG_GRACE_MS`（15 秒）时去取，也就是「下一次预期写入」之后一点；过了 due 还没取到更新的，从 `LAG_MIN_RETRY_MS`（15 秒）起退避，封顶 min(节奏, `LAG_MAX_RETRY_MS`)（`src/lib/poll-schedule.ts#nextLagDelay`）。
- 节奏登记在 `src/lib/status-views.ts#STATUS_VIEWS` 的 `cadenceMs`。片中到货表举的三行：server 60 秒、github-chart 10 分钟、activity 1 小时；表里的 updatedAt 时刻是示意。
- 标签页隐藏就暂停。

### 在线判断全在浏览器（8a7e63e）

- 源站只给原始事实：`lastSeenAt`、`heartbeatWindowMs`、`declaredOffline`（`src/lib/reporter-liveness.ts#withPresence`），不给「此刻在不在线」的结论。
- 首帧拿首屏信封的 `servedAt` 当钟；挂载后换成访客自己的钟，只进不退（`src/lib/freshness.ts#clockReading`）。
- 到了 `lastSeenAt + heartbeatWindowMs` 这个截止时刻，浏览器自己的定时器把钟推过去，卡片当场翻成离线，不再去问源站（`src/hooks/use-stale.ts#useReporterStale`）；刚切回前台、回源还没回来的那一拍不算（`src/lib/freshness.ts#confirmStale`）。

### 播放进度

- 位置 + (现在 − 观测时间)，即 `positionMs + (now − observedAt)`，只在 `state === "playing"` 时往前推；单曲循环（repeatOne）时取模（`src/lib/track-position.ts#trackPositionMs`）。`now` 是浏览器的钟，`observedAt` 是设备（Mac / HomePod）的钟。
- 歌词逐字高亮。

### 年度图

在站点时区零点多出一格，有 2 秒宽限（use-site-day.ts）。

## 6 交付：图片、大陆访问、发版

第 06 章用到的部分按 main 7fcfacb 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

### 图片

- 页面、状态 API 和推送里的图片一律写同源 `/img/<objectKey>`（`src/lib/asset-url.ts#publicAssetPath`）。
- lyjw.me：由 `next.config.ts` 的边缘 rewrite 代理到 R2（只放行 64 位十六进制加 png / webp / jpg），带 rewrite 缓存。
- lyjw131.com：由 ESA 缓存同一路径。
- 图片是 immutable，内容变了名字就变，永远不需要刷新。

### 大陆访问

- lyjw131.com 经阿里云 ESA 回源 lyjw.me。
- 首页的 `Cache-Control: public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400`：5 分钟内直接命中；过期后先给旧页，后台回源。

### 发版

1. Vercel 生产部署成功。
2. GitHub Actions 调 ESA 刷新首页并预热。
3. 等两个域名的 `/api/version` 都答出新版：每个域名最多 30 次 × 10 秒。
4. 带 Access token 调 **ingress** 的 `POST /api/internal/site-deployed`。
5. ingress 经 RPC 调 `StateCore.broadcastVersion()`，进推送房间，不经 StateHub。同时让 collector 立刻重拉部署列表（`.github/workflows/purge-esa.yml#notify`；`workers/ingress/src/worker.ts#handleSiteDeployed`；`workers/api/src/state-core.ts#broadcastVersion`）。
6. 页面重问自己域名的 `/api/version`（`max-age=0, must-revalidate`），顶上弹出 UPDATE 卡。

页面另有兜底：每 30 分钟问一次，切回焦点也问一次（`src/hooks/use-app-version.ts#REFRESH_MS`）。

## 7 自适应调频

| 上报器 | 快 | 慢 | 怎么定 |
|---|---|---|---|
| PlayStation（n100 容器） | 主机醒着：`reporters/playstation-reporter/src/cadence.ts#AWAKE_TICK_INTERVAL_MS` | 休息或确认关机：`reporters/playstation-reporter/src/cadence.ts#IDLE_TICK_INTERVAL_MS` | 局域网发现包 UDP 9302，不问人数 |
| agents（限额） | 有人正看：5 分钟 | 只开在后台：10 分钟；没人：60 分钟 | `SITE_URL/count`，超时 2.5 秒 |
| 服务器（对照） | 60 秒 | 60 秒 | 不问 |

第 07 章用到的部分按 main 2489e10 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

- PlayStation 大约每 `reporters/playstation-reporter/src/cadence.ts#PROBE_INTERVAL_MS` 发一次发现包，只在该打的时候打 PSN。`HTTP/1.1 200` 是醒着，`620` 是休息，超时或别的回复先记一笔，连续 `reporters/playstation-reporter/src/cadence.ts#OFF_STREAK_TO_REST` 次才离开醒着。醒着和没醒对调立刻打一轮，休息和关机来回切不额外打。退避（`reporters/playstation-reporter/src/state.ts#backoffMs`）没到时这些都不放行。
  - `AWAKE_TICK_INTERVAL_MS` 是醒着那一档的间隔，不是两轮之间的下限：对调那一轮不等它（`reporters/playstation-reporter/src/cadence.ts#shouldRunTick`）。门只在每次探测时判，醒着时要等到过线之后的那一探，实际约每分钟一轮。
  - 下游的窗口都锚在闲档：站点判 PS 上报器断没断流用 `src/lib/freshness.ts#PLAYSTATION_STALE_MS`（闲档三轮多一点，只有浏览器判）。Pulse 玩那条道每次观测的有效期是 `shared/pulse-timeline.ts#GAMING_HOLD_MS`（盖过闲档再留投递抖动，`shared/pulse-timeline.ts#stateHoldMs`）：有效期内来了新观测，这一段就接着开，过期还没等到才在最后一次确认处收尾（`shared/pulse-timeline.ts#planStateObservation`）；容器每个完整 tick 都发 presence（`reporters/playstation-reporter/src/tick.ts#tick`），闲档一轮一封就接得上。主机醒着时只会更快，判活的下限由闲档决定。第 08 章不画这两个窗口。
- agents 的三档是 `reporters/agents-reporter/src/config.ts` 里 `cadence` 的默认值（容器 `.env` 可覆盖，线上值没记进 `docs/ops-facts.md`）。每跑完一轮才按当时的人数定下一次等多久；等的时候每 5 分钟醒来重查一次，人数多了立刻提前跑，人数少了不延后已定的那一次（`reporters/agents-reporter/src/cadence.ts#waitForNextRound`）。闲档 60 分钟 ÷ 5 = 12 次小睡。
- 服务器上报器固定每分钟推，不问人数：闲时每分钟问一次人数本身就不比直接推省（`reporters/server-reporter/src/config.ts` 的 `intervalMs` 注释）。夜里只有它的心形还在跳。
- agents 的人数查询失败就当 0，所以只会变慢，不会变快（`reporters/agents-reporter/src/cadence.ts#readAudience`）。PlayStation 不问这个数。

## 8 站点自检

第 08 章用到的部分按 main 2489e10 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

两个方向相反的信号：

- **Sentry 每分钟来敲门**：在线探测 HEAD `/api/version`，只说明 Vercel 还在出页面（`src/components/live/uptime-strip.tsx#UptimeStrip` 的注释）。探测配在 Sentry 侧，记在 `docs/ops-facts.md` 的「Sentry」一节，那一条标的是「核对于 未记录」。
- **Worker 每 5 分钟去报到**：api 分钟 cron 的整 5 分钟那一轮（见 §3「api 的分钟 cron」）。

Sentry 的结果由 **collector** 的 `sentry-status` 任务每 5 分钟取回（`workers/collector/src/jobs/sentry-status.ts#sentryStatusJob`），写进 `LAG` 的 `sentry:v1` 键，经 `/api/status/sentry` 上 LYJWPAGE 卡：两行，lyjw.me 是每分钟那次敲门、API 是 cron 的报到，各 30 天一天一格（`src/components/live/uptime-strip.tsx#UptimeStrip`、`src/lib/sentry-status.ts#UPTIME_DAYS`）。站点按每天的成功率给格子上色；片中只点亮今天那一格，不出可用率。

取数带的是 `SENTRY_API_TOKEN`，代码只拿它发 GET 查询（`src/lib/sentry-status.ts#sentryClient`）。令牌的权限范围是 Sentry 侧的配置：`workers/collector/README.md` 写的是组织只读（org:read / project:read / event:read），`docs/ops-facts.md` 没有这一条，**未核**。片中令牌只画成一张卡、标 `GET`，不说「只读」。

## 片中不用或待定

- **实测延迟**：上一版的「320–490 ms（8 月实测）」作废，因为中间多了一跳 Service Binding。上画面前要重测；没重测就不出数字。
- **按人数调频的只剩 agents-reporter**。PlayStation 按局域网发现包调频；片中不说几个上报器按人数调频，也不说节奏有几种。
- **Mac `postInterval`**：默认 10 秒，注释写的是「本机 30 秒」，未确认，片中不用。
- **HA 的配置**：不在仓库里。片中只讲它报什么，不讲怎么配。

## 顺带发现的过时文档与注释（不属于动画，另行处理）

- `README.md:143`：还写「读取 Worker 的聚合快照」。
- `next.config.ts`：cacheComponents 那段注释还说「首屏那八份数据」，提到的 `lib/home-snapshot` 已不存在。
- `src/lib/home-layout.ts:6-8`：还说「整页只有一个 'use cache' 条目」。
- `src/lib/status-views.ts:97`：说 pulse「按分钟轮询」，实际是 5 分钟。
- `workers/api/README.md:24`：说可滞后层端点「不过屏障」，实际所有公开读取都先等 `publicBarrier()`。
- `reporters/agents-reporter/README.md:180`：还让人设 `ONLINE_COUNTER_URL`，与第 228 行矛盾。
- `workers/ingress/README.md`：说「报文坏了也先回 503」，实际不是 JSON 直接回 400。
- iPhone README：`KNOWN_MODULES` 的路径写成 `workers/api/src/phone-telemetry.ts`，实际在 `shared/ingest/phone.ts:27`。
- `workers/online-counter`、`workers/ingest`、`workers/playstation-reporter`：三个目录只剩未跟踪的 `node_modules`。<!-- allow: 快照里点名的已退役目录，不在仓库 -->
- `workers/api/wrangler.toml:68`：注释说 D1「这里只增不删」，实际活动桶会按区间删掉重写（见 §3 D1 那节）。（34eb555 复核时发现）
- `reporters/agents-reporter/src/config.ts` 的 `cadence` 注释还说「与 PlayStation 共用人数分档逻辑」；PlayStation 看的是局域网发现包，不读人数（`reporters/playstation-reporter/src/cadence.ts#shouldRunTick`）。
