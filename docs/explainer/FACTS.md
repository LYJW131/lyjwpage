# 讲解动画 · 事实基线

> 类型：reference

按这份仓库里的代码核对，文档和代码不一致时以代码为准。动画里出现的每一个端点、数字、谁做什么，都要能在这里找到出处；架构改动时先改这份，再改分镜。

第 2 节的 202 时机按 main 34eb555 逐条回代码复核过；其余各节的核对基线写在各节开头。 <!-- allow: 核对基线戳 -->

各节里随站点迁到 site Worker（React Router、Workers Builds）改写的条目，按 448a95e1 回代码复核过。 <!-- allow: 核对基线戳 -->

## 一句话总览

仍是三段：**采集 → 中枢 → 展示**。上报器（和 Claude Code 云端的 OTLP）向上报入口 POST；中枢在 Cloudflare Workers 上记状态；展示是 site Worker 用 React Router 渲染首屏（`workers/site/src/index.ts`，配置在根 `wrangler.jsonc`），浏览器挂载后直连 Worker 取数、收 WebSocket 推送（`src/lib/backend-url.ts#backendUrl`）。第 00 章旁白「上报器发 POST，Workers 记状态，site Worker 出首屏，浏览器收推送」就是这一句。中枢由四个 Worker 组成：

- **ingress**：无状态的上报入口，负责鉴权、校验、分流。
- **core**：状态核心 `StateCore`（RPC 入口）加上 `StateHub` DO，以及推送房间 `LivePushRoom`。
- **collector**：每分钟一响的采集 Worker；Apple Music 的按需查询与「正在听」的补全也在这里，由 site 与上报入口经 Service Binding 调用。
- **ai**：首页对话、访客构建和公开 MCP；不挂公开域名，site 与 core 按 `shared/ai-paths.ts#AI_HTTP_PATHS` 把这几条路径经 Service Binding 原样转给它，它经 Service Binding `PUBLIC_STATUS` 只读 core 的状态（`workers/ai/README.md`「入口与权限」、`workers/ai/wrangler.toml`）。它不在一首歌的链路上，片中在第 00 章总览、第 07 章「对话」和第 09 章「发布」里出现。

数据按层落地：实时层在 DO，可滞后层在 KV `LAG`，长期历史在 D1 `lyjwpage-history`，凭据在 KV `CREDENTIALS`。

片中叫法（画面标签和旁白都照这个）：账房是 `StateHub`，唯一的状态 DO，实时层存在它的 SQLite 里（`workers/core/src/state-hub.ts#StateHub`）；门外「照单去办」的是 `StateCore`，一个 `WorkerEntrypoint`，上报入口和采集 Worker 经 Service Binding 调它，它不是 DO（`workers/core/src/state-core.ts#StateCore`）；推送是另一个单例 DO `LivePushRoom` 上的 `/ws` WebSocket，全站一个房间（`workers/core/src/origin-worker.ts#LivePushRoom`）。上报器 = reporter；上报入口 = ingress Worker；采集 Worker = collector Worker；历史库 = D1；对象存储 = R2。

## 1 采集端

### 来源

下表里除 Claude Code 云端和 collector Worker 两行，每一行都是一个外部上报器；Claude Code 云端遥测（OTLP）不是我们写的上报器，另走一个入口。第 01 章画成一座漂浮小岛的立体微缩：开场是整座岛的鸟瞰，岛上各处的上报器往岛外推信封，钟楼（采集 Worker）往岛外拉；之后镜头依次停在 Mac、NAS、iPhone、家里（Home Assistant 和 n100 上的 playstation-reporter）、东京 misaka-jp 上的一台主机（server-reporter、agents-reporter、discord-reporter）、云端遥测那一小块和钟楼，最后一站是别的设备上没人上报的播放。上报器和采集任务有几个，只按代码画，旁白和标注里不说。其中 n100 上的 playstation-reporter，把 presence、游玩列表和奖杯 POST 到同一个 `/api/ingest/playstation`。入口来源是 `shared/ingest/prepare.ts#INGEST_SOURCES` 那一份（playstation 是其中之一）；OTLP 走 `/api/ingest/agents/otlp`，不在这份清单里。Home Assistant 的 token 只开 homepod（`lyjwpage-home-assistant` 只有 `ingest:homepod`）。容器自己的 Access service token 是 `lyjwpage-playstation`，登记在 `workers/ingress/wrangler.toml#ACCESS_CLIENTS`，权限只有 `ingest:playstation`；`/playstation` 只认这一把。

第 01 章用到的部分（编码用量与 Tokens 道的口径、collector 的任务与节奏、PlayStation 与 Quest 上报器、Mac 信封的 90 秒）按 main 8534275 逐条回代码复核过。 <!-- allow: 核对基线戳 -->
iPhone 那一站的 App 名按 main a2c6e1c 回代码复核过；apple-recent 的两档与活跃档的拉取、「没人上报的播放」那一站按 cddbb5a 复核过。 <!-- allow: 核对基线戳 -->

| 来源 | 程序 / 在哪跑 | 入口 · token | 报什么 |
|---|---|---|---|
| Mac | Mac Telemetry Hub，菜单栏 App | `/api/ingest/mac` · `lyjwpage-mac` | 前台应用、窗口标题、Apple Music、充电设备、编码用量（本机的日行、最近一次用量事件、5 分钟 token 桶）、时区、Apple Music user token |
| iPhone | lyjwpage iOS App，HealthKit 唤醒：圆环按小时（`.hourly`；README 说这一条传 `.immediate` 也会被系统钳到 `.hourly`），训练申请 `.immediate`（`apps/ios/App/Hub/Modules/ActivityModule.swift#observe`、`apps/ios/App/Hub/Modules/WorkoutsModule.swift#startObserving`、`apps/ios/README.md` 的「什么时候会上报」） | `/api/ingest/iphone` · `lyjwpage-iphone`；专注模式由快捷指令另用 `lyjwpage-iphone-focus` 报 | 活动圆环、训练、五分钟步数桶；睡眠 / 正念专注模式（`modules.focus`，首页勿扰卡 `src/components/live/focus-now-card.tsx`） |
| Home Assistant | 家里 | `/api/ingest/homepod` · `lyjwpage-home-assistant` | HomePod 正在播放。不报 PS5 电源 |
| PlayStation | playstation-reporter，n100 上的容器 | `/api/ingest/playstation` · `lyjwpage-playstation` | presence、游玩列表、奖杯：拿本机的 PSN 登录态问 Sony 取来，用自己的 Access token 寄到站点。不发 `power` |
| Emby | emby-reporter，NAS 上的容器 | `/api/ingest/emby` · `lyjwpage-emby` | 在看什么；海报先传 R2 |
| 服务器 | server-reporter，东京 misaka-jp 容器 | `/api/ingest/server` · `lyjwpage-server` | 服务器状态，固定每 60 秒一次（`reporters/server-reporter/src/config.ts#intervalMs` 的默认值，容器 `.env` 可覆盖） |
| 编码账号 | agents-reporter，misaka-jp 容器 | `/api/ingest/agents` · `lyjwpage-agents` | 各家编码工具限额；Cursor 账号的用量日行、最近一次用量事件、5 分钟 token 桶 |
| Quest | discord-reporter，misaka-jp 容器：Bot 连 Discord Gateway，只取 lyjw 的 Discord 账号上 `platform=meta_quest` 的 Playing（`reporters/discord-reporter/README.md`） | `/api/ingest/quest` · `lyjwpage-quest` | Quest 在玩什么：`{version:1, presence:{observedAt, discordStatus, playing}}`（`shared/ingest/quest.ts#prepareQuestReport`）。进实时层、推 `quest-now`（`shared/status-views.ts#STATUS_VIEWS` 的 `questNow`）；在玩时首页出现一张 Now Playing 卡（`src/components/live/quest-now-card.tsx`） |
| Claude Code 云端 | OTLP JSON（可 gzip），Claude Code 自己发，不是我们写的上报器；云端环境里的 Devin CLI 也推到这里 | `/api/ingest/agents/otlp` · `lyjwpage-claude-cloud` | 云端 token 与费用的累计值（Claude Code 只收 cumulative，Devin CLI 只发 delta）；状态核心做差，落成和别的来源同形的日行、5 分钟桶、最近一次用量事件（`workers/core/src/stores/agents-otlp.ts`）。Mac 上的 Devin CLI 拿 `lyjwpage-mac` 推同一个入口，入口按凭据的权限记成另一个来源 `mac-otlp`（`workers/ingress/README.md`「OTLP：按凭据分来源」）。几处怎么合并见下文「编码用量」 |
| collector Worker | Cloudflare，cron 每分钟一响，任务表 `workers/collector/src/registry.ts#JOBS` 里的任务各按自己的节奏 | 不走 ingress | 见下文 |

PlayStation 的 presence、游玩列表和奖杯由 `reporters/playstation-reporter` POST 原始信封。采集 Worker 不拉 PSN，也不持有 PSN 凭据（`docs/ops-facts.md` 里采集 Worker 那一条）。PS5 电源没有来源上报，站点也不显示：PlayStation 信封带 `power` 字段会被入口拒收（`shared/ingest/playstation.ts#preparePlaystationReport`）。状态核心还留着一个没人调用、也没有新数据写入的只读接口 `playstationPower`（契约只加不改，`shared/state-core.ts#StateCoreRpc`），片中不画成活动的链路。

容器跟 PS5 在同一个局域网里，用 UDP 发现包探测主机状态（`reporters/playstation-reporter/src/probe.ts#probeOnce`），按醒着、没醒两档调整打 PSN 的频率（`reporters/playstation-reporter/src/cadence.ts#shouldRunTick`，展开见 §7）。两档对调时立刻打一轮，所以开机后第一探读到醒着，紧跟着问一轮 PSN、寄一封。主机醒没醒只由容器自己探测，只用来定它自己的节奏，不进信封（信封只有 presence、游玩列表、奖杯：`reporters/playstation-reporter/src/site.ts#PlaystationEnvelope`），也不画成 Home Assistant 给的。片中不出间隔的数；第 01 章家里那一站不画探测，只画容器把 presence、游玩列表、奖杯寄到 `/api/ingest/playstation`，PSN 登录态留在本机、只拿来问 Sony。

三样凭据各管各的，片中分开画，不能混：

- **PSN 登录态**：存在容器的状态目录里（`reporters/playstation-reporter/src/state.ts#AUTH_KEY`，一个键一个文件，`reporters/playstation-reporter/src/store.ts#FileStore`），只在本机续期，只拿来调 Sony 的 PSN 接口（`reporters/playstation-reporter/src/auth.ts#AuthSession`、`reporters/playstation-reporter/src/psn.ts`）。不送到站点，站点也不用它鉴权。它在机器上的位置见 `docs/ops-facts.md`。
- **容器的 Access service token** `lyjwpage-playstation`：寄信封时放在 `CF-Access-Client-Id` / `CF-Access-Client-Secret` 两个头里（`reporters/playstation-reporter/src/site.ts#deliver`），只开 `/playstation`。
- **Home Assistant 的 token** `lyjwpage-home-assistant`：只开 `/homepod`（`workers/ingress/wrangler.toml#ACCESS_CLIENTS`），和 PlayStation 没有关系。

### Mac 信封

- 结构是 `{version:4, presence, heartbeatAt, activeModules, modules:{…}}`，`heartbeatAt` 是 epoch 毫秒；只带变了的模块（`reporters/mac-telemetry-hub/Sources/TelemetryCore/TelemetryEnvelope.swift#TelemetryEnvelope`、`reporters/mac-telemetry-hub/Sources/TelemetryCore/ReportDecision.swift#ReportDecision`、`shared/ingest/telemetry.ts#prepareTelemetryEnvelope`）。
- 没变化时每 **90 秒**发一个空信封报平安（`reporters/mac-telemetry-hub/Sources/TelemetryCore/ReportDecision.swift#heartbeatInterval`）。
- 切应用默认先等 **400 ms** 落定，是防抖：落定前再切一次就重新等；这个值能在 Hub 的设置页里调（`reporters/mac-telemetry-hub/App/MacTelemetryHub/AppSettings.swift#defaultDesktopSettleDelayMs`、同文件 `desktopSettleDelayRangeMs`）。片中写「默认先等 400 ms」。
- 窗口标题上报前先过隐私判断（`reporters/mac-telemetry-hub/App/MacTelemetryHub/WindowTitleJudge.swift#WindowTitleJudge`）。设置里有总开关；按 Bundle ID 划两份名单：「从不读」的应用标题不读、不判、不报，「不用问」的直接上报（`reporters/mac-telemetry-hub/App/MacTelemetryHub/AppSettings.swift#windowTitleBlacklist`、同文件 `windowTitleTrustedApplications`）；远端上报黑名单里的应用标题也不送出本机。其余每条标题归一化后（剥掉转圈、进度条）送到 TypeSafe 的 System One 端点，由 Jev 模型一次回几道是非题的概率（`reporters/mac-telemetry-hub/Sources/TelemetryCore/JevWindowTitleQuestion.swift#JevWindowTitleQuestion`；`reporters/mac-telemetry-hub/README.md`「Where the data goes」）。Hub 在本机按设置页里可调的几条线把概率落成四档：公开、锁定（判为私密，或没配 key、请求失败）、已省略（能公开但没信息）、待确认（把握不足，发一条通知等 lyjw 在通知或设置页拍板，拍板前按锁定处理）（`reporters/mac-telemetry-hub/Sources/TelemetryCore/WindowTitleJudgment.swift#WindowTitleVerdict`）。结论按应用和归一化标题缓存，同一条只问一次。只有公开的进信封，站点侧不参与判断。判据（题面、线的值、名单内容）不写；第 01 章问题横条的条数是示意，不对应判断的题数。

