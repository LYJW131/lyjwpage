# 讲解动画 · 事实基线

> 类型：reference

按这份仓库里的代码核对，文档和代码不一致时以代码为准。动画里出现的每一个端点、数字、谁做什么，都要能在这里找到出处；架构改动时先改这份，再改分镜。

第 3 节里第 03 章用到的部分、第 2 节的 202 时机按 main 34eb555 逐条回代码复核过；其余各节的核对基线写在各节开头。 <!-- allow: 核对基线戳 -->

## 一句话总览

仍是三段：**采集 → 中枢 → 展示**。上报器（和 Claude Code 云端的 OTLP）向上报入口 POST；中枢在 Cloudflare Workers 上记状态；展示是 Vercel 上的 Next.js 出首屏，浏览器挂载后直连 Worker 取数、收 WebSocket 推送（`src/lib/backend-url.ts#backendUrl`）。第 00 章旁白「上报器发 POST，Workers 记状态，Vercel 出首屏，浏览器收推送」就是这一句。中枢由四个 Worker 组成：

- **ingress**：无状态的上报入口，负责鉴权、校验、分流。
- **api**：状态核心 `StateCore`（RPC 入口）加上 `StateHub` DO，以及推送房间 `LivePushRoom`。
- **collector**：每分钟一响的采集 Worker。
- **ai**：首页对话、访客构建和公开 MCP；不挂公开域名，api 按 `shared/ai-paths.ts#AI_HTTP_PATHS` 把这几条路径原样转给它，它经 Service Binding `PUBLIC_STATUS` 只读 api 的状态（`workers/ai/README.md`「入口与权限」、`workers/ai/wrangler.toml`）。它不在一首歌的链路上，片中在第 00 章总览、第 09 章「对话」和第 10 章发布里出现。

数据按层落地：实时层在 DO，可滞后层在 KV `LAG`，长期历史在 D1 `lyjwpage-history`，凭据在 KV `CREDENTIALS`。

片中叫法（画面标签和旁白都照这个）：账房是 `StateHub`，唯一的状态 DO，实时层存在它的 SQLite 里（`workers/api/src/state-hub.ts#StateHub`）；门外「照单去办」的是 `StateCore`，一个 `WorkerEntrypoint`，上报入口和采集 Worker 经 Service Binding 调它，它不是 DO（`workers/api/src/state-core.ts#StateCore`）；推送是另一个单例 DO `LivePushRoom` 上的 `/ws` WebSocket，全站一个房间（`workers/api/src/origin-worker.ts#LivePushRoom`）。上报器 = reporter；上报入口 = ingress Worker；采集 Worker = collector Worker；历史库 = D1；对象存储 = R2。

## 1 采集端

### 来源

下表里除 Claude Code 云端和 collector Worker 两行，每一行都是一个外部上报器；Claude Code 云端遥测（OTLP）不是我们写的上报器，另走一个入口。第 01 章开场的图纸索引按图号画七个小样：前五个图号是外部上报器所在的地方（第 3 号是家里的 Home Assistant 和 n100 上的 playstation-reporter，第 5 号是东京 misaka-jp 上的 server-reporter、agents-reporter、discord-reporter），第 6 号是云端遥测，第 7 号是采集 Worker。上报器和采集任务有几个，只按代码画，旁白和标注里不说。其中 n100 上的 playstation-reporter，把 presence、游玩列表和奖杯 POST 到同一个 `/api/ingest/playstation`。入口来源是 `shared/ingest/prepare.ts#INGEST_SOURCES` 那一份（playstation 是其中之一）；OTLP 走 `/api/ingest/agents/otlp`，不在这份清单里。Home Assistant 的 token 只开 homepod（`lyjwpage-home-assistant` 只有 `ingest:homepod`）。容器自己的 Access service token 是 `lyjwpage-playstation`，登记在 `workers/ingress/wrangler.toml#ACCESS_CLIENTS`，权限只有 `ingest:playstation`；`/playstation` 只认这一把。

第 01 章用到的部分（编码用量与 Tokens 道的口径、collector 的任务与节奏、PlayStation 与 Quest 上报器、Mac 信封的 90 秒和 400 ms）按 main 8534275 逐条回代码复核过。 <!-- allow: 核对基线戳 -->
FIG. 2 的 App 名、400 ms 的出处按 main a2c6e1c 回代码复核过；apple-recent 的两档与活跃档的拉取、FIG. 7A「没人上报的播放」按 cddbb5a 复核过。 <!-- allow: 核对基线戳 -->

| 来源 | 程序 / 在哪跑 | 入口 · token | 报什么 |
|---|---|---|---|
| Mac | Mac Telemetry Hub，菜单栏 App | `/api/ingest/mac` · `lyjwpage-mac` | 前台应用、窗口标题、Apple Music、充电设备、编码用量（本机的日行、最近一次用量事件、5 分钟 token 桶）、时区、Apple Music user token |
| iPhone | lyjwpage iOS App，HealthKit 唤醒：圆环按小时（`.hourly`；README 说这一条传 `.immediate` 也会被系统钳到 `.hourly`），训练申请 `.immediate`（`apps/ios/App/Hub/Modules/ActivityModule.swift#observe`、`apps/ios/App/Hub/Modules/WorkoutsModule.swift#startObserving`、`apps/ios/README.md` 的「什么时候会上报」） | `/api/ingest/iphone` · `lyjwpage-iphone` | 活动圆环、训练、五分钟步数桶 |
| Home Assistant | 家里 | `/api/ingest/homepod` · `lyjwpage-home-assistant` | HomePod 正在播放。不报 PS5 电源 |
| PlayStation | playstation-reporter，n100 上的容器 | `/api/ingest/playstation` · `lyjwpage-playstation` | presence、游玩列表、奖杯：拿本机的 PSN 登录态问 Sony 取来，用自己的 Access token 寄到站点。不发 `power` |
| Emby | emby-reporter，NAS 上的容器 | `/api/ingest/emby` · `lyjwpage-emby` | 在看什么；海报先传 R2 |
| 服务器 | server-reporter，东京 misaka-jp 容器 | `/api/ingest/server` · `lyjwpage-server` | 服务器状态，固定每 60 秒一次（`reporters/server-reporter/src/config.ts#intervalMs` 的默认值，容器 `.env` 可覆盖） |
| 编码账号 | agents-reporter，misaka-jp 容器 | `/api/ingest/agents` · `lyjwpage-agents` | 各家编码工具限额；Cursor 账号的用量日行、最近一次用量事件、5 分钟 token 桶 |
| Quest | discord-reporter，misaka-jp 容器：Bot 连 Discord Gateway，只取目标用户 `platform=meta_quest` 的 Playing（`reporters/discord-reporter/README.md`） | `/api/ingest/quest` · `lyjwpage-quest` | Quest 在玩什么：`{version:1, presence:{observedAt, discordStatus, playing}}`（`shared/ingest/quest.ts#prepareQuestReport`）。进实时层、推 `quest-now`（`src/lib/status-views.ts#STATUS_VIEWS` 的 `questNow`）；在玩时首页出现一张 Now Playing 卡（`src/components/live/quest-now-card.tsx`） |
| Claude Code 云端 | OTLP JSON（可 gzip），Claude Code 自己发，不是我们写的上报器 | `/api/ingest/agents/otlp` · `lyjwpage-claude-cloud` | 云端 token 与费用的累计值（只收 cumulative）；状态核心按序列做差，落成和另两个来源同形的日行、5 分钟桶、最近一次用量事件（`workers/api/src/stores/claude-cloud.ts`）。三处怎么合并见下文「编码用量」 |
| collector Worker | Cloudflare，cron 每分钟一响，任务表 `workers/collector/src/registry.ts#JOBS` 里的任务各按自己的节奏 | 不走 ingress | 见下文 |

PlayStation 的 presence、游玩列表和奖杯由 `reporters/playstation-reporter` POST 原始信封。采集 Worker 不拉 PSN，也不持有 PSN 凭据（`docs/ops-facts.md` 里采集 Worker 那一条）。PS5 电源没有来源上报，站点也不显示：PlayStation 信封带 `power` 字段会被入口拒收（`shared/ingest/playstation.ts#preparePlaystationReport`）。状态核心还留着一个没人调用、也没有新数据写入的只读接口 `playstationPower`（契约只加不改，`shared/state-core.ts#StateCoreRpc`），片中不画成活动的链路。