### 图片

- 字节在源头定好，文件名是 `sha256(内容).扩展名`，直传 R2，带 `Cache-Control: public, max-age=31536000, immutable`（`reporters/emby-reporter/src/r2.ts#uploadImage`；`reporters/mac-telemetry-hub/Sources/TelemetryCore/R2IconUploader.swift#upload`、`reporters/mac-telemetry-hub/Sources/TelemetryCore/R2IconUploader.swift#objectKey`）。
- 三种图：
  - Mac 应用图标：重画成 96×96 PNG（`reporters/mac-telemetry-hub/App/MacTelemetryHub/TelemetryModules.swift#pngData`）
  - Emby 海报：转成 WebP q88（`reporters/emby-reporter/src/r2.ts#uploadImage`）
  - Mac 充电头封面：Anker 的源 JPEG 原样上传，扩展名 jpg（`reporters/mac-telemetry-hub/App/MacTelemetryHub/ServiceController.swift#confirmedCoverIconObjectKey`）
- 信封里只带 `objectKey`。入口按 `shared/asset-url.ts#IMAGE_OBJECT_KEY` 的正则校验（64 位十六进制加 png / webp / jpg / jpeg）。Mac 的应用图标在 `desktop` 模块里是 `iconHash` 加 `iconObjectKey`（`shared/ingest/telemetry.ts#PreparedDesktop`）。

### 编码用量（四个来源）

- 各来源只报自己观测到的原始事实，三种形状一样：日行（来源 × agent × 站点日）、5 分钟 token 桶、最近一次用量事件（契约 `shared/coding-usage.ts`）。来源登记在 `shared/coding-usage-sources.ts#CODING_USAGE_SOURCES`：`mac`（Mac 本机的会话记录）、`agents`（agents-reporter 里 Cursor 账号的完整历史）、`agents-otlp`（云端环境的 OTLP：Claude Code 云端线程与云端的 Devin CLI）、`mac-otlp`（Mac 上 Devin CLI 自己推的 OTLP）；两路 OTLP 都是状态核心做差后才成形（见上表）。
- 合计、排名、去重、年度格子都不归来源，在状态核心一处算（`shared/coding-usage-view.ts#buildCodingUsageView`）：同一个 agent 有账号级来源（Cursor 账号）就只用它，其余来源相加（`shared/coding-usage-sources.ts#resolveCodingUsageSources`）。读出口是 `/api/status/coding`、`/api/status/coding/now`、`/api/status/coding/year`（`shared/status-views.ts#STATUS_VIEWS`）。
- Pulse 多一条 Tokens 道：各来源的 5 分钟桶全部相加，画的是 token 处理量（输入 + 输出 + 缓存读 + 缓存写入，与站内所有 token 数同口径，见 `shared/coding-usage.ts#codingRowTokens`）在每个 5 分钟桶里的平均值，折成每分钟；它不是模型的生成速度（`workers/core/src/pulse.ts#tokensLaneView`）。卡上「此刻」那个数取最近 `TOKEN_CURRENT_MS`（10 分钟）内最后一个有用量的桶，不是此刻的精确值，口径问题还没修（同文件 `TOKEN_CURRENT_MS`）。
- 片中只讲到「三处各报原始数，站点这边合并，Pulse 上多一条 token 处理量（5 分钟平均）」，不点存储键和模块名。按地方数仍是三处（Mac、云端、Cursor 账号），Mac 那一处有本机扫描和 OTLP 两路，所以按来源数是四个；画面上说「三处」「Mac · 云端 · Cursor」照旧成立，说「三个来源」不成立。不说「生成速度」「每分钟生成」，也不说它是此刻的精确值。

### collector 的任务

- 节奏：每个任务登记「每 N 分钟、第 offset 分钟」（各任务的 `everyMinutes` / `offset`），cron 每分钟一响时挑出到期的一起跑（`workers/collector/src/schedule.ts#isDue`）。第 01 章钟楼那一站的时序图按这张表从整点起画 12 分钟；apple-recent 每分钟登记、任务里再分两档（下一节），时序图让它在 :05 那一轮看到列表变了：:00、:05 各一次，之后每分钟。
- 最近在听：apple-recent 任务，专辑 / 歌单粒度的列表交给 `CORE.commitRecentlyPlayed`。用的 user token 是 Mac 推进 `CREDENTIALS` 的那一份，形成一次凭据接力。
- GitHub、站点部署与访问量、Cloudflare、站点健康、PageSpeed、厂商状态：直接写 `LAG`；站点部署列表那一轮（`site-deployments`，每分钟）另把部署记录写进 D1，访问量是 `site-analytics`，每 15 分钟第 3 分钟（`workers/collector/src/jobs/site-status.ts#siteDeploymentsJob`、`workers/collector/src/jobs/site-status.ts#siteAnalyticsJob`、`workers/collector/src/history.ts#archiveSiteDeploys`）。在线探测 `uptime-probe` 每分钟只把成败记进 D1，站点健康 `site-health` 每 5 分钟第 4 分钟把它汇总进 `LAG`（§8）。第 01 章钟楼那一站的注只说「直接交给状态核心，或写 LAG」，不画 D1。
- GitHub 头像：avatar-watch 每 5 分钟第 1 分钟比对头像的 sha256 与 main 上的 `.github/github-avatar.sha256`，不一致才触发 `.github/workflows/avatar-sync.yml` 提交新哈希、让站点重建；不写状态（`workers/collector/src/jobs/avatar-watch.ts#avatarWatchJob`）。
- 摘要：digest 每 15 分钟第 5 分钟（:05、:20、:35、:50）经 Service Binding `DIGEST` 请 ai 的 `Digest` 入口写一份摘要，写进 `LAG`；输入没变也重写一次，好让 `updatedAt` 跟上。只在卡片换形（第一份摘要、摘要与时钟互换）时请状态核心失效 `digest` 标签（`workers/collector/src/jobs/digest.ts#digestJob`、`workers/collector/wrangler.toml` 的 `DIGEST`）。首屏的 In Brief 卡读它（§4）。
- PlayStation 不在这张表里。

### 没人上报的播放（第 01 章）

- iPhone、iPad、网页版等别的设备上放的 Apple Music 没有上报器：lyjwpage iOS App 只报活动与训练（`apps/ios/README.md`）。站点只能从 Apple Music 账号「最近播放的歌」的单曲列表推断（`workers/collector/src/jobs/apple-recent.ts#assembleRecentTracks`）。
- 拉取：apple-recent 在任务表里每分钟登记，任务里再分两档：闲时每 `IDLE_EVERY_MINUTES`（5）分钟拉一次；专辑列表或单曲列表有变就进活跃档，每分钟这一响里接着每 `ACTIVE_POLL_MS`（15 秒）再拉一次单曲列表，`ACTIVE_HOLD_MS`（10 分钟）里没再变才回闲档（同文件 `appleRecentDue`、`followRecentTracks`、`appleRecentJob`）。单曲列表连同拿到它的时刻交给 `CORE.commitRecentTracks`；回执里的 `nextBy`（照推断接着放、下一首最晚上榜的时刻）早于下一次拉时，提前到那一刻拉（`shared/pulse-listening.ts#nextTraceBy`）。片中只画每 15 秒一拉，不画按曲终补拉。
- 记痕迹：状态核心拿新列表和上一份比，新播的歌是新列表的前缀，一首记一行 `(since, t]`，带时长（`shared/pulse-listening.ts#playedBetween`、同文件 `listeningTraces`；`workers/core/src/stores/listening-pulse.ts#prepareRecentTracks`）。一首歌开播后 `LISTENING_TRACE_LAG_MS`（5.5 秒）排到列表最前，所以开播落在这两次拉取各减去这段滞后之间（上榜的抖动实测见 `docs/listening-inference-accuracy.md`，record；滞后按页面进度对照手机上的实际进度定）。片中说「开播几秒就排到最前」。
- 推断：连续播放的一串按时长对齐，每首的窗口减去前面各首的时长后都约束同一个开播，放宽一点余量求交取中点；不放宽时交集的半宽是理想误差（`marginMs`）；交集为空就另起一串；一首画到时长用完或下一首开播（`shared/pulse-listening.ts#inferredPlays`）。片中「后一首的窗口减去前一首的时长，和前一首的窗口求交」是它两首时的情形。
- 展示：Pulse 听歌道画成斜线段，悬停「Played elsewhere (estimated)」带开播误差，图例「Elsewhere (est.)」（`workers/core/src/pulse.ts#stateLaneView`、`src/components/live/pulse/state-lanes.tsx`、`src/components/live/pulse-card.tsx`）。最后一首还没按时长放完、或放完还不到 `LISTENING_ELSEWHERE_HOLD_MS` 时，`listening/now` 带 `elsewhere`；Mac / HomePod 都没在放时，卡片标 Likely Playing（label-mono，界面上是大写），旁边虚线框里是这一首的理想误差，如「±3s」（`shared/pulse-listening.ts#playingElsewhere`、`shared/now-listening.ts#pickNowListening`、`src/components/live/listening/now-playing.tsx#formatMargin`）。Mac / HomePod 在放同一首（歌名与艺人都对上）就不算别处播放（`shared/pulse-listening.ts#sameSong`）。
- 片中不出实测精度的数；示意里的分钟和开播时刻是示意，歌名和时长是 Apple 目录里的（Aimer 的 Ref:rain、残響散歌），页面卡片上的「±3s」是片中示意窗口算出来的理想误差。第一首的时长要让两次看到新歌都落在整分钟那次拉取上（配乐在 24:1、25:2 两拍有纸滑）。时间在推断开始前定格（一拍一分钟走下去，那首歌在片中已经放完）。暂停、拖进度、单曲循环不在列表里留痕，片中不讲。

## 2 上报入口（workers/ingress，`ingest.homepage.lyjw.llc`）

第 02 章用到的部分按 main a5d5b89 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

### 鉴权

- 走 Cloudflare Access service token，**每个上报方一把钥匙，只开权限表上写着的门**（`workers/ingress/wrangler.toml#ACCESS_CLIENTS`）。钥匙按上报方发：Home Assistant 那一把只开 homepod；`/playstation` 只有 n100 上 playstation-reporter 容器自己的一把，报 presence、游玩列表和奖杯，带 `power` 字段的信封拒收（`shared/ingest/playstation.ts#preparePlaystationReport`）；`/quest` 只认 misaka-jp 上 discord-reporter 的 `lyjwpage-quest`，权限只有 `ingest:quest`。第 02 章的门墙按 `shared/ingest/prepare.ts#INGEST_SOURCES` 一个来源一扇门，外加 `/agents/otlp`；权限表按 `ACCESS_CLIENTS` 一把钥匙一行，只写上报方名，不写 client id，名字照 `docs/ops-facts.md`「Cloudflare Access（Zero Trust）」。`/agents/otlp` 这扇门认两种权限：Claude Code 云端那把的 `ingest:agents-otlp`，和 mac 那把另带的 `ingest:mac-otlp`（同一台 Mac 上的 Devin CLI 推用量；`workers/ingress/src/worker.ts#OTLP_SOURCES`）。iPhone 有两把（App 一把、专注模式快捷指令一把，都只开 `/iphone`）；github-actions 那把不开上报的门，只有 `internal:site-deployed`、`internal:collector-refresh` 两条内部路径（`workers/ingress/src/worker.ts#SITE_DEPLOYED_PATH`、`#COLLECTOR_REFRESH_PATH`）。验钥匙分三步：
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
| 6 | 读不出请求体，或超过 **4 MiB**（按实际读到的字节数，gzip 的按解压后算） | 400（`shared/storage-contract.ts#STORAGE_MAX_BYTES`、`workers/ingress/src/worker.ts#readBoundedBody`） |
| 7 | 不是 JSON | 400 |
| 8 | prepare 失败 | 400 |
| 9 | `CORE.commitIngest` 回暂时故障（`retryable`：DO 重置或过载），或 RPC 抛出带 `retryable` 的错误 | 503 |
| 9 | `CORE.commitIngest` 拒收 | 400 |

- 回执类型里还留着 `ready: false`（入口见到就回 503），但状态核心总是就绪、实际不会回它；契约只加不改才留着（`shared/state-core.ts#CommitReply`）。片中的回执画成 `{ ready: true, ok: true, data }`。
- Emby 海报在 prepare 里 HEAD R2 确认存在，带 5 分钟正缓存（`shared/ingest/r2-assets.ts#CONFIRMED_TTL_MS`）。回执里的 `missingImages` 告诉上报器还要补传哪些图：状态核心按 prepare 确认过的键算出，随 202 的 `data` 回给上报器（`workers/core/src/stores/emby.ts`、`reporters/emby-reporter/src/site.ts`）。

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

- `CORE` 是 Service Binding：`workers/ingress/wrangler.toml` 里 `[[services]]` 的 `service = "core"`、`entrypoint = "StateCore"`；入口先请采集 Worker 补全换歌那封（`COLLECTOR.enrichTrack`），再 `await env.CORE.commitIngest(enriched)`（`workers/ingress/src/worker.ts#commitIngest`）。
- Cloudflare 内部调用，不走公网、不带凭据：只有声明了这个 binding 的 Worker 调得到，所以这一跳不再鉴权，鉴权只在入口做一次（`workers/core/AGENTS.md`「不变量」；`workers/core/src/state-core.ts#StateCore`）。
- 交过去的是 prepare 的产物 `PreparedIngest`，必须能结构化复制；状态核心只 import 它的类型，不 import 校验实现，所以改校验只发布入口（`workers/ingress/AGENTS.md`「不变量」；`shared/state-core.ts#StateCoreRpc`）。RPC 方法只加不改，core 与调用方分开部署（`workers/core/AGENTS.md`「不变量」）。
- `StateCore` 是 RPC 入口（`WorkerEntrypoint`），它把命令交给唯一的状态 DO `StateHub` 按到达顺序提交（§3），回 `CommitReply`：`ok: true` 的 `data` 原样放进 202；`ok: false` 带 `retryable`（DO 重置或过载）时入口回 503，其余 `ok: false` 回 400（`shared/state-core.ts#CommitReply`）。推送和首屏失效在 StateCore 自己的 waitUntil 里派发，不经入口（§3「效果清单」）。

### 202 的时机

**202 要等三样**，而且是依次等：StateCore 回执 → `LAG` 写完 → 凭据写完 → 回 202。换歌那封在交给 StateCore 之前还先等采集 Worker 补全（§3「效果清单」）。D1 归档在拿到回执后、写 LAG 之前交给 waitUntil，不等，失败只记日志；凭据只在 mac 带来 Apple Music user token 时才写（`workers/ingress/src/worker.ts#commitIngest`）。所以 202 的意思是：实时层已在 StateHub 落账，LAG 和凭据已写；D1 归档、推送、首屏失效还在后台，入口不等。

失败时：DO 重置、过载这类标记为 retryable 的暂时故障回 503，上报器稍后重发；其余校验或处理失败回 400，上报器整封重发；各路按自然键或整份覆盖写，重发不重复（`workers/ingress/src/worker.ts#commitIngest`、`workers/ingress/src/worker.ts#unavailable`）。

可滞后层的写入方（ingress、collector）没有 `SITE_CACHE` 绑定，它只配在 `workers/core/wrangler.toml`。写入时发现布局变了，就调 `CORE.revalidate(tags)` 请状态核心代发（同一函数）。

特例：iPhone 的训练收下了、圆环或专注模式那段被拒时（失败阶段 `beforeActivity` / `beforeFocus`），已收下的那份照写进可滞后层和归档，然后回 400（`workers/ingress/src/worker.ts#partiallyAccepted`）。

拿到回执之后，换歌那封如果还要补后续曲目，入口把 `COLLECTOR.followUpTrack` 交给 waitUntil，不等（`workers/ingress/src/worker.ts#commitIngest`）。

### 好处

改校验只需要发布 ingress。DO 不重启，WebSocket 不断。

## 3 状态核心（workers/core）

第 03 章用到的部分（下面的「StateCore 与 StateHub」「效果清单」「心跳不是什么都不做」「推送房间」「闹钟」）按 5ff9c3d 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

### StateCore 与 StateHub

- `StateCore` 是 WorkerEntrypoint，ingress 和 collector 经 Service Binding `CORE` 调它。这条路不鉴权，因为边界鉴权只在 ingress 做一次（`workers/core/src/state-core.ts#StateCore`）。
- `StateHub` 是 DO（binding `STATE`，`idFromName("global")`），**唯一的状态 DO，全站只有一个实例**（`workers/core/src/state-core.ts#StateCore` 的 `hub()`）。推送房间 `LivePushRoom` 是另一个单例 DO（房间名 `global-apac`，首次创建时带 `locationHint: "apac"`，`workers/core/src/live-platform.ts#liveRoom`；binding 是 `workers/core/wrangler.toml#LIVE_PUSH`）。它和 StateHub 都是从旧 `api` Worker 整体转移来的 SQLite 命名空间，ID 与数据不变（`workers/core/wrangler.toml#v1-transfer-from-api`），但 LivePushRoom 的代码不读写 SQL：每条连接的可见性记在各自的 attachment 上（`workers/core/src/origin-worker.ts#LivePushRoom`）。
- 提交走 `ingestTail`，**排成一条队列逐个提交**（`workers/core/src/state-hub.ts#StateHub` 的 `commitIngest`）。进这条队的上报都经上报入口的 `CORE.commitIngest`（`workers/ingress/src/worker.ts#commitIngest`），PlayStation 那几封也走这条 HTTP 路。采集 Worker 的补写（`StateCore.commitEnrichmentPatch` → `StateHub.commitEnrichmentPatch`）也排进同一条队，排在它所补的那封上报之后；采集 Worker 别的写入经 `stateStorage()` 直接调 `StateHub.execute`，不排这条队（`workers/core/src/storage-driver.ts#stateStorage`）。
- 四张表：`entries` / `fields` / `samples` / `metadata`（`shared/sqlite-store.ts#SqliteStore`；`metadata` 在 `StateHub` 的构造函数里建）。
- pulse 事实时间线也写在同一个库里，TTL 7 天（`shared/limits.ts#PULSE_TTL_MS`）。

### 效果清单

- **DO 不发网络请求，只交回「要做的事」**：`event` / `listening` / `tags` 三种（`workers/core/src/ingest-effects.ts#IngestEffect`）。
- StateCore 用自己的 `ctx.waitUntil` 执行这份清单，然后把结果回给 ingress（`workers/core/src/state-core.ts#StateCore` 的 `commitIngest`；`workers/core/src/live-platform.ts#afterResponse`）：
  1. 先并行向 `LivePushRoom` 广播。
  2. 再把布局标签排进 StateHub；StateHub 的 alarm 把排着的标签合成一轮，经 Service Binding `SITE_CACHE` 交给 site Worker 的 `invalidate`，5 秒超时，两轮之间至少隔 `PURGE_MIN_INTERVAL_MS`（`workers/core/src/live-platform.ts#expireStatusTags`、`purgeStatusTags`、`REVALIDATE_TIMEOUT_MS`，`workers/core/src/purge-throttle.ts#planPurge`）。
- 所以**广播和 202 是并行的**，不是 202 之后才广播。
- 效果在 StateHub 之外派发：`StateCore.commitIngest` 拿到 StateHub 交回的效果，交给 `dispatchIngestEffects`，后者经 `afterResponse` 放进 `ctx.waitUntil`；网络请求不占 StateHub 的执行时间，串行的提交队列不被推送和失效拖住（`workers/core/src/ingest-effects.ts#dispatchIngestEffects`、`workers/core/src/live-platform.ts#afterResponse`）。第 03 章旁白「网络请求不占 StateHub 的时间」出自这里。
- 换歌那封上报在交给状态核心之前，由上报入口请采集 Worker 查 Apple 目录补封面、链接、songId、有没有歌词和动态封面，结果随命令交给 StateHub 落库；采集 Worker 调不通时命令不带补全照样提交，状态核心不查 Apple。推送和读取只用存好的这份（`shared/command-enrichment.ts#enrichCommand`、`shared/track-enrichment.ts#candidateFrom`）。
- 各模块交回什么（`workers/core/src/stores/telemetry.ts#commitPreparedTelemetryEnvelope`）：
  - **切应用**只交回一条 `desktop` 事件，不失效首屏：页头那一格定宽，换应用只换内容（同函数的 `desktop` 分支）。所以片中「切应用」不配「通知 site Worker」。
  - **换歌**交回 `listening`：StateCore 用提交时存好的补全拼出 `listening-now` 再广播（`workers/core/src/ingest-effects.ts#dispatchIngestEffect`）。只有开始或停止放歌才另失效在听那张卡的标签 `NOW_LISTENING_TAG`（同函数 `appleMusic` 分支里比 `wasLive`），换一首不失效。
  - iPhone 那一半的活动桶和训练只进 Pulse（五分钟桶和训练区间），不推送、不失效；专注模式另算：模式变了推 `focus-now`，开、关翻转时失效 `FOCUS_NOW_TAG`（`workers/core/src/phone-telemetry.ts#commitPreparedPhoneEnvelope`、`workers/core/src/stores/focus.ts#writeFocus`）。
  - 清单里的通知（`event`、`listening`）先并行发完，再把所有标签合成一次失效（`workers/core/src/ingest-effects.ts#dispatchIngestEffects`）。

### 心跳不是什么都不做

纯心跳也会写：存活时间（`writeLiveness`）、在听和 coding 各一笔 pulse 观测（`recordListeningPulse`、`recordCodingPulse`），外加遥测状态里的 `telemetryReceivedAt` 和 `activeModules`（`persistTelemetryState`）；充电头模块开着时，还续一次充电头心跳和一笔充电采样（`prepareHeartbeat`、`recordChargingPulse`）；都在 `workers/core/src/stores/telemetry.ts#commitPreparedTelemetryEnvelope`。片中只说「存活 + pulse 观测」，不说「三样」。它**不推送、也不失效首屏**。例外是在线 / 离线翻转：这时推 `presence`，并失效 4 个标签：页头、在听、充电头、充电宝四张卡的 `DESKTOP_TAG` / `NOW_LISTENING_TAG` / `CHARGER_TAG` / `POWERBANK_TAG`（同函数的 `presenceFlipped` 分支）；片中只画前三张。另有一种不翻转的情形：心跳断档超过存活窗口后恢复（这封不是离线），不推 `presence`，只失效同样 4 个标签，让首屏按时钟藏起的卡回来（同一处的 `offlineByLiveness` 判断）；片中不画。

### 推送房间 `LivePushRoom`

- 地址 `/ws`（`shared/live-heartbeat.ts#LIVE_SOCKET_PATH`；binding `LIVE_PUSH`，房间 `global-apac`）。
- 事件的种类和载荷见 `shared/live-events.ts#LiveEvent`（片中不说几种）：`presence`、`version` 不带数据，`online` 带 `{online}`，其余都带数据。
- 用 Hibernation API：ping/pong 由运行时自动应答，不唤醒 DO（`workers/core/src/origin-worker.ts#LivePushRoom` 的 `setWebSocketAutoResponse`）。只有接入、断开、切换可见性、清扫闹钟这几件事会唤醒它。

### 在线人数（f6cda45 起并回推送房间，online-counter Worker 已退役）

- 同一条 `/ws` 同时数两种口径：
  - `connections`：开着的页面，含后台；静默 5 分钟不计，30 分钟关闭。
  - `online`：正在看的页面；心跳 30 秒，静默 90 秒不计，清扫 30 秒一次。
- 页面握手时带 `?visible=1`，切后台只发 `hidden`，不断开连接（origin-worker.ts:202；use-live-events.ts:283）。
- `/count` 一次返回 `{ok, connections, online}`；RPC 的 `audience()` 返回同样的两个数（live-census.ts；shared/state-core.ts）。
- 可见人数变了才广播 `online`；页面切后台只发一条 `hidden`，可见性记在各自连接的 attachment 上（`workers/core/src/origin-worker.ts#LivePushRoom` 的注释）。

### D1 长期历史 `lyjwpage-history`

- 表见 `workers/core/migrations/` 的 `CREATE TABLE`（片中不说几张），其中记归档水位的是 `pulse_archive_state`，冻结不再写、原样保留的旧表是 `pulse_samples`、`coding_token_buckets`、`agent_usage_days`（`workers/core/README.md`）。长期保存、不按时间清理。写入按自然键 upsert（`shared/history-ingest.ts` 的各 `…Statements`），活动桶会按区间删掉重写（`workers/core/src/pulse-archive-statements.ts#DELETE_ACTIVITY_RANGE`），所以不能说「只增不删」。DO 里的 pulse 时间线只留 7 天。
- 写 D1 的有三方：上报入口（训练、圆环日读数、限额快照、服务器小时汇总）、采集 Worker（站点部署记录，`workers/collector/src/history.ts#archiveSiteDeploys`）、core（cron 每 5 分钟一轮的 pulse 归档，含编码用量的账本和 5 分钟桶；以及收下奖杯信封后的 `workers/core/src/stores/trophy-history.ts#archiveTrophies`）。
- 活动历史桶在入口量化（eb429ed），防止 HealthKit 的浮点抖动让 D1 每次重写整个 24 小时窗口。

### core 的 cron（`workers/core/src/cron-round.ts#runCronRound`）

这一节和下面的「Pulse 事实时间线」是第 06 章用的，按 3585847 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