第 01 章 FIG. 3 画它：容器跟 PS5 在同一个局域网里，用 UDP 发现包探测主机状态（`reporters/playstation-reporter/src/probe.ts#probeOnce`），按醒着、没醒两档调整打 PSN 的频率（`reporters/playstation-reporter/src/cadence.ts#shouldRunTick`，展开见 §7）。两档对调时立刻打一轮，所以开机后第一探读到醒着，紧跟着问一轮 PSN、寄一封。主机醒没醒只由容器自己探测，只用来定它自己的节奏，不进信封（信封只有 presence、游玩列表、奖杯：`reporters/playstation-reporter/src/site.ts#PlaystationEnvelope`），也不画成 Home Assistant 给的。片中不出间隔的数。

三样凭据各管各的，片中分开画，不能混：

- **PSN 登录态**：存在容器的状态目录里（`reporters/playstation-reporter/src/state.ts#AUTH_KEY`，一个键一个文件，`reporters/playstation-reporter/src/store.ts#FileStore`），只在本机续期，只拿来调 Sony 的 PSN 接口（`reporters/playstation-reporter/src/auth.ts#AuthSession`、`reporters/playstation-reporter/src/psn.ts`）。不送到站点，站点也不用它鉴权。它在机器上的位置见 `docs/ops-facts.md`。
- **容器的 Access service token** `lyjwpage-playstation`：寄信封时放在 `CF-Access-Client-Id` / `CF-Access-Client-Secret` 两个头里（`reporters/playstation-reporter/src/site.ts#deliver`），只开 `/playstation`。
- **Home Assistant 的 token** `lyjwpage-home-assistant`：只开 `/homepod`（`workers/ingress/wrangler.toml#ACCESS_CLIENTS`），和 PlayStation 没有关系。

### Mac 信封

- 结构是 `{version:4, presence, heartbeatAt, activeModules, modules:{…}}`，`heartbeatAt` 是 epoch 毫秒；只带变了的模块（`reporters/mac-telemetry-hub/Sources/TelemetryCore/TelemetryEnvelope.swift#TelemetryEnvelope`、`reporters/mac-telemetry-hub/Sources/TelemetryCore/ReportDecision.swift#ReportDecision`、`shared/ingest/telemetry.ts#prepareTelemetryEnvelope`）。
- 没变化时每 **90 秒**发一个空信封报平安（`reporters/mac-telemetry-hub/Sources/TelemetryCore/ReportDecision.swift#heartbeatInterval`）。
- 切应用默认先等 **400 ms** 落定，是防抖：落定前再切一次就重新等；这个值能在 Hub 的设置页里调（`reporters/mac-telemetry-hub/App/MacTelemetryHub/AppSettings.swift#defaultDesktopSettleDelayMs`、同文件 `desktopSettleDelayRangeMs`）。片中写「默认先等 400 ms」。
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
- Pulse 多一条 Tokens 道：三个来源的 5 分钟桶全部相加，画的是 token 处理量（输入 + 输出 + 缓存写入，不含缓存读）在每个 5 分钟桶里的平均值，折成每分钟；它不是模型的生成速度（`src/lib/pulse.ts#tokensLaneView`）。卡上「此刻」那个数取最近 `TOKEN_CURRENT_MS`（10 分钟）内最后一个有用量的桶，不是此刻的精确值，口径问题还没修（同文件 `TOKEN_CURRENT_MS`）。
- 片中只讲到「三处各报原始数，站点这边合并，Pulse 上多一条 token 处理量（5 分钟平均）」，不点存储键和模块名；不说「生成速度」「每分钟生成」，也不说它是此刻的精确值。

### collector 的任务

- 节奏：每个任务登记「每 N 分钟、第 offset 分钟」（各任务的 `everyMinutes` / `offset`），cron 每分钟一响时挑出到期的一起跑（`workers/collector/src/schedule.ts#isDue`）。第 01 章表盘的时序图按这张表从整点起画 12 分钟；apple-recent 每分钟登记、任务里再分两档（下一节），表盘让它在 :05 那一轮看到列表变了：:00、:05 各一次，之后每分钟。
- 最近在听：apple-recent 任务，专辑 / 歌单粒度的列表交给 `CORE.commitRecentlyPlayed`。用的 user token 是 Mac 推进 `CREDENTIALS` 的那一份，形成一次凭据接力。
- GitHub、Vercel、Cloudflare、Sentry、PageSpeed、厂商状态：直接写 `LAG`；Vercel 部署列表那一轮另把站点部署记录写进 D1（`workers/collector/src/jobs/vercel.ts#vercelDeploymentsJob`、`workers/collector/src/history.ts#archiveSiteDeploys`）。第 01 章表盘的注只说「直接交给状态核心，或写 LAG」，不画 D1。
- PlayStation 不在这张表里。

### 没人上报的播放（第 01 章 FIG. 7A）

- iPhone、iPad、网页版等别的设备上放的 Apple Music 没有上报器：lyjwpage iOS App 只报活动与训练（`apps/ios/README.md`）。站点只能从 Apple Music 账号「最近播放的歌」的单曲列表推断（`workers/collector/src/jobs/apple-recent.ts#assembleRecentTracks`）。
- 拉取：apple-recent 在任务表里每分钟登记，任务里再分两档：闲时每 `IDLE_EVERY_MINUTES`（5）分钟拉一次；专辑列表或单曲列表有变就进活跃档，每分钟这一响里接着每 `ACTIVE_POLL_MS`（15 秒）再拉一次单曲列表，`ACTIVE_HOLD_MS`（10 分钟）里没再变才回闲档（同文件 `appleRecentDue`、`followRecentTracks`、`appleRecentJob`）。单曲列表连同拿到它的时刻交给 `CORE.commitRecentTracks`；回执里的 `nextBy`（照推断接着放、下一首最晚上榜的时刻）早于下一次拉时，提前到那一刻拉（`shared/pulse-listening.ts#nextTraceBy`）。片中只画每 15 秒一拉，不画按曲终补拉。
- 记痕迹：状态核心拿新列表和上一份比，新播的歌是新列表的前缀，一首记一行 `(since, t]`，带时长（`shared/pulse-listening.ts#playedBetween`、同文件 `listeningTraces`；`workers/api/src/stores/listening-pulse.ts#prepareRecentTracks`）。一首歌开播后 `LISTENING_TRACE_LAG_MS`（5.5 秒）排到列表最前，所以开播落在这两次拉取各减去这段滞后之间（上榜的抖动实测见 `docs/listening-inference-accuracy.md`，record；滞后按页面进度对照手机上的实际进度定）。片中说「开播几秒就排到最前」。
- 推断：连续播放的一串按时长对齐，每首的窗口减去前面各首的时长后都约束同一个开播，放宽一点余量求交取中点；不放宽时交集的半宽是理想误差（`marginMs`）；交集为空就另起一串；一首画到时长用完或下一首开播（`shared/pulse-listening.ts#inferredPlays`）。片中「后一首的窗口减去前一首的时长，和前一首的窗口求交」是它两首时的情形。
- 展示：Pulse 听歌道画成斜线段，悬停「Played elsewhere (estimated)」带开播误差，图例「Played elsewhere, estimated」（`src/lib/pulse.ts#stateLaneView`、`src/components/live/pulse-card.tsx`）。最后一首还没按时长放完、或放完还不到 `LISTENING_ELSEWHERE_HOLD_MS` 时，`listening/now` 带 `elsewhere`；Mac / HomePod 都没在放时，卡片标 Likely Playing（label-mono，界面上是大写），旁边虚线框里是这一首的理想误差，如「±3s」（`shared/pulse-listening.ts#playingElsewhere`、`src/lib/now-listening.ts#pickNowListening`、`src/components/live/listening-card.tsx#formatMargin`）。Mac / HomePod 在放同一首（歌名与艺人都对上）就不算别处播放（`shared/pulse-listening.ts#sameSong`）。
- 片中不出实测精度的数；示意里的分钟和开播时刻是示意，歌名和时长是 Apple 目录里的（Aimer 的 Ref:rain、残響散歌），页面卡片上的「±3s」是片中示意窗口算出来的理想误差。第一首的时长要让两次看到新歌都落在整分钟那次拉取上（配乐在 30:1、31:2 两拍有纸滑）。时间在推断开始前定格（一拍一分钟走下去，那首歌在片中已经放完）。暂停、拖进度、单曲循环不在列表里留痕，片中不讲。