- 每 5 分钟一轮，落在 UTC 每小时第 2、7、…、57 分（`workers/core/src/cron-heartbeat.ts#CRON_SCHEDULE`），先调一次 StateHub 的 `pulseTick` 拿归档快照，再把 pulse 归档到 D1：StateHub 给出一份有界快照（各路水位之后的新行）→ 按自然键 upsert 写事实表 → 成功后回头确认水位。各路独立，一路读坏、写坏不挡别的路（`workers/core/src/pulse-archive-snapshot.ts#ARCHIVE_STREAMS`：三条状态道、在听的曲目痕迹、充电、活动桶、Coding 观测，加上编码用量的账本和 5 分钟 token 桶）。
- core 不调 Clef 给 Coding 打分，生产没有 Workers AI 绑定；`workers/core/wrangler.toml` 的 `[previews.ai]` 只给分支预览组合入口里的 ai 用。第 06 章的 Coding 那一层只画原始观测，三色带在推近时现场刷出、镜头一走就消失，不画打分。
- 每一轮跑完，不论成败，都按排定时刻往 D1 的 `health_buckets` 记一笔心跳，这一笔就是第 06 章的「报到」；只在开着历史归档时记（`workers/core/src/state-core.ts#StateCore`、`shared/health.ts#HEARTBEAT_SERIES`、`shared/health.ts#CRON_HEARTBEAT_EVERY_MINUTES`、`workers/core/src/runtime.ts#historyArchive`）。
- StateHub 的 `pulseTick` 调用失败时，本轮按失败报到；归档和断流检查的子步骤各自 `.catch` 并记告警，不令本轮心跳失败，所以心跳不证明这些子步骤成功（`workers/core/src/cron-round.ts#runCronRound`）。
- 触发这一轮的不是 core 自己的 Cloudflare cron（core 的 `crons = []`），而是采集 Worker 每分钟一次的 cron 经 Service Binding 调 `StateCore.cronRound`，core 按 `workers/core/src/cron-heartbeat.ts#cronRoundDue` 判断这一分钟是不是它的轮次（`workers/collector/src/core-round.ts#driveCoreRound`）。

### 闹钟

- StateHub 每小时清一次过期键；一轮删满 1000 条就 1 秒后接着删（`workers/core/src/state-hub.ts#StateHub` 的 `alarm`）。
- LivePushRoom 在有人可见时每 30 秒清扫一次。

### Pulse 事实时间线

- 时间线只存原始值，档位、颜色、摘要都在展示时现算（`shared/pulse-timeline.ts`）：三条状态道（听、看、玩）是状态区间，听那条另有从 Apple 最近播放推出的别处播放（§1「没人上报的播放」）；充电是实测瓦数样本；活动是 HealthKit 的五分钟步数桶加训练区间。
- Coding 不进这条时间线：它的三色带（前台是 coding 应用 / 有 agent 在跑 / 两者同时）读的时候从 Mac 的观测、Cursor 账号的观测和 Claude Code 云端线程的用量桶现算（`shared/pulse-coding-features.ts#codingBand`、同文件 `cloudAgentActivity`）。卡片右边的汇总是 driver（lyjw 在 Mac 前台开着编码应用的时长，`shared/pulse-types.ts#codingDriverSeconds`）和 agent 两个时长（`src/components/live/pulse/state-lanes.tsx`）；第 06 章标的两个时长是示意值。
- Tokens 道：各来源（Mac 本机扫描、Cursor 账号、云端 OTLP、Mac 上的 OTLP）的 5 分钟 token 桶读的时候相加，画每个桶的 token 处理量（输入 + 输出 + 缓存读 + 缓存写入）的 5 分钟平均，折成每分钟；不是生成速度，「此刻」那个数的口径见 §1「编码用量」（`workers/core/src/pulse.ts#tokensLaneView`）。
- Pulse 卡的道按 `src/components/live/pulse-card.tsx#LANES`，写章时从上到下是 Coding、Tokens、Listening、Watching、Gaming、Charging、Activity（第 06 章的地层照这个顺序一层一层画，旁白不说几条）；卡上画最近 24 小时（`shared/limits.ts#PULSE_WINDOW_MS`），屋里留 7 天（`PULSE_TTL_MS`），D1 长期保存。

## 4 首屏（site Worker 上的 React Router）

第 04 章用到的部分按 3585847 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

### 按卡缓存

- `/api/home` 已删除（8977457）。首屏 loader 按视图并行调 `status(key)`，一个视图一次（按 3585847 现数 **29 次**，`shared/status-views.ts#STATUS_VIEWS` 里每个视图一次），最近提交随 `githubRepo` 视图到达，头像内联与之同时开始；第二轮再取图标内联、封面占位和歌词（`src/app/page.tsx#loader`）。
- 每张卡读自己的 `/api/status/*`：实时卡读 DO，可滞后卡读 `LAG`（`src/server/site-context.ts#SiteServices`）。
- 实时层的公开读取在 `StateHub.publicRead()` 里随读取一起过提交可见性屏障，每次读一个 RPC；可滞后层只读 KV，不过屏障、不唤醒 DO（`workers/core/src/public-execution.ts#executePublicRequest`）。
- **视图响应由 site Worker 的 `StatusSnapshot` 缓存入口回源**：成功 200 挂 `Cache-Tag: page:<tag>`、Cache-Control 600 秒且不带 SWR，充电头与充电宝两格 60 秒（`src/lib/site-policy.ts#CLOCKED_LAYOUT_STATUS_CACHE_CONTROL`）；`ok:false` 与端点 404 的降级信封只缓存 60 秒（`src/lib/site-policy.ts#STATUS_DEGRADED_CACHE_CONTROL`）；歌词由 `site.lyrics` 直取后端 `/api/lyrics`，不进这条缓存（`workers/site/src/index.ts#StatusSnapshot`、`src/lib/site-policy.ts#statusSnapshotHeaders`）。整页 SSR 文档与数据响应另挂 `Cache-Tag: home`、max-age 1800 / SWR 86400 / stale-if-error 86400（`src/lib/site-policy.ts#HOME_CACHE_TAG`、`src/lib/site-policy.ts#HOME_CACHE_CONTROL`）。
- 标签：按 3585847 现数 23 个视图挂 `page:` 标签（勿扰卡的 `focus-now` 在内）；另有 6 个视图不带标签（GitHub 图表、站点部署、Cloudflare、站点健康、上报器账本、pulse），只靠 600 秒缓存过期重建（`shared/status-views.ts#STATUS_VIEWS`）。
- 一个标签失效，先清除那份视图快照，再清除首页文档，下一次请求重新渲染；失效经私有 RPC 调进站点缓存，用的是 purge 而不是软失效（`shared/site-cache.ts#SiteCacheRpc`、`workers/site/src/index.ts#purgeTags`）。
- 请求路径上不现拉外部 API：每条缓存只读自己的状态端点（实时读 DO，可滞后读 KV），GitHub、Cloudflare 这些外部来源只由采集 Worker 定时去取（按卡读取见 `src/app/page.tsx#loader`，端点的数据层与读取实现见 `shared/status-views.ts`、`workers/core/src/status-loaders.ts`）。
- 失效通知只带标签名、不带数据：数据已经落在 Worker 上，下一次读端点自己去拿。通知不再是站点 HTTP 路由：core Worker 经私有 `SITE_CACHE` Service Binding 调 `invalidate(tags)`（`workers/core/src/live-platform.ts#purgeStatusTags`、`shared/site-cache.ts#SiteCacheRpc`），白名单过滤后按 `page:<tag>` 清除视图快照，再清除 `home` 首页文档。
- 标签只为布局变化而发：首屏版面变了（例如在线 / 离线翻转、Mac 心跳断档后回来、充电头接上或拔下、开始或停止放歌）才通知失效；只变内容的交给 600 秒缓存过期自己重建（布局判据见 `shared/home-layout.ts`，写 KV 的一方在 `workers/ingress/src/lag-ingest.ts#commitLagIngest` 返回要失效的标签；快照有效期见 `src/lib/site-policy.ts#STATUS_CACHE_CONTROL`）。
- 首页文档带两个值：max-age 是响应在边缘直接可用的时长；stale-while-revalidate 是过了这个时长后先给旧副本、后台再回源重建的窗口。视图快照不带后者，只多一个 stale-if-error：回源出错时继续用旧副本的窗口（`src/lib/site-policy.ts#STATUS_CACHE_CONTROL`）。
- 第 00 章把首屏画成浏览器窗口里的线框：卡片框按 `src/app/page.tsx#Home` 的版面，尺寸取第 04 章 P 表（`docs/explainer/v2/ch04.js#P`）的比例；P 表注明是按 lyjw.me 桌面宽度实测的卡片框乘 0.6，那次实测未核。首排右格是 In Brief 卡：一行摘要标题，旁边一个照过去 24 小时画的表盘；它读 digest、pulse、timezone 三个视图（`src/app/page.tsx#READS` 的 `digest`），没有摘要或摘要是 quiet 时换回时钟卡（`src/components/live/digest-card.tsx#DigestCard`）；第 04 章的印版把这一格拆成 digest、timezone 两块，pulse 归它自己那张卡。Media 下面是整行的 Talk to God 对话卡（`src/app/page.tsx#SLOT` 的 `godChat`），线框画到它就被窗口下沿切掉；它不读状态视图，没有 `firstScreen` 缓存，所以第 04 章的印版里没有它。画的那一刻没在充电：充电那一格收起、「最近播放」占满一行（`src/components/live/media-pair.tsx#LiveMediaPair` 不在充电时加 is-disconnected，`src/app/styles/components.css` 在桌面宽度下把这时的最近播放左边贴到 0）。卡上的标注照站点原文（`src/components/live/listening-card.tsx` 的 Recently Played、Now Playing）；界面上是大写，因为 `src/components/ui/card.tsx#Card` 的标签用 label-mono，它在 `src/app/styles/utilities.css` 里是 text-transform: uppercase。线框旁的标注 `max-w-5xl`、`md:grid-cols-2`、`md:col-span-2` 照 `src/app/page.tsx#Home` 的类名：主栏宽度、首排两列（联系卡、In Brief）、Media 占满一行。页眉上的 `/api/status/listening/now` 是这张卡读的视图之一（`src/app/page.tsx#READS` 的 `media` 含 `src/lib/paths.ts#NOW_LISTENING_PATH`，登记在 `shared/status-views.ts#STATUS_VIEWS` 的 `nowListening`）。

### 来源出问题时

- Worker 降级：回 `ok:false` 加 HTTP 200。
- 404：显示 "Status unavailable"。
- 5xx 或网络错误：抛出，本次渲染失败回 500 且不缓存；`StatusSnapshot` 上游失败或非法包回 503（`workers/site/src/index.ts#StatusSnapshot`）。

## 5 浏览器

第 05 章用到的部分按 main 7fcfacb 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

### 早开连接

- head 里的内联脚本解析到它时就 `new WebSocket("wss://…/ws?visible=1")` 起手，把收到的消息原样攒下：最多 `EARLY_LIVE_SOCKET_QUEUE_LIMIT` 条（50），没人接手就在 `EARLY_LIVE_SOCKET_WATCHDOG_MS`（15 秒）后自己关（`src/lib/live-socket-boot.ts#earlyLiveSocketScript`）。
- 这样**不用等整棵树 hydrate 完**才发起连接。hydrate 后由 `useLiveEvents` 接管这条连接，攒下的按到达顺序重放（`src/hooks/use-live-events.ts#adoptEarlySocket`）。接管的是同一条 WebSocket，不重新握手：`adoptEarlySocket` 从 `window` 上摘下内联脚本那条连接，卸掉它的 handler 后直接用；只有它还在 CONNECTING 或 OPEN 时才接管，已经断了就关掉，由 `open` 重新建一条。房间在连上的那一刻就发一条 `online` 人数，所以托盘里通常至少有这一封。
- 代码里不记实测延迟，注释只讲为什么要早开。**片中不标毫秒**，时间轴只画先后；要标得先重测。
- 重连退避从 1 秒起、每次 ×1.5，封顶 30 秒，每轮在上半截随机抖动；连接撑过 `STABLE_CONNECTION_MS` 才清零（`src/lib/live-reconnect.ts`）。重连后带推送事件的视图补取一次；页面在后台时只记待补，回到前台再取（同文件 `open` 里的 `onReady` 与 `catchUpIfPending`）。

### 推送进卡片

- 带数据的事件按 `src/hooks/use-live-events.ts#FORWARDS` 直接 `mutate(path, data, {revalidate:false})` 写进对应的 SWR 键，卡片当场更新：desktop、listening-now、listening、watching-now、watching、playing-now、quest-now、focus-now、playing、trophies、charger、powerbank、coding-now。事件名到端点的对应登记在 `shared/status-views.ts#STATUS_VIEWS`。
- `online` 只写页脚的人数；`presence`、`version` 不带数据，只让几张卡重取（同文件的 `INVALIDATIONS`；presence 重取的是 Mac 供数的几张，含 coding-now）。
- 时间戳挡旧：推送先经 `acceptPush` 登记这一代，轮询回来经 `guardPolled` 比，慢回来的旧数据盖不掉新的（`src/lib/status-reads.ts#guardPolled`）。带单调戳的只有 quest-now、focus-now、desktop、listening、listening-now、playing、playing-now、powerbank、trophies（同文件的 `STAMPS`），listening-now 比的是 `receivedAt`。

### 取数节奏（`src/lib/poll-schedule.ts`）

- 实时卡的间隔由卡片组件自己给（各组件里 `REFRESH_MS` 一类常量）：
  - 充电头、充电宝：30 秒
  - desktop：60 秒
  - 编码此刻（coding-now）与编码用量（coding）：2 分钟（`src/components/live/vibecoding-card.tsx#REFRESH_MS`）；年度（coding/year）：30 分钟（`src/components/live/vibe-year-chart.tsx#YEAR_REFRESH_MS`）
  - pulse：5 分钟
  - 在听 / 在看 / 在玩 / Quest / 勿扰「此刻」：60 秒
  - 列表类和奖杯：10 分钟（在听列表空着时 60 秒）
- 推送连着、且视图登记了 `pushCovers`（listening、watching、watching-now、playing、playing-now、trophies）时，间隔取 `max(cardMs, PUSH_SAFETY_NET_MS)`，也就是不快于 5 分钟的兜底（`src/lib/poll-schedule.ts#realtimeInterval`）：真被放宽的只有 60 秒的「此刻」卡（watching-now、playing-now）和空着的在听列表，10 分钟的列表和奖杯不变。desktop、充电头、充电宝、listening-now、quest-now、focus-now、编码没登记 `pushCovers`，照旧按自己的间隔。
- 可滞后卡不固定轮询，在 `due = updatedAt + cadenceMs + LAG_GRACE_MS`（15 秒）时去取，也就是「下一次预期写入」之后一点；过了 due 还没取到更新的，从 `LAG_MIN_RETRY_MS`（15 秒）起退避，封顶 min(节奏, `LAG_MAX_RETRY_MS`)（5 分钟；`src/lib/poll-schedule.ts#nextLagDelay`）。
- 节奏登记在 `shared/status-views.ts#STATUS_VIEWS` 的 `cadenceMs`。片中到货表举的三行：server 60 秒、github-chart 10 分钟、activity 1 小时；表里的 updatedAt 时刻是示意。
- 标签页隐藏就暂停。

### 在线判断全在浏览器（8a7e63e）

- 源站只给原始事实：`lastSeenAt`、`heartbeatWindowMs`、`declaredOffline`（`shared/reporter-liveness.ts#withPresence`），不给「此刻在不在线」的结论。
- 首帧拿首屏信封的 `servedAt` 当钟；挂载后换成访客自己的钟，只进不退（`shared/freshness.ts#clockReading`）。
- 到了 `lastSeenAt + heartbeatWindowMs` 这个截止时刻，浏览器自己的定时器把钟推过去，卡片当场翻成离线，不再去问源站（`src/hooks/use-stale.ts#useReporterStale`）；刚切回前台、回源还没回来的那一拍不算（`shared/freshness.ts#confirmStale`）。

### 播放进度

- 位置 + (现在 − 观测时间)，即 `positionMs + (now − observedAt)`，只在 `state === "playing"` 时往前推；单曲循环（repeatOne）时取模（`src/lib/track-position.ts#trackPositionMs`）。`now` 是浏览器的钟，`observedAt` 是设备（Mac / HomePod）的钟。
- 歌词逐字高亮。

### 年度图

在站点时区零点多出一格，有 2 秒宽限（use-site-day.ts）。

## 6 交付：图片、大陆访问、发版

片中没有专讲这一节的章，「发版」那一段归第 09 章（§10）。按 main 7fcfacb 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

### 图片

- 页面、状态 API 和推送里的图片一律写同源 `/img/<objectKey>`（`shared/asset-url.ts#publicAssetPath`）。
- lyjw.me：`/img/*` 由 site Worker 经 R2 绑定 `IMAGE_OBJECTS` 直出，图片字节不进渲染层（`workers/site/src/index.ts`，绑定见根 `wrangler.jsonc`）。
- lyjw131.com：由 ESA 缓存同一路径。
- 图片是 immutable，内容变了名字就变，永远不需要刷新。

### 大陆访问

- lyjw131.com 经阿里云 ESA 回源 lyjw.me。
- 首页的 `Cache-Control: public, max-age=1800, stale-while-revalidate=86400, stale-if-error=86400`：30 分钟内直接命中；过期后先给旧页，后台回源。
- 首屏新鲜度不靠 ESA 这一层：ESA 给的可能是一份旧 HTML，浏览器挂载后经 SWR / WebSocket 直接向 Worker 取最新状态（根 `README.md`「首屏快照与实时更新分开处理」；缓存头数值在 `src/lib/site-policy.ts#HOME_CACHE_CONTROL`；浏览器直连 Worker 见 `src/lib/backend-url.ts#backendUrl`）。

### 发版

部署成功之后刷新 ESA、等两个域名换上新版、通知开着的页面，事实只写在 §10「部署成功之后：刷新 ESA、通知页面」，片中由第 09 章「发布」讲。

## 7 自适应调频

| 上报器 | 快 | 慢 | 怎么定 |
|---|---|---|---|
| PlayStation（n100 容器） | 主机醒着：`reporters/playstation-reporter/src/cadence.ts#AWAKE_TICK_INTERVAL_MS` | 休息或确认关机：`reporters/playstation-reporter/src/cadence.ts#IDLE_TICK_INTERVAL_MS` | 局域网发现包 UDP 9302，不问人数 |
| agents（限额） | 有一家在用：5 分钟（只取在用的那家） | 都没在用：60 分钟 | `SITE_URL/api/status/coding/now`，不问人数 |
| 服务器（对照） | 60 秒 | 60 秒 | 不问 |

片中没有专讲这一节的章。按 main e10a75a 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

- PlayStation 大约每 `reporters/playstation-reporter/src/cadence.ts#PROBE_INTERVAL_MS` 发一次发现包，只在该打的时候打 PSN。`HTTP/1.1 200` 是醒着，`620` 是休息，超时或别的回复先记一笔，连续 `reporters/playstation-reporter/src/cadence.ts#OFF_STREAK_TO_REST` 次才离开醒着。醒着和没醒对调立刻打一轮，休息和关机来回切不额外打。退避（`reporters/playstation-reporter/src/state.ts#backoffMs`）没到时这些都不放行。
  - `AWAKE_TICK_INTERVAL_MS` 是醒着那一档的间隔，不是两轮之间的下限：对调那一轮不等它（`reporters/playstation-reporter/src/cadence.ts#shouldRunTick`）。门只在每次探测时判，醒着时要等到过线之后的那一探，实际约每分钟一轮。
  - 下游的窗口都锚在闲档：站点判 PS 上报器断没断流用 `shared/freshness.ts#PLAYSTATION_STALE_MS`（闲档三轮多一点，只有浏览器判）。Pulse 玩那条道每次观测的有效期是 `shared/pulse-timeline.ts#GAMING_HOLD_MS`（盖过闲档再留投递抖动，`shared/pulse-timeline.ts#stateHoldMs`）：有效期内来了新观测，这一段就接着开，过期还没等到才在最后一次确认处收尾（`shared/pulse-timeline.ts#planStateObservation`）；容器每个完整 tick 都发 presence（`reporters/playstation-reporter/src/tick.ts#tick`），闲档一轮一封就接得上。主机醒着时只会更快，判活的下限由闲档决定。第 06 章不画这两个窗口。
- agents 的两档是 `reporters/agents-reporter/src/config.ts` 里 `cadence` 的默认值（容器 `.env` 可覆盖，线上值没记进 `docs/ops-facts.md`）。每家各排各的（`reporters/agents-reporter/src/cadence.ts#Schedule`）：在用的那家取完过一个快档再取，其余过一个闲档；一轮只取到期的那几家，所以有一家在用时上报器每 5 分钟跑一轮、只打那一家的限额接口，都没在用时 60 分钟一轮。等的时候每 5 分钟醒来重查一次，闲着的那家开始使用立刻提前，停用不延后已排好的那一次（`reporters/agents-reporter/src/cadence.ts#waitForNextRound`）。闲档 60 分钟 ÷ 5 = 12 次小睡。「在用」是最近一次使用落在 `reporters/agents-reporter/src/cadence.ts#ACTIVE_WINDOW_MS` 之内（写章时 15 分钟），读的是取限额的几家 agent（`reporters/agents-reporter/src/config.ts` 的 `agentIds`）在 `coding/now` 里各自的 `lastActivityAt`（`reporters/agents-reporter/src/cadence.ts#activeAgentIds`）。停手后那两轮仍是 5 分钟，过了窗口才换 60 分钟。
- 服务器上报器固定每分钟推，不问人数：这份快照本身就是心跳，站点按信封的 `updatedAt` 判它还活着没有；上报不经过站点，没有函数调用量要省，闲着时先问一次人数比直接推一次还费（`reporters/server-reporter/README.md`「节奏」）。
- 限额那一台按 agent 使用情况调频，是因为每一轮都要打各家厂商的限额接口，限额只在用的时候变（`reporters/agents-reporter/README.md`「它做什么」的每轮流程与 `reporters/agents-reporter/src/cadence.ts#waitForNextRound`）。
- agents 的活动查询读不到、超时、格式不对一律当没在用，所以故障只会让它变慢，不会变快（`reporters/agents-reporter/src/cadence.ts#readActiveAgents`）。PlayStation 和服务器都不问人数。

## 8 站点自检

第 06 章用到的部分按 3585847 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

两个方向相反的信号：

- **每分钟来敲门**：collector 的 `uptime-probe` 任务每分钟 GET `https://lyjw.me/api/version`（`shared/health.ts#SITE_UPTIME_URL`、`UPTIME_PROBE_EVERY_MINUTES`），只说明站点（site Worker）还在出页面（`src/app/api/version/route.ts#loader`）；成败按小时一格累加进 D1 的 `health_buckets` 表（`workers/collector/src/jobs/uptime-probe.ts#uptimeProbeJob`、`shared/health.ts#recordCheck`）。探测从 Cloudflare 里面发出，Cloudflare 整体出事时这一行看不出来。后端那一截看 core Worker 的 cron 心跳。
- **Worker 每 5 分钟去报到**：core cron 的每一轮跑完，自己往同一张表记一笔心跳（见 §3「core 的 cron」）。

两条记录由 **collector** 的 `site-health` 任务每 5 分钟汇总（`workers/collector/src/jobs/site-health.ts#siteHealthJob`）：各按 UTC 日切成 30 格，算 24 小时与 30 天可用率（`shared/health.ts#summarizeBuckets`、`HEALTH_DAYS`）；同一轮还向 Cloudflare 取报错数（Workers Observability 遥测查询，12 小时 / 7 天，site 与后端几个 Worker 分开，采样后的估计值）、Workers Issues 里未解决的条数，以及 Web Analytics 的真实访客 Web Vitals p75（`shared/health-cloudflare.ts#fetchErrorSeries`、`fetchFieldVitals`）。结果写进 `LAG` 的 `health:v1` 键（`shared/lag.ts#LAG_KEYS`），页面和首屏都不直连 D1 和 Cloudflare，只读可滞后层里的这份结果，经 `/api/status/health` 上 LYJWPAGE 卡：两行，lyjw.me 是每分钟那次敲门、Core 是 cron 的报到，各 30 天一天一格（`src/components/live/uptime-strip.tsx#UptimeStrip`）。站点按每天的成功率给格子上色；片中只点亮今天那一格，不出可用率，也不画报错数和 Web Vitals。

汇总读 D1 走绑定、不带令牌；向 Cloudflare 取数带的是 `CLOUDFLARE_METRICS_TOKEN`（`shared/health-cloudflare.ts#cloudflareApi`），它的权限是否覆盖 Workers Observability 在 `docs/ops-facts.md` 里标的是未核对。片中不画令牌：采集 Worker 去 D1 那一趟只标 `SELECT`。

线上报错不经过这张卡：五个 Worker 都开了 Workers Observability 和 Workers Issues（各自 wrangler 配置的 `observability.issues`），未捕获异常、5xx 和 `console.error` 按服务归组；浏览器里的报错由 `src/lib/error-report.ts#reportError` 经同源 `/relay` 交给 site Worker，校验后记成 `console.error("[browser-error]", …)`，落在服务 `site` 名下（`src/lib/error-relay.ts#ERROR_RELAY_PATH`、`parseClientErrorReport`）；断网类 fetch 拒绝和 ResizeObserver 循环提示只记 `console.warn`，不进 Issues（`src/lib/error-relay.ts#isBrowserNoise`）；采集任务失败记成一行 `event` 为 `collector-job` 的 JSON（`workers/collector/src/registry.ts#runJob`）。第 06 章收尾 Clawd 那句「我先去 Workers Issues 查证据」出自这里（根 `AGENTS.md`「排查线上错误」）。

## 9 对话与构建（workers/ai）

第 07 章「对话」用的部分，按 main 897c83d 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

不在一首歌的链路上：对话只读 core 给浏览器的同一份公开模型，不往状态里写东西。

### 发第一句之前

- 访客发第一条消息时，卡片先在本地回一段隐私说明，先选杂鱼与先知用 DeepSeek 还是 Claude，去向只列 Cloudflare Workers、Workers AI 的 Clef 与 Clairic、所选那家厂商与这个浏览器，联网搜索按实际生效的服务写；DeepSeek 阵容里 Clef 选了神时再单独问 Anthropic 那一条，拒绝就由先知答（`workers/ai/README.md`「首页对话」）；点 Accept 之前不发任何对话请求，只在后台先跑 Turnstile（`src/components/god-chat/consent.tsx#ConsentPrompt`、`CONSENT_COPY`）。同意记在浏览器里，对话代码一改就要重新同意（`src/lib/chat-consent.ts`、`scripts/chat-code-version.ts#CHAT_CODE_PATHS`）。

### 过闸（花钱之前）

- 浏览器经 core 转发到 ai Worker（`shared/ai-paths.ts#AI_HTTP_PATHS`）。先验人：通行证（验过人后签发、不绑 IP，有效期 `shared/god-chat.ts#GOD_CHAT_PASS_TTL_MS`，用掉一半随回复换新）或 Turnstile（`workers/ai/src/chat/pass.ts`、`turnstilePassed`）。
- 再过 `ChatQuota.admitVisitor` 三道：访客总量、全站路由次数（`shared/god-chat-tiers.ts#GOD_CHAT_ROUTE_LIMIT`）、这位访客此刻至少有一档访客与全站都有空位；挡下回 429，到此为止，不再付费调 Clef（`workers/ai/README.md`「首页对话」）。数值在 `shared/god-chat-tiers.ts#GOD_CHAT_QUOTA`，片中不出数。