## 2 上报入口（workers/ingress，`ingest.homepage.lyjw.llc`）

第 02 章用到的部分按 main 8534275 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

### 鉴权

- 走 Cloudflare Access service token，**每个上报方一把钥匙，只开权限表上写着的门**（`workers/ingress/wrangler.toml#ACCESS_CLIENTS`）。钥匙按上报方发：Home Assistant 那一把只开 homepod；`/playstation` 只有 n100 上 playstation-reporter 容器自己的一把，报 presence、游玩列表和奖杯，带 `power` 字段的信封拒收（`shared/ingest/playstation.ts#preparePlaystationReport`）；`/quest` 只认 misaka-jp 上 discord-reporter 的 `lyjwpage-quest`，权限只有 `ingest:quest`。第 02 章的门墙按 `shared/ingest/prepare.ts#INGEST_SOURCES` 一个来源一扇门，外加 `/agents/otlp`；权限表按 `ACCESS_CLIENTS` 一把钥匙一行，只写上报方名，不写 client id。验钥匙分三步：
  1. Access 在边缘先挡一道。
  2. Worker 再验 `Cf-Access-Jwt-Assertion`（RS256，校验 aud / iss / exp；`shared/access-jwt.ts#verifyAccessJwt`）。
  3. 用 `common_name` 查 `ACCESS_CLIENTS` 权限表。
- 结果码：无 JWT 回 401，越权（例如拿 Emby 的钥匙写 mac）回 403，验不了回 503（`workers/ingress/src/access-auth.ts#authorize`）。
- 共用 Bearer 密钥已退役（d7f9811）。

### 判定顺序（`workers/ingress/src/worker.ts#handleIngest`）

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

- Emby 海报在 prepare 里 HEAD R2 确认存在，带 5 分钟正缓存（r2-assets.ts:17）。回执里的 `missingImages` 告诉上报器还要补传哪些图：状态核心按 prepare 确认过的键算出，随 202 的 `data` 回给上报器（`workers/api/src/stores/emby.ts`、`reporters/emby-reporter/src/site.ts`）。

### 分流：一封上报按数据层拆成四路

| 路 | 去向 | 例子 |
|---|---|---|
| 实时 | `CORE.commitIngest` → StateHub | desktop、Apple Music、充电、编码、HomePod、PS、Emby、Cursor |
| 可滞后 | KV `LAG` | server（整封只走可滞后和归档两路）、限额、时区、圆环读数、训练列表、上报器账本 |
| 归档 | D1 `HISTORY` | 训练、圆环日读数、限额快照、服务器小时汇总 |
| 凭据 | KV `CREDENTIALS` | Mac 推来的 Apple Music user token |

- `server` 整封**不经过状态核心**：写 `LAG` 和上报器账本，另把小时汇总归档进 D1（`shared/ingest/prepare.ts#CoreCommand`；`workers/ingress/src/worker.ts#commitIngest`；`workers/ingress/src/ingest-archive.ts#ingestHistoryStatements`）。
- 四路都按自然键幂等，重发不会重复写。
- 谁来写：可滞后、归档、凭据三路由入口自己写；只有实时那一半交出去，给状态核心（下一节）。

### 实时那一半怎么交出去（Service Binding）

- `CORE` 是 Service Binding：`workers/ingress/wrangler.toml` 里 `[[services]]` 的 `service = "api"`、`entrypoint = "StateCore"`；入口 `await env.CORE.commitIngest(command)`（`workers/ingress/src/worker.ts#commitIngest`）。
- Cloudflare 内部调用，不走公网、不带凭据：只有声明了这个 binding 的 Worker 调得到，所以这一跳不再鉴权，鉴权只在入口做一次（`workers/api/AGENTS.md`「不变量」；`workers/api/src/state-core.ts#StateCore`）。
- 交过去的是 prepare 的产物 `PreparedIngest`，必须能结构化复制；状态核心只 import 它的类型，不 import 校验实现，所以改校验只发布入口（`workers/ingress/AGENTS.md`「不变量」；`shared/state-core.ts#StateCoreRpc`）。RPC 方法只加不改，api 与调用方分开部署（`workers/api/AGENTS.md`「不变量」）。
- `StateCore` 是 RPC 入口（`WorkerEntrypoint`），它把命令交给唯一的状态 DO `StateHub` 按到达顺序提交（§3），回 `CommitReply`：`ready: false` 时入口回 503；`ok: true` 的 `data` 原样放进 202；`ok: false` 回 400（`shared/state-core.ts#CommitReply`）。推送和首屏失效在 StateCore 自己的 waitUntil 里派发，不经入口（§3「效果清单」）。

### 202 的时机

**202 要等三样**，而且是依次等：StateCore 回执 → `LAG` 写完 → 凭据写完 → 回 202。D1 归档在拿到回执后、写 LAG 之前交给 waitUntil，不等，失败只记日志；凭据只在 mac 带来 Apple Music user token 时才写（`workers/ingress/src/worker.ts#commitIngest`）。所以 202 的意思是：实时层已在 StateHub 落账，LAG 和凭据已写；D1 归档、推送、首屏失效还在后台，入口不等。

失败时：状态核心没准备好回 503，上报器稍后重发；未就绪及标记为 retryable 的暂时故障回 503，其余校验或处理失败回 400，上报器整封重发；各路按自然键或整份覆盖写，重发不重复（`workers/ingress/src/worker.ts#commitIngest`、`workers/ingress/src/worker.ts#unavailable`）。

可滞后层的写入方（ingress、collector）没有 Vercel 密钥。写入时发现布局变了，就调 `CORE.revalidate(tags)` 请状态核心代发（同一函数）。

特例：iPhone 的训练收下了、圆环被拒时，已收下的那份照写，然后回 400。

### 好处

改校验只需要发布 ingress。DO 不重启，WebSocket 不断。

## 3 状态核心（workers/api）

### StateCore 与 StateHub

- `StateCore` 是 WorkerEntrypoint，ingress 和 collector 经 Service Binding `CORE` 调它。这条路不鉴权，因为边界鉴权只在 ingress 做一次（state-core.ts:15-37）。
- `StateHub` 是 DO（binding `STATE`，`idFromName("global")`），**唯一的状态 DO，全站只有一个实例**（state-core.ts:72-74）。推送房间 `LivePushRoom` 是另一个单例 DO（房间名 `global-apac`，首次创建时带 `locationHint: "apac"`，`workers/api/src/live-platform.ts#liveRoom`；binding 在 workers/api/wrangler.toml:52-55）。它的命名空间是从旧 ingest Worker 整体迁来的 SQLite 类（wrangler.toml:91-111），但代码不读写 SQL：每条连接的可见性记在各自的 attachment 上（origin-worker.ts:161-172）。
- 提交走 `ingestTail`，**排成一条队列逐个提交**（state-hub.ts:91-110）。进这条队的上报都经上报入口的 `CORE.commitIngest`（ingress worker.ts:134），PlayStation 那几封也走这条 HTTP 路。
- 四张表：`entries` / `fields` / `samples` / `metadata`（shared/sqlite-store.ts:17-23；state-hub.ts:29）。
- pulse 事实时间线也写在同一个库里，TTL 7 天（`PULSE_TTL_MS`，src/lib/limits.ts:32）。

### 效果清单