### Clef 选档

- Clef 是 Workers AI 上的路由模型（`workers/ai/src/chat/router.ts`，`CLEF_CHOICES`）：flash（杂鱼）、think（先知）、设计（交给先知判断）、Fable、refuse，判的是档次，由谁出场看阵容；Clef 不可用时落到 `ROUTER_FALLBACK`（flash）。
- 三档与人设：Clef 只判档次，杂鱼与先知由访客在卡片里选阵容（`shared/god-chat-tiers.ts#GOD_CHAT_LINEUPS`）：DeepSeek 阵容是 DeepSeek Flash · Small Fry、DeepSeek Flash Thinking · Prophet（默认），Claude 阵容是 Haiku 5.5 · Small Fry、Sonnet 5.5 · Prophet；Fable · God 两边一样；设计请求由 Prophet 判断，设计会话里的 Opus 是 Architect（`shared/god-chat-tiers.ts#GOD_CHAT_TIER_INFO`）。选中的档满了只在同一阵容里往下逐档降，绝不往上升（`shared/god-chat-tiers.ts#downgradeChain`）。refuse 不调模型，直接回一句关门话。
- 预取：同一次 Clef 调用里另答两题，要先读哪组站点状态（`workers/ai/src/chat/router.ts#PREFETCH_STATUS`）、要先读哪篇项目文档，选中项把握够高才由 Worker 在第一次模型请求前先跑好这些工具调用；同时并行问一次 Workers AI 上的 System One 抽取模型 Clairic（`@cf/cloudflare/clairic`，同文件 `itemInput`），从最新一条里挑出访客点名的游戏、歌、番名，Clef 选中可搜的分组时再带这个名字多读一次，游戏与奖杯组另预取一张这款游戏的卡（`workers/ai/README.md`「首页对话」、同文件 `routeWithClef`）。Clairic 出错或超时只是少这一次读取。首页示例问题原文命中时不调 Clef，按示例写定的档位与预取走（同文件 `presetRoute`）。对话卡的隐私说明把 Clef 与 Clairic 都列在 Workers AI 下（`src/components/god-chat/consent.tsx#CONSENT_COPY`）。
- Small Fry 判断问题超出自己时调 `request_upgrade`，扣到先知那档的名额就由 Prophet 重答（`workers/ai/src/chat/prompts.ts#UPGRADE_TOOLS`）。

### 工具与盖章

- 站点工具 `workers/ai/src/tools/registry.ts#SITE_TOOLS` 只读公开模型：`get_site_status` 经 `PUBLIC_STATUS.readStatus(path)` 调 core 的 `PublicStatus`，和浏览器看到的同一份（`shared/public-status.ts#PublicStatusRpc`）。`show_card` 只在对话里，用同一份数据在回复里画站点卡片。
- 同一套 `SITE_TOOLS` 挂在无鉴权的 `POST /mcp` 上给外部 AI 客户端用（`workers/ai/src/mcp.ts`）；要访客确认的、只对对话界面有意义的工具不在 `/mcp`。
- 回复正常结束时 Worker 给这一问一答盖章（`workers/ai/src/chat/seal.ts`），浏览器原样带回；下一轮进 Clef 和模型之前先验章，没有章或对不上的整对丢掉。片中把这一步画成一枚章。

### 设计会话

- 站点改动请求由 Clef 交给 Prophet（随阵容是 DeepSeek Flash Thinking 或 Sonnet 5.5）；它觉得值得做才调 `start_design`，在 Claude Managed Agents 上开一个会话，同一条回复交给其中的 Opus 规划者（`workers/ai/src/chat/designer.ts`、`docs/build-routine.md`「设计与确认」）。
- 计划卡两个出口：Open issue（浏览器直接跳 GitHub 的 `improvement.yml` 表单，各字段已按计划预填，访客用自己的账号提交、不消费计划、不需授权，见 `shared/build-routine.ts#buildIssueUrl`）、Start build（点之前展开 GitHub 授权说明，接受才弹授权窗口，同意不保存，用完立即撤销，见 `src/components/github-consent.tsx#GithubConsent`）。

### 构建

- Start build：Worker 用 GitHub App 把签名计划写成 `builds/<runId>.md`，提交到分支 `claude/build-<runId>`（`shared/build-routine.ts#branchForRun`）并开草稿 PR，再以 `repository_dispatch` 派发 GitHub Actions 构建工作流（`.github/workflows/build.yml`）：一个 Claude 先审查计划，通过后另一个 Claude 在只读、拿不到回传凭据的 job 里按计划写代码（`docs/build-routine.md`「草稿与派发」「构建工作流」）。
- 工作流不持有仓库写凭据：改动由不跑 Claude 的 publish job 凭 GitHub Actions OIDC 令牌回传 Worker（`workers/ai/src/build/actions-oidc.ts#verifyActionsToken`），校验路径与大小后由 GitHub App 提交到同一分支和 PR（`workers/ai/src/build/validation.ts`）。PR 上的 Claude 审查只作参考，不授权合并（`workers/ai/AGENTS.md`）；合不合并由 lyjw 决定。
- 片中不画：计划审查、计划令牌与额度的消费细节、截图上传、构建状态的恢复。

## 10 发布（推到 main 之后）

第 09 章「发布」用的部分，按 main 5ff9c3d 逐条回代码复核过。 <!-- allow: 核对基线戳 -->

一次合进 main 同时触发几条流水线：GitHub Actions 的几个工作流、Cloudflare Workers Builds 的原生 Git 集成（站点和各 Worker 都走它，`docs/workers-builds.md` 开头）。它们各自决定跑不跑、各自构建，互不等待。

片中讲的是 PR #308 的真实合并（§11「片中的例子：PR #308（按 GitHub 读回）」）：main 从 `a451a72` 到 `cf92f7c`，改到 `shared/site-deployments-types.ts`、`workers/collector/` 下的文件和 `workers/core/README.md`（`git diff --stat a451a72 cf92f7c`）。各条跑没跑照 `cf92f7c` 上的检查；散开那一镜五盏灯从下往上亮（collector、ingress、core、CI、CodeQL），就是这几项检查完成的先后。只有 site 那盏灯放在落地那一拍，先后不对应真实：它其实在 CodeQL 之前就完成了。

开场那条主线上的七站是 main 的第一父链（按 GitHub 读回），从 HEAD 往前是 `a451a72`（#309）、`a6323be`（#307）、`325b131`（#306）、`7d35661`（#198）、`f3abe2b`（#305）、`fcab866`（#304）、`cc48db2`（#302）。发车牌上的 `18:52` 是 #308 的合并时刻（新加坡时间，§11），第二行照 main 这次 push 的前后两个提交写成 `a451a72..cf92f7c  main -> main`。

### 检查：CI 与 CodeQL（只检查、不发布）

- CI：推 main 或 dev、开 PR 都跑，一个 job 依次跑 lint、全部工作区的 typecheck、站点单测、core / ai / ingress / collector 的单测、上报器单测、`scripts` 的测试、`pnpm docs:check` 与 `pnpm docs:diagrams --check`（同一道 docs 门）、`pnpm design:scale`、`pnpm rules:check`、`pnpm ui:copy`、`pnpm baselines:check`（`.github/workflows/ci.yml#check`）。
- CI 不跑站点构建：门禁只有 lint、typecheck、单测、脚本测试、docs:check、design:scale、rules:check、ui:copy、baselines:check 九项（`scripts/ci-checks.sh` 的 `gates`），站点构建交给 Workers Builds 的 `site`（下一节）。PR 分支连推几次只留最后一次；main 按提交分组，每个提交都跑完（同文件的 `concurrency`）。
- CodeQL：推 main 或 dev，外加每天两次定时；PR 只扫访客构建的那些，扫 `javascript-typescript` 和 `actions` 两类（`.github/workflows/codeql.yml#analyze`）。推 main / dev 时按改动挑：改到 JS/TS 一类文件才扫 `javascript-typescript`，改到工作流才扫 `actions`；没改到的那一类只跳过步骤，检查照样出现（`.github/workflows/codeql.yml#changes`）。#308 改到 `.ts`，JS/TS 那一项真扫了。
- 片中 CI 和 CodeQL 各画成一条亮灯的线，不展开各项：闸口上 CI 写「每次推到 main」（`.github/workflows/ci.yml` 推 main 不按路径过滤），CodeQL 写「改到 JS/TS」；线上那一站写 job 名 `check`、`analyze`。

### 站点：Workers Builds 的 site

- 站点是 site Worker（根 `wrangler.jsonc`），由 Workers Builds 构建和部署，检查名 `Workers Builds: site`；构建命令 `pnpm build`，部署命令 `wrangler deploy`（`docs/workers-builds.md`「构建配置」）。`pnpm build` 跑 `scripts/build.mjs`：先生成讲解片的静态页和站点资产，再 `react-router build`。
- 它也按监视路径决定构建不构建，`src/*`、`shared/*` 都在内（`scripts/build-watch-paths.ts#BUILD_WATCH_PATHS` 的 `site`）；片中那次合并改到 `shared/site-deployments-types.ts`，所以这次要构建。讲解片的源 `docs/explainer/v2/*` 也在 site 的监视路径里（同文件的 `SITE_PATHS`），片尾图例「本片也坐 1 号线」说的是这个。
- UPDATE 卡上的旧版本 `7d35661` 是之前最后一次 site 部署的提交：它之后 main 上的三个合并只改了 `.claude/memory/`、`docs/ops-facts.md` 和 `HUMAN.md`，都不在 site 的监视路径里，site 没有重建，开着的页面里焊进的仍是 `7d35661`（`git diff --stat 7d35661 a451a72`）。片中主线上这一站标「上次 site 停靠」。
- `lyjw131.com` 经阿里云 ESA 回源 `lyjw.me`（§6「大陆访问」）。
- 构建不过就没有新部署，域名上仍是上一版：`/api/version` 由此刻接管生产域名的那次部署自己回答（`src/app/api/version/route.ts#loader`）。

### Worker：Cloudflare Workers Builds

- core、ai、ingress、collector 各连一个 Workers Builds 项目，生产分支 main：构建命令是各自的 typecheck，部署命令是 `wrangler deploy`（`docs/workers-builds.md`「构建配置」）。
- 各按自己的监视路径决定这次构建不构建（`scripts/build-watch-paths.ts#BUILD_WATCH_PATHS`，控制台配置的仓库内副本，见 `docs/workers-builds.md`「构建监视路径」）：四个都盯根目录的依赖与配置文件，另各盯自己的 `workers/<名字>/*`；core、ingress、collector 还盯 `shared/*`（各自排除对话与构建那几份 `shared/` 文件），ai 只盯它点名的几份 `shared/` 文件；core 另排除 `shared/ingest/*`，所以改上报校验不会重新发布带 Durable Object 的 core，页面的 WebSocket 也不断。片中那次合并改到 `shared/`（core、ingress、collector 都盯）、`workers/collector/` 和 `workers/core/`，这三个都构建成功；`shared/site-deployments-types.ts` 不在 ai 点名的那几份 `shared/` 文件里，ai 这次不构建，线上仍是上一版。片中闸口上写这次命中的一条监视路径：site、core、ingress 写 `shared/*`，collector 写 `workers/collector/*`；各线的站名照上面的构建、部署命令写 `pnpm build`、`typecheck`、`wrangler deploy`。
- Workers Builds 并行构建、不保证先后，Worker 之间的 RPC 契约只加不改，被调用方先上线（根 `AGENTS.md`「部署流程」；契约定义在 `shared/state-core.ts#StateCoreRpc` 与 `shared/collector.ts#COLLECTOR_JOBS`）。跨 Worker 的契约切换靠手动按序部署，片中不画。
- 片中不画：core 的分支 Preview、ingress 与 collector 关掉预览构建的原因、D1 迁移要先手动 apply（都在 `docs/workers-builds.md`）。

### 上报器：GHCR 与 GitHub Release

- 容器上报器：`.github/workflows/build-reporters.yml#changes` 用 paths-filter 挑出改了的目录；`.github/workflows/build-reporters.yml#build` 只出 `linux/amd64`，合进 main 时打 `latest` 和 `sha-<短哈希>` 推到 GHCR，PR 只 build 不推；`.github/workflows/build-reporters.yml#deploy` 只管 misaka-jp 上的服务：用一把只能执行部署脚本的密钥 ssh 过去，点名 pull、只重建那一个，新容器跑稳后删掉旧镜像（`reporters/misaka-deploy.sh`），再验 `status=running restarts=0`，server-reporter 另验镜像里烧进的提交就是这一版。
- dsm（emby-reporter）和 n100（playstation-reporter）在内网，Actions 够不着，按各自 README 手动更新（`.claude/rules/reporters.md`）。dsm 那台现在还是现场 build（`docs/ops-facts.md`「机器与部署位置」），所以片中不说「机器只拉镜像」。
- Mac Telemetry Hub：`reporters/mac-telemetry-hub` 是子模块，main 上的指针一动，macOS runner 就用 Developer ID 签名、`notarytool` 公证、`stapler` 钉上票据，发成本仓库的 Release `hub-build-<运行号>`（`.github/workflows/release-mac-telemetry-hub.yml#release`）；PR 上只走到公证、不发布；没配签名 secret 时整个 job 跳过。
- 这两个工作流按 `paths` 决定跑不跑（`.github/workflows/build-reporters.yml`、`.github/workflows/release-mac-telemetry-hub.yml` 的 `on.push.paths`）。#308 没改到它们的路径，两个都没跑；片中各画成一条灰掉的虚线，闸口写「没改到」，往后写「本次不停站」，这次不构建的 ai 也这样画。