- **DO 不发网络请求，只交回「要做的事」**：`event` / `listening` / `tags` 三种（ingest-effects.ts:25-28）。
- StateCore 用自己的 `ctx.waitUntil` 执行这份清单，然后把结果回给 ingress（state-core.ts:30-37；live-platform.ts:12-17）：
  1. 先并行向 `LivePushRoom` 广播。
  2. 再把布局标签一次性发给 `POST {SITE}/api/revalidate`，5 秒超时（ingest-effects.ts:106-120；live-platform.ts:19、66-95）。
- 所以**广播和 202 是并行的**，不是 202 之后才广播。
- 效果在 StateHub 之外派发：`StateCore.commitIngest` 拿到 StateHub 交回的效果，交给 `dispatchIngestEffects`，后者经 `afterResponse` 放进 `ctx.waitUntil`；网络请求不占 StateHub 的执行时间，串行的提交队列不被推送和失效拖住（`workers/api/src/ingest-effects.ts#dispatchIngestEffects`、`workers/api/src/live-platform.ts#afterResponse`）。第 03 章旁白「网络请求不占 StateHub 的时间」出自这里。
- 换歌那封上报在交给 StateHub 之前，由 StateCore 查 Apple 目录补封面、链接、songId、有没有歌词和动态封面，结果随状态落库；推送和读取只用存好的这份（`workers/api/src/listening-enrichment.ts#enrichCommand`、`src/lib/track-enrichment.ts#candidateFrom`）。
- 各模块交回什么（workers/api/src/stores/telemetry.ts）：
  - **切应用**只交回一条 `desktop` 事件，不失效首屏：页头那一格定宽，换应用只换内容（354-355）。所以片中「切应用」不配「通知 Vercel」。
  - **换歌**交回 `listening`：StateCore 用提交时存好的补全拼出 `listening-now` 再广播（`workers/api/src/ingest-effects.ts#dispatchIngestEffect`）。只有开始或停止放歌才另失效在听那张卡的标签 `NOW_LISTENING_TAG`（telemetry.ts:392-393），换一首不失效。
  - iPhone 那一半只进 Pulse（五分钟桶和训练区间），不推送、不失效（phone-telemetry.ts:7-9、42-44）。
  - 清单里的通知（`event`、`listening`）先并行发完，再把所有标签合成一次失效（ingest-effects.ts:106-120）。

### 心跳不是什么都不做

纯心跳也会写：存活时间（workers/api/src/stores/telemetry.ts:186）、在听和 coding 各一笔 pulse 观测（450-451），外加遥测状态里的 `telemetryReceivedAt` 和 `activeModules`（456，字段见 46-73）；充电头模块开着时，还续一次充电头心跳和一笔充电采样（318-326）。片中只说「存活 + pulse 观测」，不说「三样」。它**不推送、也不失效首屏**。唯一的例外是在线 / 离线翻转：这时推 `presence`，并失效 3 个标签：页头、在听、充电头三张卡的 `DESKTOP_TAG` / `NOW_LISTENING_TAG` / `CHARGER_TAG`（同文件 199-202；src/lib/status-tags.ts:4-12）。

### 推送房间 `LivePushRoom`

- 地址 `/ws`（binding `LIVE_PUSH`，房间 `global-apac`；origin-worker.ts:463）。
- 事件的种类和载荷见 `src/lib/live-events.ts#LiveEvent`（片中不说几种）：`presence`、`version` 不带数据，`online` 带 `{online}`，其余都带数据。
- 用 Hibernation API：ping/pong 由运行时自动应答，不唤醒 DO（origin-worker.ts:185）。只有接入、断开、切换可见性、清扫闹钟这几件事会唤醒它。

### 在线人数（f6cda45 起并回推送房间，online-counter Worker 已退役）

- 同一条 `/ws` 同时数两种口径：
  - `connections`：开着的页面，含后台；静默 5 分钟不计，30 分钟关闭。
  - `online`：正在看的页面；心跳 30 秒，静默 90 秒不计，清扫 30 秒一次。
- 页面握手时带 `?visible=1`，切后台只发 `hidden`，不断开连接（origin-worker.ts:202；use-live-events.ts:283）。
- `/count` 一次返回 `{ok, connections, online}`；RPC 的 `audience()` 返回同样的两个数（live-census.ts；shared/state-core.ts）。
- 可见人数变了才广播 `online`；页面切后台只发一条 `hidden`，可见性记在各自连接的 attachment 上（`workers/api/src/origin-worker.ts#LivePushRoom` 的注释）。

### D1 长期历史 `lyjwpage-history`

- 表见 `workers/api/migrations/` 的 `CREATE TABLE`（片中不说几张），其中记归档水位的是 `pulse_archive_state`，冻结不再写、原样保留的旧表是 `pulse_samples`、`coding_token_buckets`、`agent_usage_days`（`workers/api/README.md`）。长期保存、不按时间清理。写入按自然键 upsert（`shared/history-ingest.ts` 的各 `…Statements`），活动桶会按区间删掉重写（`workers/api/src/pulse-archive.ts#DELETE_ACTIVITY_RANGE`），所以不能说「只增不删」。DO 里的 pulse 时间线只留 7 天。
- 写 D1 的有三方：上报入口（训练、圆环日读数、限额快照、服务器小时汇总）、采集 Worker（站点部署记录，`workers/collector/src/history.ts#archiveSiteDeploys`）、api（cron 每 5 分钟一轮的 pulse 归档，含编码用量的账本和 5 分钟桶；以及收下奖杯信封后的 `workers/api/src/stores/trophy-history.ts#archiveTrophies`）。
- 活动历史桶在入口量化（eb429ed），防止 HealthKit 的浮点抖动让 D1 每次重写整个 24 小时窗口。

### api 的 cron（`workers/api/src/index.ts#runScheduled`）

这一节和下面的「Pulse 事实时间线」是第 08 章用的，按 main 2489e10 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

- 每 5 分钟一轮，落在 UTC 每小时第 2、7、…、57 分（`workers/api/src/cron-heartbeat.ts#CRON_SCHEDULE`），先调一次 StateHub 的 `pulseTick` 同时拿到归档快照和评分任务，然后两件事并行：
  1. 把 pulse 归档到 D1：StateHub 给出一份有界快照（各路水位之后的新行）→ 按自然键 upsert 写事实表 → 成功后回头确认水位。各路独立，一路读坏、写坏不挡别的路（`workers/api/src/pulse-archive.ts#ARCHIVE_STREAMS`：三条状态道、在听的曲目痕迹、充电、活动桶、Coding 观测，加上编码用量的账本和 5 分钟 token 桶）。
  2. PulseScorer 经 Workers AI 绑定调 Clef（`@cf/cloudflare/clef`，`workers/api/src/pulse-score.ts#clefDecide`），**只给 Coding 打分**，一窗是 `shared/pulse-coding.ts#PULSE_SCORE_WINDOW_MS`（三个 5 分钟桶，15 分钟），窗结束两分钟后才打（`workers/api/src/pulse-score.ts#PulseScorer`）：
     - 交给 Clef 的是这一窗的特征：Mac 的前台应用与 agent 观测、容器里 Cursor 账号的活动，外加三个来源的 5 分钟 token 桶（Mac 本机扫描、Cursor 账号历史、Claude Code 云端遥测），按来源、agent、模型相加（同文件 `windowTokenUsage`）。Mac 扫描范围里缺的桶是测到的 0；另两个来源只作正证据，没有行不等于 0。
     - 全零的窗不问 Clef，直接记最低档：整窗都看得见、Mac 本机扫描盖满三个桶、没有任何活动和 token（同文件 `definiteZero`）。Mac 不在、只有 Cursor 看得见且没有活动时也不问，按半置信记最低档（`quietIndependentSource`）。一点观测都没有的窗不打分。
     - 每轮最多 36 个窗，从新到旧，每批并发 3，超时 10 秒。
     - 打分写回 StateHub 的评估列表，和 pulse 时间线一样只留 `src/lib/limits.ts#PULSE_TTL_MS`（`workers/api/src/pulse-score-state.ts#finishPulseScore`）；归档的各路（`ARCHIVE_STREAMS`）里没有它，**不进 D1**。第 08 章在 Clef 那一格上方注「打分只在屋里放 7 天，不进 D1」。
- 每一轮都包在 `Sentry.withMonitor` 里，向 `api-minute-cron` 报到（`workers/api/src/cron-heartbeat.ts#CRON_MONITOR_CONFIG`、`src/lib/sentry.ts#CRON_HEARTBEAT_EVERY_MINUTES`）。
- StateHub 的 `pulseTick` 调用失败时，本轮按失败报到；归档、打分和断流检查的子步骤各自 `.catch` 并记告警，不令本轮心跳失败，所以心跳不证明这些子步骤成功（`workers/api/src/index.ts#runScheduled`）。

### 闹钟

- StateHub 每小时清一次过期键；一轮删满 1000 条就 1 秒后接着删（state-hub.ts:153-160）。
- LivePushRoom 在有人可见时每 30 秒清扫一次。

### Pulse 事实时间线

- 时间线只存原始值，档位、颜色、摘要都在展示时现算（`shared/pulse-timeline.ts`）：三条状态道（听、看、玩）是状态区间，听那条另有从 Apple 最近播放推出的别处播放（§1「没人上报的播放」）；充电是实测瓦数样本；活动是 HealthKit 的五分钟步数桶加训练区间。
- Coding 不进这条时间线：它的三色带（前台是 coding 应用 / 有 agent 在跑 / 两者同时）读的时候从 Mac 的观测和 Cursor 账号的观测现算（`shared/pulse-coding.ts#codingBand`）；Clef 的打分只出现在悬停提示里。
- Tokens 道：三个来源的 5 分钟 token 桶读的时候相加，画每个桶的 token 处理量（输入 + 输出 + 缓存写入，不含缓存读）的 5 分钟平均，折成每分钟；不是生成速度，「此刻」那个数的口径见 §1「编码用量」（`src/lib/pulse.ts#tokensLaneView`）。
- Pulse 卡的道按 `src/components/live/pulse-card.tsx#LANES`，写章时从上到下是 Coding、Tokens、Listening、Watching、Gaming、Charging、Activity（第 08 章的地层照这个顺序一层一层画，旁白不说几条）；卡上画最近 24 小时（`src/lib/limits.ts#PULSE_WINDOW_MS`），屋里留 7 天（`PULSE_TTL_MS`），D1 长期保存。

## 4 首屏（Vercel 上的 Next.js）

第 04 章用到的部分按 main 7fcfacb 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

### 按卡缓存

- `/api/home` 已删除（8977457）。首屏按视图并行调 `firstScreen(key)`，一个视图一次（按 e10a75a 现数 **27 次**），外加头像和最近提交；第二轮再取图标内联、封面占位和歌词（`src/app/page.tsx#Home`）。一张卡读几个视图就有几条缓存，卡与视图的对应见 `src/app/page.tsx#READS`。
- 每张卡读自己的 `/api/status/*`：实时卡读 DO，可滞后卡读 `LAG`（`src/lib/first-screen.ts#firstScreen`）。
- 实时层的公开读取在 `StateHub.publicRead()` 里随读取一起过初始化与提交可见性屏障，每次读一个 RPC；可滞后层只读 KV，不过屏障、不唤醒 DO（`workers/api/src/public-execution.ts#executePublicRequest`）。
- **每张卡一条 `'use cache'`**，cacheLife 为 stale 300 / revalidate 600 / expire 7 天（`src/lib/first-screen.ts#firstScreen`）。歌词另是 300 / 3600 / 86400（`src/lib/first-screen.ts#firstScreenLyrics`）。
- 标签：按 e10a75a 现数 20 个视图挂 `page:` 标签；另有 7 个视图不带标签（GitHub 两份、Vercel、Cloudflare、Sentry、上报器账本、pulse），只靠 600 秒定时重建（`src/lib/status-views.ts#STATUS_VIEWS`）。
- 一个标签失效，只让那张卡回源；整页在后台重建，旧页照给（`revalidateTag(…, "max")`，status-revalidation.ts:5）。
- 请求路径上不现拉外部 API：每条缓存只读自己的状态端点（实时读 DO，可滞后读 KV），GitHub、Sentry 这些外部来源只由采集 Worker 定时去取（按卡读取见 `src/lib/first-screen.ts#firstScreen`，端点的数据层与读取实现见 `src/lib/status-views.ts`、`src/lib/status-loaders.ts`）。
- 失效通知只带标签名、不带数据：数据已经落在 Worker 上，下一次读端点自己去拿（校验只接受 `tags`：`src/lib/revalidate-request.ts#parseRevalidateRequest`、`src/app/api/revalidate/route.ts#POST`）。`revalidateTag(tag, "max")` 只把条目标成过期，下一次有人访问时先给旧的、后台重建（Next.js 文档 revalidateTag 一页，profile 取 "max" 的行为）。
- 标签只为布局变化而发：首屏版面变了（例如在线 / 离线翻转、充电头接上或拔下、开始或停止放歌）才通知 Vercel；只变内容的交给 cacheLife 的 revalidate 600 秒定时重建（布局判据见 `src/lib/home-layout.ts`，写 KV 的一方在 `workers/ingress/src/lag-ingest.ts#commitLagIngest` 返回要失效的标签；内容更新周期见 `src/lib/first-screen.ts#FIRST_SCREEN_CACHE_LIFE`）。
- cacheLife 三个值（Next.js 文档 cacheLife 一页）：stale 是浏览器端路由缓存不问服务器就直接用的时长；revalidate 是过了这个时长后，下一个请求先拿旧的、服务端在后台重建；expire 是没人访问时的上限，过了就同步重建。
- 第 00 章把首屏画成浏览器窗口里的线框：卡片框按 `src/app/page.tsx#Home` 的版面，尺寸取第 04 章 P 表（`docs/explainer/v2/ch04.js#P`）的比例；P 表注明是按 lyjw.me 桌面宽度实测的卡片框乘 0.6，那次实测未核。Media 下面是整行的 Talk to God 对话卡（`src/app/page.tsx#SLOT` 的 `godChat`），线框画到它就被窗口下沿切掉；它不读状态视图，没有 `firstScreen` 缓存，所以第 04 章的印版里没有它。画的那一刻没在充电：充电那一格收起、「最近播放」占满一行（`src/components/live/media-pair.tsx#LiveMediaPair` 不在充电时加 is-disconnected，`src/app/globals.css` 在桌面宽度下把这时的最近播放左边贴到 0）。卡上的标注照站点原文（`src/components/live/listening-card.tsx` 的 Recently Played、Now Playing）；界面上是大写，因为 `src/components/ui/card.tsx#Card` 的标签用 label-mono，它在 `src/app/globals.css` 里是 text-transform: uppercase。

### 来源出问题时

- Worker 降级：回 `ok:false` 加 HTTP 200。
- 404：显示 "Status unavailable"。
- 5xx 或网络错误：抛出，Next **继续用上一份缓存**（`src/lib/first-screen.ts#firstScreen`）。

## 5 浏览器

第 05 章用到的部分按 main 7fcfacb 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

### 早开连接

- head 里的内联脚本解析到它时就 `new WebSocket("wss://…/ws?visible=1")` 起手，把收到的消息原样攒下：最多 `EARLY_LIVE_SOCKET_QUEUE_LIMIT` 条（50），没人接手就在 `EARLY_LIVE_SOCKET_WATCHDOG_MS`（15 秒）后自己关（`src/lib/live-socket-boot.ts#earlyLiveSocketScript`）。
- 这样**不用等整棵树 hydrate 完**才发起连接。hydrate 后由 `useLiveEvents` 接管这条连接，攒下的按到达顺序重放（`src/hooks/use-live-events.ts#adoptEarlySocket`）。接管的是同一条 WebSocket，不重新握手：`adoptEarlySocket` 从 `window` 上摘下内联脚本那条连接，卸掉它的 handler 后直接用；只有它还在 CONNECTING 或 OPEN 时才接管，已经断了就关掉，由 `open` 重新建一条。房间在连上的那一刻就发一条 `online` 人数，所以托盘里通常至少有这一封。
- 代码里不记实测延迟，注释只讲为什么要早开。**片中不标毫秒**，时间轴只画先后；要标得先重测。
- 重连退避从 1 秒起、每次 ×1.5，封顶 30 秒，每轮在上半截随机抖动；连接撑过 `STABLE_CONNECTION_MS` 才清零（`src/lib/live-reconnect.ts`）。重连后带推送事件的视图补取一次；页面在后台时只记待补，回到前台再取（同文件 `open` 里的 `onReady` 与 `catchUpIfPending`）。