### 部署成功之后：刷新 ESA、通知页面

- 站点在 main 上的构建部署成功后，GitHub 上的 `check_run`（app 为 `cloudflare-workers-and-pages`、名字 `Workers Builds: site`、结论 success）触发 `.github/workflows/purge-esa.yml`（触发条件在 `scripts/site-deploy-event.ts#siteDeploymentSha`），先等 `lyjw.me` 的 `/api/version` 答出这次的 sha（同文件的 `deployment` job，等法在 `scripts/wait-site-version.ts#waitForSiteVersion`）；域名已经答出以这次 sha 为祖先的更新提交时，这一次让位，不刷新也不通知，交给更新那次部署自己的工作流：
  1. `.github/workflows/purge-esa.yml#purge`：调 ESA 的 `PurgeCaches` 刷掉 `lyjw131.com` 首页的缓存键，再 GET 一次预热（`scripts/run-esa-purge.ts`、`scripts/esa-purge.ts#purgeEsaHomepage`、`scripts/esa-purge.ts#warmupEsaCache`）。
  2. `.github/workflows/purge-esa.yml#notify`（等刷新完）：先等 `lyjw.me`、`lyjw131.com` 的 `/api/version` 都答出这次部署的 sha，每个域名最多 `scripts/wait-site-version.ts#ATTEMPTS` 次、每次隔 `scripts/wait-site-version.ts#INTERVAL_MS`，同样遇到更新提交就让位；等不到这一步就失败，不发通知，页面靠自己的定时自查兜底（下文「收不到通知也有兜底」）。先刷新再通知，是因为反过来的话 lyjw131.com 的访客点刷新拿回的还是旧 HTML（同文件里那段注释）。
  3. 带 `lyjwpage-github-actions` 那把 Access service token 调上报入口的 `POST /api/internal/site-deployed`，这把只有 `internal:site-deployed` 与手动跑采集的 `internal:collector-refresh` 两项权限（`workers/ingress/wrangler.toml#ACCESS_CLIENTS`），不能写上报；失败重试，最长 10 分钟（`--retry-max-time 600`），理由是各 Worker 并行上线，接收端还没换版时会短暂回 404 / 405（同文件里那段注释）。
- 上报入口验过权限，经 Service Binding 调 `StateCore.broadcastVersion()`（`workers/ingress/src/worker.ts#handleSiteDeployed`、`workers/core/src/state-core.ts#broadcastVersion`）：直接交给推送房间、不经 StateHub，LivePushRoom 向所有连着的页面广播 `version`，不带数据（`payload` 为 null）；另在 `waitUntil` 里请 collector 立刻重拉部署列表与仓库统计（`workers/ingress/src/worker.ts#DEPLOYMENT_JOBS`，片中不画）。
- 页面收到 `version` 只重问自己域名上的 `/api/version`，不信推来的版本号（`src/hooks/use-live-events.ts#INVALIDATIONS`）；这个接口是构建期常量，头是 `max-age=0, must-revalidate`（`src/lib/site-policy.ts#VERSION_CACHE_CONTROL`），拿它和页面构建时焊进的 sha 比（`src/lib/app-version.ts#resolveVersionStatus`）。
- 比出来旧了：前台只弹 UPDATE 卡，刷不刷交给人（`src/components/app-version-card.tsx#AppVersionCard`）；后台标签页自己刷新（`src/components/stale-tab-reload.tsx#StaleTabReload`、`src/hooks/use-stale-auto-reload.ts#useStaleAutoReload`），有几道闸：同一个目标版本一轮最多试 `AUTO_RELOAD_MAX_TRIES` 次、两次自动刷新之间冷却 `AUTO_RELOAD_COOLDOWN_MS`、网页播放器在放不刷、sessionStorage 用不了不刷（`src/lib/app-version.ts#autoReloadDecision`）。片中只画「前台弹提示、后台自己刷新」。
- 收不到通知也有兜底：页面每 30 分钟问一次，切回前台时再问一次（`src/hooks/use-app-version.ts#REFRESH_MS`）。

### 不在这条发布链上（核过，片中不画）

- `.github/workflows/deploy-pages.yml`：只在它自己改动或手动触发时，把 GitHub Pages 发成跳到 README 架构图的转址页，和站点无关。
- `.github/workflows/preview-core-worker.yml`：PR 关闭时删掉那个分支的 core Worker Preview。
- `.github/workflows/claude.yml`、`.github/workflows/claude-code-review.yml`：PR 与 issue 上的 Claude Code，不参与发布。`.github/workflows/verify.yml`：PR 上的验证员与判定员，只往孤立分支 `verify-shots` 推截图，不参与发布。
- `.github/workflows/pr-tier-label.yml`：PR 打开或推送后，以 `lyjw131[bot]` 给 PR 贴 `tier: <档位>` 标签，改过验证员相关文件的另贴 `verifier-changed`（`scripts/pr-tier.ts`），只供查看，门槛不读它，不参与发布。
- `.github/workflows/do-not-merge.yml`：PR 标题括号里写了「不合并」时（如「（测试，不合并）」），以 `lyjw131[bot]` 贴 `do-not-merge` 标签（只加不摘）；带这个标签或标题时 `do-not-merge` 检查失败，合并钩子 `scripts/guard-merge-method.ts` 用 `gh` 读标签，带标签或读不到都拦。
- `.github/workflows/codeql-autofix.yml`（main 上的 CodeQL 跑完后为告警开修复）、`.github/workflows/explainer-score.yml`（只在讲解片配乐的输入改动时渲染上传配乐）、`.github/workflows/collector-refresh.yml`（手动触发）、`.github/workflows/avatar-sync.yml`（采集 Worker 的 avatar-watch 派发，只提交新哈希，见 §1）、`.github/workflows/issue-labels.yml`（新 issue）、`.github/workflows/build.yml`（访客构建的 `repository_dispatch`）：自己都不部署站点或 Worker。

## 11 工作流：站是怎么被造出来的（第 08 章「一句话之后」）

第 08 章用的部分按 3585847 逐条回仓库复核过；仓库外的事实以 `docs/ops-facts.md` 为出处，PR 上的事实按 GitHub 读回。本节的时刻都是新加坡时间（UTC+8）。 <!-- allow: 核对基线戳 -->

### 谁在场

- lyjw 在项目聊天里说一句要什么。项目聊天里只有一个 Claude 接话，它把每句话派到线程；一件事一个线程，线程里的 Claude 从头跟到尾，只在有结果、卡住或要 lyjw 决定时回复，平时只刷状态行（`HUMAN.md`「一眼看完」「1. 场面上有谁」）。
- lyjw 要做的只有四种事：拍板、点头让 Claude 办凭据或给控制台权限、批准生产上的动作、说一句「合」。分叉用决策卡问，推荐项已标出；不点就按推荐项走，只有没法撤销的那一步停下来等（`HUMAN.md`「一眼看完」「3. 什么 Claude 自己定，什么来问你」）。
- 要用 lyjw 的 Mac 的事（凭据、ssh、`gh`）走 Mac 上的 Remote Control 会话（`HUMAN.md`「1. 场面上有谁」）。片中不画这一路；副标题里的 Devin 指的是 PR 上的 Devin Review。线程还可以把实现、排查的活派给容器里的 Devin CLI，由 Claude 写任务书、验收后把提交重新签名进 PR（`.claude/skills/lyjwpage-devin-dispatch/SKILL.md`），片中也不画。
- 项目记忆：lyjw 用「以后…」定的规矩和做过的决定记进去一次，所有线程都遵守（`HUMAN.md`「2. 怎么说一句话最快」「9. 项目记忆」）。仓库里有镜像 `.claude/memory/`，`MEMORY.md` 是索引、每主题一个文件；项目记忆是源，镜像只用 `pnpm memory:mirror` 同步，脚本自动脱敏，遇到像凭据的内容一个文件都不写（`.claude/memory/README.md`、`scripts/memory-mirror.ts#sanitize`、`scripts/memory-mirror.ts#findSecrets`）。片中记忆卡上的三条（第三人称写 lyjw、等待都有上限、改界面等 lyjw 点头）都在根 `AGENTS.md`「工作方式」与「界面设计」里。

### 线程怎么干活

- 一个线程一个分支，名字是 `claude/project-thread-<id>`（`HUMAN.md`「5. PR 与合并」）；同一线程可以从这个分支先后开几个 PR。定时任务与访客构建用别的分支（`docs/ops-facts.md`「Claude Code 云端 routine」），片中不画。
- 提交以 lyjw 的身份、用 lyjw 的钥签名，Claude 只出现在 `Co-Authored-By` 尾注里，另带会话链接；标题写 `type(scope): 中文描述`（根 `AGENTS.md`「禁区」、`HUMAN.md`「5. PR 与合并」、`docs/ops-facts.md`「Claude Code 云端 routine」）。所以 GitHub 上 PR 的作者与合并人都显示 LYJW131。
- 推送前按改动类型跑受影响的那几项，不是每次全跑：文档 `pnpm docs:check`；逻辑跑相关单测或 `pnpm test`；类型 `pnpm typecheck`；代码 `pnpm exec eslint <改动文件>`；构建、路由、缓存 `pnpm build`；站点 UI 以浏览器端到端为准，至少桌面与 375px 手机（根 `AGENTS.md`「项目入口与验证」）。片中本地门禁卡列 docs:check、typecheck、test、eslint、build 五项，#308 没碰构建，build 那一项是灰的。
- CI 是工作流 `CI` 里唯一的 job `check`，依次过 `lint`、`typecheck`、`workspace_tests`、`script_tests`、`docs`、`design`、`rules`、`copy`、`baselines` 九道门（`.github/workflows/ci.yml#check`、`scripts/ci-checks.sh` 的 `gates`）。CI 不构建站点，见 §10「检查：CI 与 CodeQL（只检查、不发布）」。

### 机器评审

- 在 PR 上发言的评审机器人有三个：Claude review（`claude[bot]`，`.github/workflows/claude-code-review.yml#claude-review`，只在逻辑档 PR 打开和转为待审时跑，分档同 `scripts/pr-gate/tier.ts#tierOf` 的 `judge`）、Codex（`chatgpt-codex-connector[bot]`，推送后也自动再审一轮）、Devin Review（`devin-ai-integration[bot]`）。Cursor Bugbot 已被 lyjw 关掉；`cloudflare-workers-and-pages[bot]` 只贴分支预览链接，不算评审（`HUMAN.md`「5. PR 与合并」、`.claude/skills/lyjwpage-verify/SKILL.md`「3. PR 合并门槛（验证员汇总，主线程判断）」）。
- 机器人不分改动类型都会来审，但只有大改代码逻辑的 PR 才等它们：每条意见要么改，要么回复为什么不改，最后一次推送后再核一遍；机器说的不一定对，Claude 自己判断，安全类等 lyjw 拍板；Codex 每个 PR 最多三轮（`HUMAN.md`「5. PR 与合并」）。main 的分支保护要求行内评审线程全部解决才能合（`docs/ops-facts.md`「GitHub」）。

### 验证与回执

- 主线程决定验什么、判断结果；Haiku 验证员只跑检查、交回证据，不改文件、不在 GitHub 上评论、不合并。浏览器取证用 `scripts/site-verify.ts`，宽度至少 1280 桌面与 375 手机，375 另用 WebKit 截一张（`.claude/skills/lyjwpage-verify/SKILL.md`「派法」「2. UI 浏览器端到端」）。
- PR 上的验证员在 GitHub Action 里跑（`.github/workflows/verify.yml#verify`），照 PR 描述的「验证清单」验；回执由同一工作流的 publish job 以 github-actions[bot] 发成 PR 评论，第一行不动（同文件「PR 上的验证：Verify Action」「回执」）：

  ```
  验证回执 <被验提交的完整 SHA>：<等级>
  <!-- 描述摘要 <PR 描述里清单与原话的 sha256> -->

  | 项 | 检查 | 结果 | 证据 |
  没验到：<报告里那一栏，没有写「无」>
  对照清单：<清单逐项对照的结论>
  ```