### 推送进卡片

- 带数据的事件按 `src/hooks/use-live-events.ts#FORWARDS` 直接 `mutate(path, data, {revalidate:false})` 写进对应的 SWR 键，卡片当场更新：desktop、listening-now、listening、watching-now、watching、playing-now、quest-now、playing、trophies、charger、powerbank、coding-now。事件名到端点的对应登记在 `src/lib/status-views.ts#STATUS_VIEWS`。
- `online` 只写页脚的人数；`presence`、`version` 不带数据，只让几张卡重取（同文件的 `INVALIDATIONS`；presence 重取的是 Mac 供数的几张，含 coding-now）。
- 时间戳挡旧：推送先经 `acceptPush` 登记这一代，轮询回来经 `guardPolled` 比，慢回来的旧数据盖不掉新的（`src/lib/status-reads.ts#guardPolled`）。带单调戳的只有 quest-now、desktop、listening、listening-now、powerbank、trophies（同文件的 `STAMPS`），listening-now 比的是 `receivedAt`。

### 取数节奏（`src/lib/poll-schedule.ts`）

- 实时卡的间隔由卡片组件自己给（各组件里 `REFRESH_MS` 一类常量）：
  - 充电头、充电宝：30 秒
  - desktop：60 秒
  - 编码此刻（coding-now）：2 分钟；编码用量（coding）和年度（coding/year）在可滞后层，按下面的 due 取（`src/lib/status-views.ts#STATUS_VIEWS`）
  - pulse：5 分钟
  - 在听 / 在看 / 在玩「此刻」：60 秒
  - 列表类和奖杯：10 分钟（在听列表空着时 60 秒）
- 推送连着、且视图登记了 `pushCovers`（listening、watching、watching-now、playing、playing-now、trophies）时，间隔取 `max(cardMs, PUSH_SAFETY_NET_MS)`，也就是不快于 5 分钟的兜底（`src/lib/poll-schedule.ts#realtimeInterval`）：真被放宽的只有 60 秒的「此刻」卡（watching-now、playing-now）和空着的在听列表，10 分钟的列表和奖杯不变。desktop、充电头、充电宝、listening-now、编码没登记 `pushCovers`，照旧按自己的间隔。
- 可滞后卡不固定轮询，在 `due = updatedAt + cadenceMs + LAG_GRACE_MS`（15 秒）时去取，也就是「下一次预期写入」之后一点；过了 due 还没取到更新的，从 `LAG_MIN_RETRY_MS`（15 秒）起退避，封顶 min(节奏, `LAG_MAX_RETRY_MS`)（5 分钟；`src/lib/poll-schedule.ts#nextLagDelay`）。
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
- 首屏新鲜度不靠 ESA 这一层：ESA 给的可能是一份旧 HTML，浏览器挂载后经 SWR / WebSocket 直接向 Worker 取最新状态（根 `README.md`「首屏快照与实时更新分开处理」；缓存头数值在 `next.config.ts` 首页那条 `Cache-Control`；浏览器直连 Worker 见 `src/lib/backend-url.ts#backendUrl`）。第 06 章旁白「数据在挂载后直连 Worker 取新」出自这里。

### 发版

部署成功之后刷新 ESA、等两个域名换上新版、通知开着的页面，事实只写在 §10「部署成功之后：刷新 ESA、通知页面」，片中由第 10 章「发布」讲；第 06 章只讲请求时的分发与缓存。

## 7 自适应调频

| 上报器 | 快 | 慢 | 怎么定 |
|---|---|---|---|
| PlayStation（n100 容器） | 主机醒着：`reporters/playstation-reporter/src/cadence.ts#AWAKE_TICK_INTERVAL_MS` | 休息或确认关机：`reporters/playstation-reporter/src/cadence.ts#IDLE_TICK_INTERVAL_MS` | 局域网发现包 UDP 9302，不问人数 |
| agents（限额） | agent 在用：5 分钟 | 都没在用：60 分钟 | `SITE_URL/api/status/coding/now`，不问人数 |
| 服务器（对照） | 60 秒 | 60 秒 | 不问 |

第 07 章用到的部分按 main e10a75a 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

- PlayStation 大约每 `reporters/playstation-reporter/src/cadence.ts#PROBE_INTERVAL_MS` 发一次发现包，只在该打的时候打 PSN。`HTTP/1.1 200` 是醒着，`620` 是休息，超时或别的回复先记一笔，连续 `reporters/playstation-reporter/src/cadence.ts#OFF_STREAK_TO_REST` 次才离开醒着。醒着和没醒对调立刻打一轮，休息和关机来回切不额外打。退避（`reporters/playstation-reporter/src/state.ts#backoffMs`）没到时这些都不放行。
  - `AWAKE_TICK_INTERVAL_MS` 是醒着那一档的间隔，不是两轮之间的下限：对调那一轮不等它（`reporters/playstation-reporter/src/cadence.ts#shouldRunTick`）。门只在每次探测时判，醒着时要等到过线之后的那一探，实际约每分钟一轮。
  - 下游的窗口都锚在闲档：站点判 PS 上报器断没断流用 `src/lib/freshness.ts#PLAYSTATION_STALE_MS`（闲档三轮多一点，只有浏览器判）。Pulse 玩那条道每次观测的有效期是 `shared/pulse-timeline.ts#GAMING_HOLD_MS`（盖过闲档再留投递抖动，`shared/pulse-timeline.ts#stateHoldMs`）：有效期内来了新观测，这一段就接着开，过期还没等到才在最后一次确认处收尾（`shared/pulse-timeline.ts#planStateObservation`）；容器每个完整 tick 都发 presence（`reporters/playstation-reporter/src/tick.ts#tick`），闲档一轮一封就接得上。主机醒着时只会更快，判活的下限由闲档决定。第 08 章不画这两个窗口。
- agents 的两档是 `reporters/agents-reporter/src/config.ts` 里 `cadence` 的默认值（容器 `.env` 可覆盖，线上值没记进 `docs/ops-facts.md`）。每跑完一轮才按 agent 最近一次使用定下一次等多久（`reporters/agents-reporter/src/cadence.ts#ACTIVE_WINDOW_MS` 内算在用）；等的时候每 5 分钟醒来重查一次，开始使用立刻提前跑，停用不延后已定的那一次（`reporters/agents-reporter/src/cadence.ts#waitForNextRound`）。闲档 60 分钟 ÷ 5 = 12 次小睡。「在用」是最近一次使用落在 `ACTIVE_WINDOW_MS` 之内（写章时 15 分钟），读的是取限额的几家 agent（`reporters/agents-reporter/src/config.ts` 的 `agentIds`）在 `coding/now` 里的 `lastActivityAt`（同文件 `latestActivityAt`）。第 07 章按这个窗口排：停手后那两轮仍是 5 分钟，过了窗口才换 60 分钟。
- 服务器上报器固定每分钟推，不问人数：这份快照本身就是心跳，站点按信封的 `updatedAt` 判它还活着没有；上报不经过 Vercel，没有函数调用量要省，闲着时先问一次人数比直接推一次还费（`reporters/server-reporter/README.md`「节奏」）。夜里只有它的心形还在跳。
- 限额那一台按 agent 使用情况调频，是因为每一轮都要打各家厂商的限额接口，限额只在用的时候变（`reporters/agents-reporter/README.md`「它做什么」的每轮流程与 `reporters/agents-reporter/src/cadence.ts#waitForNextRound`）。
- agents 的活动查询读不到、超时、格式不对一律当没在用，所以故障只会让它变慢，不会变快（`reporters/agents-reporter/src/cadence.ts#nextDelay`）。PlayStation 和服务器都不问人数。

## 8 站点自检

第 08 章用到的部分按 main 2489e10 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

两个方向相反的信号：

- **Sentry 每分钟来敲门**：在线探测 HEAD `/api/version`，只说明 Vercel 还在出页面（`src/app/api/version/route.ts#GET`）；后端那一截看 api Worker 的 cron 心跳（`workers/api/src/index.ts#runScheduled`）。探测配在 Sentry 侧，记在 `docs/ops-facts.md` 的「Sentry」一节，那一条标的是「核对于 未记录」。
- **Worker 每 5 分钟去报到**：api cron 的每一轮（见 §3「api 的 cron」）。

Sentry 的结果由 **collector** 的 `sentry-status` 任务每 5 分钟取回，页面和首屏都不直连 Sentry，只读可滞后层里的这份结果（`workers/collector/src/jobs/sentry-status.ts#sentryStatusJob`），写进 `LAG` 的 `sentry:v1` 键，经 `/api/status/sentry` 上 LYJWPAGE 卡：两行，lyjw.me 是每分钟那次敲门、API 是 cron 的报到，各 30 天一天一格（`src/components/live/uptime-strip.tsx#UptimeStrip`、`src/lib/sentry-status.ts#UPTIME_DAYS`）。站点按每天的成功率给格子上色；片中只点亮今天那一格，不出可用率。

取数带的是 `SENTRY_API_TOKEN`，代码只拿它发 GET 查询（`src/lib/sentry-status.ts#sentryClient`）。令牌的权限范围是 Sentry 侧的配置：`workers/collector/README.md` 写的是组织只读（org:read / project:read / event:read），`docs/ops-facts.md` 没有这一条，**未核**。片中令牌只画成一张卡、标 `GET`，不说「只读」。

## 9 对话与构建（workers/ai）

第 09 章「对话」用的部分，按 main 897c83d 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

不在一首歌的链路上：对话只读 api 给浏览器的同一份公开模型，不往状态里写东西。

### 发第一句之前

- 访客发第一条消息时，卡片先在本地回一段隐私说明，逐条列出对话数据的去向（Cloudflare Workers、Turnstile、Workers AI 的 Clef、Anthropic、Sentry、GitHub、这个浏览器等）；点 Accept 之前不加载 Turnstile、不发任何请求（`src/components/god-chat.tsx#ConsentPrompt`、`CONSENT_COPY`）。同意记在浏览器里，对话代码一改就要重新同意（`src/lib/chat-consent.ts`、`scripts/chat-code-version.mjs#CHAT_CODE_PATHS`）。

### 过闸（花钱之前）

- 浏览器经 api 转发到 ai Worker（`shared/ai-paths.ts#AI_HTTP_PATHS`）。先验人：通行证（验过人后按 IP 签发、有效期 `shared/god-chat.ts#GOD_CHAT_PASS_TTL_MS`）或 Turnstile（`workers/ai/src/chat/pass.ts`、`turnstilePassed`）。
- 再过 `ChatQuota.admitVisitor` 三道：访客总量、全站路由次数（`shared/god-chat-tiers.ts#GOD_CHAT_ROUTE_LIMIT`）、这位访客此刻至少有一档访客与全站都有空位；挡下回 429，到此为止，不再付费调 Clef（`workers/ai/README.md`「首页对话」）。数值在 `shared/god-chat-tiers.ts#GOD_CHAT_QUOTA`，片中不出数。

### Clef 选档

- Clef 是 Workers AI 上的路由模型（`workers/ai/src/chat/router.ts`，`CLEF_CHOICES`）：Haiku（两种思考强度）、Sonnet、设计、Fable、refuse；Clef 不可用时落到 `ROUTER_FALLBACK`（Haiku）。
- 三档与人设：Haiku · Small Fry、Sonnet · Prophet、Fable · God；设计会话里的 Opus 是 Architect（`shared/god-chat-tiers.ts#GOD_CHAT_TIER_INFO`）。选中的档满了只往下逐档降，绝不往上升（`shared/god-chat-tiers.ts#downgradeChain`）。refuse 不调模型，直接回一句关门话。
- Haiku 判断问题超出自己时调 `request_upgrade`，扣到 Sonnet 名额就由 Sonnet 重答（`workers/ai/src/chat/handler.ts#UPGRADE_TOOL`）。

### 工具与盖章

- 站点工具 `workers/ai/src/tools/registry.ts#SITE_TOOLS` 只读公开模型：`get_site_status` 经 `PUBLIC_STATUS.readStatus(path)` 调 api 的 `PublicStatus`，和浏览器看到的同一份（`shared/public-status.ts#PublicStatusRpc`）。`show_card` 只在对话里，用同一份数据在回复里画站点卡片。
- 同一套 `SITE_TOOLS` 挂在无鉴权的 `POST /mcp` 上给外部 AI 客户端用（`workers/ai/src/mcp.ts`）；要访客确认的、只对对话界面有意义的工具不在 `/mcp`。
- 回复正常结束时 Worker 给这一问一答盖章（`workers/ai/src/chat/seal.ts`），浏览器原样带回；下一轮进 Clef 和模型之前先验章，没有章或对不上的整对丢掉。片中把这一步画成一枚章。

### 设计会话

- 站点改动请求由 Clef 交给 Sonnet；Sonnet 觉得值得做才调 `start_design`，在 Claude Managed Agents 上开一个会话，同一条回复交给其中的 Opus 规划者（`workers/ai/src/chat/designer.ts`、`docs/build-routine.md`「设计与确认」）。
- 规划者只读：沙盒只放行 github.com、不挂凭据，write / edit 关闭，用 read、glob、grep 和只读命令查仓库；用 `ask_visitor` 提问、`propose_build` 出计划（标题、规格、验收项、预计路径），计划由 Worker 校验后签名（`workers/ai/AGENTS.md`「不变量」、`workers/ai/src/build/validation.ts`）。
- 计划卡两个出口：Open issue、Start build。点之前每次都展开 GitHub 授权说明，接受才弹授权窗口，同意不保存（`src/components/github-consent.tsx#GithubConsent`）。访客的 GitHub token 用完立即撤销。

### 构建

- Start build：Worker 用 GitHub App 把签名计划写成 `builds/<runId>.md`，提交到分支 `claude/build-<runId>`（`shared/build-routine.ts#branchForRun`）并开草稿 PR，再把计划交给 routine（Claude Code）去写代码（`docs/build-routine.md`「上传与 PR」）。
- routine 不持有仓库推送凭据：改动回传 Worker，校验路径与大小后由 GitHub App 提交到同一分支和 PR（`workers/ai/src/build/validation.ts`）。PR 上的 Claude 审查只作参考，不授权合并（`workers/ai/AGENTS.md`）；合不合并由站长决定。
- 片中不画：计划令牌与额度的消费细节、截图上传、构建状态的恢复。

## 10 发布（推到 main 之后）

第 10 章「发布」用的部分，按 main 8534275 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

一次 `git push origin main` 同时触发几条流水线：GitHub Actions 的几个工作流、Vercel 的 Git 集成、Cloudflare Workers Builds 的原生 Git 集成（`docs/workers-builds.md` 开头）。它们各自决定跑不跑、各自构建，互不等待。片中举的那次推送改到 `src/components/`、`workers/api/`、`reporters/server-reporter/` 下的文件和 Hub 的子模块指针，是示意，不对应真实提交；画面上的短哈希也是示意。

### 检查：CI 与 CodeQL（只检查、不发布）

- CI：推 main 或 dev、开 PR 都跑，一个 job 依次跑 lint、全部工作区的 typecheck、站点单测、api / ai / ingress / collector 的单测、上报器单测、`scripts` 的测试、`pnpm docs:check`（`.github/workflows/ci.yml#check`）。
- CI 不跑 `next build`：Vercel 每次推送都会构建，CI 只管 Vercel 覆盖不到的几件事（`.github/workflows/ci.yml#check`）。同一分支连推几次，只留最后一次（同文件的 `concurrency`，`cancel-in-progress`）。
- CodeQL：推 main 或 dev、开 PR，外加每周一次定时，扫 `javascript-typescript` 和 `actions` 两类（`.github/workflows/codeql.yml#analyze`）。