- 等级只能是五个值之一：算通过的三档从高到低是 `live-ui-verified`、`unit-test-verified`、`type-check-only`；`verifier-blocked`（环境问题）与 `verifier-failed`（跑出问题）不算通过（`scripts/verify-receipt.ts#LEVELS`、`scripts/verify-receipt.ts#PASSING_RANK`）。UI 改动要 `live-ui-verified`，后端与脚本至少 `unit-test-verified`。片中的等级梯子照这五个值画。
- SHA 不手抄：第一行由 publish job 用 `scripts/verify-receipt.ts#signLine` 拼，脚本按 SHA 认回执，错一位整张作废；第二行是 PR 描述摘要，之后改了清单或原话，旧回执与判定作废（`scripts/verify-receipt.ts#digestLine`、`scripts/verify-action/report.ts#receiptComment`）。
- 合并前跑 `node scripts/verify-receipt.ts check --pr <号> --need <等级>`，要等机器评审的 PR 加 `--judge`。它只认 github-actions[bot]（按数字 id）发的回执与判定，输出 JSON：通过时 `pass` 为 true、退出码 0，回执的 `coverage` 是 `exact`（就是当前 head）或 `carried`（只把 main 合进了分支，相对 main 的补丁逐字节没变）；补丁变了是 `stale`，要重验（`scripts/verify-receipt.ts#RECEIPT_SIGNER_IDS`、`scripts/verify-receipt.ts#coverage`、`scripts/verify-receipt.ts#evaluate`）。片中的命令行省掉了 `--need` 与 `--judge`，输出只画 `coverage` 与 `pass` 两项。
- 逻辑档的 PR 每次推送，同一工作流另派一个 Opus 判定员和验证员并行（`.github/workflows/verify.yml#judge`）：没写这段代码，只拿 PR 描述里的 lyjw 原话、PR 号与 head，自己读 diff，判做没做到、有没有回归。publish job 把结论发成 PR 评论，第一行 `判定 <head 完整 SHA>：PASS` 或 `FAIL`，FAIL 不合；这一行由 `scripts/verify-receipt.ts#signLine` 拼（同文件「3b. 逻辑档的 PR：由没写代码的 Opus 判做完没有」、`scripts/verify-receipt.ts#JUDGE_LINE`）。

### 合并

- 大改代码逻辑的 PR 要 CI 全绿；文档、skill 与小改动本地跑过改动涉及的检查就合，不等 CI。碰到 Worker 监视路径的，Workers Builds 也要绿；行内评审线程全部解决（`HUMAN.md`「5. PR 与合并」）。这些门槛里机器核得了的部分（检查、该有的 Workers Builds、评审线程、Codex 轮数、回执与判定）由主线程跑 `node scripts/pr-gate.ts --pr <号>` 一条命令读全，它按改动路径给出档位 `tier`（`docs` / `ui` / `logic`），点不点头它不判（`.claude/skills/lyjwpage-verify/SKILL.md`「3. PR 合并门槛（主线程跑 `pr-gate.ts`，自己判断）」）。在此之上分三档（根 `AGENTS.md`「工作方式」、`HUMAN.md`「5. PR 与合并」）：
  1. 小改动、文档、skill，以及 lyjw 说过「推进到合并」或明确让推进的事：门槛过了 Claude 自己合，不等机器评审，不再问「合」。
  2. 大改代码逻辑的：另要处理完机器评审，并有判定员的 PASS 盖住当前 head。
  3. 有 UI / UX 变化的：先给 lyjw 看效果（桌面与 375px 截图），lyjw 点头才合；lyjw 明确要求的小改动除外（根 `DESIGN.md`「交付与合并」）。
- 大方向、大改动也等 lyjw 点头（`HUMAN.md`「3. 什么 Claude 自己定，什么来问你」）。片中三道闸各过一个 PR：文档、界面两个是示意，第二档过的是 #308。第一档的闸牌要写成「本地检查过就合」一类，不能写「CI 绿就合」：这一档不等 CI。
- 不 rebase：PR 里少于 3 个非合并提交压缩合并，3 个及以上用 merge commit（`scripts/merge-message.ts#mergeMethodFor`，钩子 `scripts/guard-merge-method.ts` 拦不合的合并，也拦带 `do-not-merge` 标签的 PR，以及按分档默认（`scripts/pr-gate/tier.ts#tierOf`）要的回执与判定没盖住 head 的 PR（`scripts/guard-merge-method.ts#receiptReason`））。合并前在 PR 分支上 `git fetch origin main`，跑 `pnpm merge-message <PR 号> "<PR 标题>"`，输出的 `merge_method`、`commit_title`、`commit_message` 与 `expectedHeadSha`（本地验过的 HEAD，PR 上多出没验过的提交时合并失败）原样交给合并接口：标题是 `<PR 标题> (#N)`；正文逐行列 PR 内各非合并提交的主题，空一行后是去重的 `Co-Authored-By`（取自各提交的尾注和作者），只留认得出身份（agent 或 GitHub noreply）且不是 lyjw 自己的（`scripts/merge-message.ts#mergeMessage`、`shared/commit-authors.ts#authorFromTrailer`、根 `AGENTS.md`「部署流程」）。
- 站点状态卡的 Commits 一栏靠这些尾注显示参与者：collector 从 GitHub 取最近提交（`shared/github-repo.ts#fetchRecentCommits`），卡上列最近几条（`src/components/live/repo-contributions.tsx#COMMIT_LIMIT`），把 main 同步进分支的合并不显示（`src/lib/recent-commits.ts#recentCommitsFrom`）。每条先写提交的人（线程的提交是「LYJW131 committed <相对时间>」），下一行写 agent「with claude (<尾注里的模型名>)」：名字是 agent 的 GitHub 账号，前面一排 16px 头像，按尾注邮箱从 `shared/commit-authors.ts#AGENTS` 认（`src/components/live/repo-contributions.tsx#CommitByline`）。片中首页提交卡省掉了模型名与头像，只画「LYJW131 committed」「with claude」和短 SHA。

### 合并之后：怎么算已部署

- 推送成功不等于部署完成。跑 `node scripts/deploy-check.ts --sha <合并提交完整 SHA> --expect auto`：`auto` 按合并提交相对第一个父提交改动的文件套生产监视路径（`scripts/build-watch-paths.ts#BUILD_WATCH_PATHS`）算出要等哪几个 Worker；等合并提交上的 `Workers Builds: *` 检查跑完（同一 Worker 只认最新那条），算出的每个都要成功；site 重建了，再等 `lyjw.me`、`lyjw131.com` 的 `/api/version` 回的 `commit` 跟上这个提交，被更新的提交覆盖也算过（`superseded`）；等待有上限（`--timeout`），输出 JSON，`pass` 为假时 `next` 写下一步（`scripts/deploy-check.ts#run`、`scripts/deploy-check.ts#classifyVersion`、根 `AGENTS.md`「部署流程」）。
- 「已部署」以 `/api/version` 回的 commit 为准，不以构建检查绿了为准（`HUMAN.md`「6. 部署与「已部署」」）；生产行为只在预览测不准的改动上复测（缓存与 Cache-Tag 清除、首屏 SSR、字体、依赖生产 Secret 或绑定的功能），看完关掉页面（`.claude/skills/lyjwpage-verify/SKILL.md`「4. 合并后部署与生产核对」）。刷新 ESA、广播 `version` 见 §10。第 09 章落地那段，拿放大镜的小 Clawd 客串的就是这一步：两个域名的 `/api/version` 先后答出 `cf92f7c`，它各跳一下（`scripts/deploy-check.ts#run`）。

### 片中的例子：PR #308（按 GitHub 读回）

- 标题「fix(collector): PageSpeed 两端各算各的，放宽超时」，18:52 合并；main 上的合并提交 `cf92f7c`，标题带 `(#308)`，正文列 4 个提交主题，尾注一行 `Co-Authored-By: Claude Opus 5.5 (1M context)`。片中合并卡照抄这 4 行主题，尾注只画到 `Co-Authored-By: Claude …`。
- 修的是：站点状态卡 Performance 区 PageSpeed 的 Desktop / Mobile 两行大部分时间是「—」。collector 每小时那一轮约一半在 120 秒处超时，桌面、移动绑在一起，一端超时整轮作废，连续作废超过 `PAGESPEED_STALE_MS` 后卡上两行就空着；改成单端等到 `PAGESPEED_TIMEOUT_MS`，一端失败只空那一端（`workers/collector/src/pagespeed.ts#PAGESPEED_TIMEOUT_MS`、`shared/freshness.ts#PAGESPEED_STALE_MS`、`src/components/live/site-status-card.tsx#SiteStatusCard`）。片中 lyjw 那张纸条「PageSpeed 两行老显示「—」」说的就是这个。
- 评审：Devin 提 2 条，Codex 审 3 轮提 3 条；4 条改了、1 条回复了不改的理由，5 个线程全部解决；Claude review 回「No issues found」。片中评审卡的先后是示意，条数和改与不改照这个。
- 验证：Haiku 验证员在 `f6ef255` 签 `unit-test-verified`；判定员在同一提交判 FAIL（README 里一句解释与代码不符）；修完后在新 head `e3886f1` 重签回执，判定员判 PASS。对 #308 跑 `verify-receipt.ts check --pr 308 --need unit-test-verified --judge`，回执与判定的 `coverage` 都是 `exact`，`pass` 为 true。
- 部署：合并提交上 site、core、ingress、collector 四个 `Workers Builds:` 检查都成功（`deploy-check.ts` 读回）。

### 夜班（定时任务，cron 都写 `CRON_TZ=Asia/Shanghai`，与新加坡时间同为 UTC+8）

| 时间 | 名称 | 做什么 |
|---|---|---|
| 01:53、07:53、13:53、19:53 | collector 盯防 | 线上只读：看站点公开状态端点与 collector 的 Workers Observability 日志，找告警漏掉的细微异常，顺带分诊别的 Worker 的新错误，两次复现了的开修复草稿 PR（每次最多一个，lyjw 关掉即否决）；写进项目的共享目录 |
| 03:15 | 记忆镜像同步 | 跑 `pnpm memory:mirror`，有差异开 `docs(memory):` PR，本地 `pnpm docs:check` 过了就合，没变化不出声 |
| 04:00 | 每日代码审查 | 从上次游标起审 main 的改动，开 `chore(review):` PR，检查与机器评审处理完自己合 |
| 04:53 | 提炼 skill 与偏差复盘 | 读各线程，把反复出现的做法写成或改进 skill，对照 lyjw 第一次怎么说和最后交付了什么找弯路；开 `docs(skills):` 小 PR，本地 `pnpm docs:check` 过了就合 |
| 08:41 | Anthropic 官方动态 | 拉 Anthropic 官方博客、文档、更新日志等新内容，逐条判断能否吸收，写进项目的共享目录；不发言、不开 PR |
| 10:56 | 晨报 | 在「晨报 · 定时任务」线程里汇总上面几个任务的结果，列出要 lyjw 做的事，一天一条；只读 |

出处：`docs/ops-facts.md`「Claude Code 云端 routine」、`HUMAN.md`「8. 定时任务与自动化」。片中夜班的时间轴从 01:53 那一次画起，只画一夜；片中把晨报画在 09:00，与上表不符。

### 提交里的 Claude

- main 上几乎每个提交都带 `Co-Authored-By: Claude …` 尾注：按 b7bf96e 数，最近 200 个非合并提交里 199 个带，没带的那个是头像同步工作流的机器人提交（`git log main --no-merges -200`，要在完整克隆上数）。第 08 章开场让历史上的提交一个个冒出 Clawd，说的是这件事；片中不出数。

### 墙上的彩蛋

- 第 08 章每个机位的墙上和地上有几件摆设，上面的字都照这个项目的规矩和旧事：
  - 「AGENTS.md ≤ 18 KB」：根 `AGENTS.md` 的上限按字节算，是 `scripts/docs-check.ts#ROOT_AGENTS_MAX_BYTES`，写在 `.claude/rules/docs-writing.md`，`pnpm docs:check` 查。
  - 「家 = localhost:3211」：`pnpm dev` 的地址（根 `AGENTS.md`「项目入口与验证」）。
  - 「禁止手跑 wrangler deploy」：根 `AGENTS.md`「禁区」，由钩子 `scripts/guard-forbidden-commands.mjs` 拦。
  - 「基线只减不增」：`pnpm baselines:check`（根 `AGENTS.md`「规则 → 由什么强制」）。
  - 纸箱 `site-assets-legacy/`「Vercel 时代」：R2 里回填的旧静态资源前缀（`src/lib/asset-archive.ts#LEGACY_ASSET_PREFIX`、`docs/ops-facts.md`）。
  - 墓碑「RIP Sentry」：Sentry 已不再使用（`docs/ops-facts.md`）。
  - 挂钟写 SGT、窗台上指着 04:00 的闹钟、「晨报 09:00」报纸、明信片「明早 09:00 晨报见」：本节的夜班表。
  - 门垫「过了门禁再进门」对应本地门禁；「本月最佳验证员」挂像里是拿放大镜的 Haiku 验证员；窗下挂钩上挂着协调 Claude 的耳机和 Haiku 的放大镜。
- 只是陪衬、不对应事实的：日历上圈的日子、LGTM 十字绣、tokens 罐子、`effort: high` 杯子（推理强度档位的名字）、仙人掌、吊灯、小旗、星座与流星、合并时的纸屑、build 那一项旁边睡着的小 Clawd。

## 片中不用或待定

- **实测延迟**：上一版的「320–490 ms（8 月实测）」作废，因为中间多了一跳 Service Binding。上画面前要重测；没重测就不出数字。
- **没有上报器再按人数调频**：agents-reporter 按 agent 使用情况，PlayStation 按局域网发现包，服务器固定。`/count` 仍在推送房间上，片中只在第 05 章当数人头的白卡画。
- **Mac `postInterval`**：默认 10 秒，注释写的是「本机 30 秒」，未确认，片中不用。
- **HA 的配置**：不在仓库里。片中只讲它报什么，不讲怎么配。

## 顺带发现的遗留（不属于动画，另行处理）

- `workers/online-counter`、`workers/ingest`、`workers/playstation-reporter`：三个目录只剩未跟踪的 `node_modules`。<!-- allow: 快照里点名的已退役目录，不在仓库 -->