### 站点：Vercel

- 生产随 main 自动部署是 Vercel 控制台的配置，记在 `docs/ops-facts.md` 的「Vercel」一节。构建命令 `pnpm build` 跑 `scripts/build.mjs`：先生成讲解片的静态页，再 `next build`。
- 部署只发生在 Vercel：`lyjw131.com` 经阿里云 ESA 回源 `lyjw.me`（§6「大陆访问」）。
- 构建不过就没有新部署，域名上仍是上一版：`/api/version` 由此刻接管生产域名的那次部署自己回答（`src/app/api/version/route.ts#GET` 的注释）。

### Worker：Cloudflare Workers Builds

- api、ai、ingress、collector 各连一个 Workers Builds 项目，生产分支 main：构建命令是各自的 typecheck，部署命令是 `wrangler deploy`（`docs/workers-builds.md`「构建配置」）。
- 各按自己的监视路径决定这次构建不构建（`docs/workers-builds.md`「构建监视路径」）：四个都盯根目录的依赖与配置文件，另各盯自己的 `workers/<名字>/*`；api、ingress、collector 还盯 `shared/*`、`src/lib/*`（各自排除对话与构建那几份 `shared/` 文件），ai 只盯它点名的几份 `shared/`、`src/lib/` 文件；api 另排除 `shared/ingest/*`，所以改上报校验不会重新发布带 Durable Object 的 api，页面的 WebSocket 也不断。片中那次推送只改到 api 的目录，ai、ingress、collector 这次不构建，线上仍是上一版。
- Workers Builds 并行构建、不保证先后，Worker 之间的 RPC 契约只加不改，被调用方先上线（根 `AGENTS.md`「部署流程」；契约定义在 `shared/state-core.ts#StateCoreRpc` 与 `shared/collector.ts#COLLECTOR_JOBS`）。跨 Worker 的契约切换靠手动按序部署，片中不画。
- 片中不画：api 的分支 Preview、ingress 与 collector 关掉预览构建的原因、D1 迁移要先手动 apply（都在 `docs/workers-builds.md`）。

### 上报器：GHCR 与 GitHub Release

- 容器上报器：`.github/workflows/build-reporters.yml#changes` 用 paths-filter 挑出改了的目录；`.github/workflows/build-reporters.yml#build` 只出 `linux/amd64`，合进 main 时打 `latest` 和 `sha-<短哈希>` 推到 GHCR，PR 只 build 不推；`.github/workflows/build-reporters.yml#deploy` 只管 misaka-jp 上的服务：用一把只能执行部署脚本的密钥 ssh 过去，点名 pull、只重建那一个，新容器跑稳后删掉旧镜像（`reporters/misaka-deploy.sh`），再验 `status=running restarts=0`，server-reporter 另验镜像里烧进的提交就是这一版。
- dsm（emby-reporter）和 n100（playstation-reporter）在内网，Actions 够不着，按各自 README 手动更新（根 `AGENTS.md`「部署流程」）。dsm 那台现在还是现场 build（`docs/ops-facts.md`「机器与部署位置」），所以片中不说「机器只拉镜像」。
- Mac Telemetry Hub：`reporters/mac-telemetry-hub` 是子模块，main 上的指针一动，macOS runner 就用 Developer ID 签名、`notarytool` 公证、`stapler` 钉上票据，发成本仓库的 Release `hub-build-<运行号>`（`.github/workflows/release-mac-telemetry-hub.yml#release`）；PR 上只走到公证、不发布；没配签名 secret 时整个 job 跳过。

### 部署成功之后：刷新 ESA、通知页面

- Vercel 的生产部署成功后，GitHub 上的 `deployment_status`（state 为 success、environment 为 Production）触发 `.github/workflows/purge-esa.yml`：
  1. `.github/workflows/purge-esa.yml#purge`：调 ESA 的 `PurgeCaches` 刷掉 `lyjw131.com` 首页的缓存键，再 GET 一次预热（`scripts/run-esa-purge.mjs`、`scripts/esa-purge.mjs#purgeEsaHomepage`、`scripts/esa-purge.mjs#warmupEsaCache`）。
  2. `.github/workflows/purge-esa.yml#notify`（等刷新完）：先等 `lyjw.me`、`lyjw131.com` 的 `/api/version` 都答出这次部署的 sha，每个域名最多 30 次、每次隔 10 秒；等不到也照常通知，最坏只是不弹提示。先刷新再通知，是因为反过来的话 lyjw131.com 的访客点刷新拿回的还是旧 HTML（同文件里那段注释）。
  3. 带 `lyjwpage-github-actions` 那把 Access service token 调上报入口的 `POST /api/internal/site-deployed`，这把只有 `internal:site-deployed` 权限（`workers/ingress/wrangler.toml#ACCESS_CLIENTS`）；失败重试，最长 10 分钟（`--retry-max-time 600`），理由是同一次推送也改了 api 时，Workers Builds 往往比 Vercel 晚上线。
- 上报入口验过权限，经 Service Binding 调 `StateCore.broadcastVersion()`（`workers/ingress/src/worker.ts#handleSiteDeployed`、`workers/api/src/state-core.ts#broadcastVersion`）：直接交给推送房间、不经 StateHub，LivePushRoom 向所有连着的页面广播 `version`，不带数据（`payload` 为 null）；另在 `waitUntil` 里请 collector 立刻重拉部署列表（`workers/ingress/src/worker.ts#DEPLOYMENT_JOBS`，片中不画）。
- 页面收到 `version` 只重问自己域名上的 `/api/version`，不信推来的版本号（`src/hooks/use-live-events.ts#INVALIDATIONS`）；这个接口是构建期常量，头是 `max-age=0, must-revalidate`（`next.config.ts` 的 headers），拿它和页面构建时焊进的 sha 比（`src/lib/app-version.ts#resolveVersionStatus`）。
- 比出来旧了：前台只弹 UPDATE 卡，刷不刷交给人（`src/components/app-version-card.tsx#AppVersionCard`）；后台标签页自己刷新（`src/components/stale-tab-reload.tsx#StaleTabReload`、`src/hooks/use-stale-auto-reload.ts#useStaleAutoReload`），有几道闸：同一个目标版本一轮最多试 `AUTO_RELOAD_MAX_TRIES` 次、两次自动刷新之间冷却 `AUTO_RELOAD_COOLDOWN_MS`、网页播放器在放不刷、sessionStorage 用不了不刷（`src/lib/app-version.ts#autoReloadDecision`）。片中只画「前台弹提示、后台自己刷新」。
- 收不到通知也有兜底：页面每 30 分钟问一次，切回前台时再问一次（`src/hooks/use-app-version.ts#REFRESH_MS`）。

### 不在这条发布链上（核过，片中不画）

- `.github/workflows/deploy-pages.yml`：`docs/` 有改动时把它发到 GitHub Pages（架构图页），和站点无关。
- `.github/workflows/preview-api-worker.yml`：PR 关闭时删掉那个分支的 api Worker Preview。
- `.github/workflows/claude.yml`、`.github/workflows/claude-code-review.yml`：PR 与 issue 上的 Claude Code，不参与发布。
- `.github/workflows/architecture-diagram.yml`：只在 PR 改到架构图时校验，和发布无关。

## 片中不用或待定

- **实测延迟**：上一版的「320–490 ms（8 月实测）」作废，因为中间多了一跳 Service Binding。上画面前要重测；没重测就不出数字。
- **没有上报器再按人数调频**：agents-reporter 按 agent 使用情况，PlayStation 按局域网发现包，服务器固定。`/count` 仍在推送房间上，片中只在第 05 章当数人头的白卡画。
- **Mac `postInterval`**：默认 10 秒，注释写的是「本机 30 秒」，未确认，片中不用。
- **HA 的配置**：不在仓库里。片中只讲它报什么，不讲怎么配。

## 顺带发现的遗留（不属于动画，另行处理）

- `workers/online-counter`、`workers/ingest`、`workers/playstation-reporter`：三个目录只剩未跟踪的 `node_modules`。<!-- allow: 快照里点名的已退役目录，不在仓库 -->
