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

片中开场按「**六个外部上报器 + 一个采集 Worker**」画。仓库里还有 n100 上的 playstation-reporter，把 presence、游玩列表和奖杯 POST 到同一个 `/api/ingest/playstation`。入口来源是 `shared/ingest/prepare.ts#INGEST_SOURCES` 那一份（playstation 是其中之一），外加 Claude Code 云端遥测（OTLP）。Home Assistant 的 token 开 homepod 和 playstation 两扇门。容器自己的 Access service token 在切换时新建，登记进 `workers/ingress/wrangler.toml#ACCESS_CLIENTS`，权限只有 `ingest:playstation`。

| 来源 | 程序 / 在哪跑 | 入口 · token | 报什么 |
|---|---|---|---|
| Mac | Mac Telemetry Hub，菜单栏 App | `/api/ingest/mac` · `lyjwpage-mac` | 前台应用、窗口标题、Apple Music、充电设备、编码用量（本机的日行、最近一次用量事件、5 分钟 token 桶）、时区、Apple Music user token |
| iPhone | iPhone Telemetry Hub，HealthKit 唤醒（圆环申请 `.hourly`，训练申请 `.immediate`，但会被系统钳到每小时；ActivityModule.swift:122 / WorkoutsModule.swift:45，iPhone README:121） | `/api/ingest/iphone` · `lyjwpage-iphone` | 活动圆环、训练、五分钟步数桶 |
| Home Assistant | 家里 | `/api/ingest/homepod` 和 `/api/ingest/playstation` · `lyjwpage-home-assistant` | HomePod 正在播放；PS5 电源 `{version:1, power}` |
| PlayStation | playstation-reporter，n100 上的容器 | `/api/ingest/playstation` · 切换时新建的 service token | presence、游玩列表、奖杯。不发 `power` |
| Emby | emby-reporter，NAS 上的容器 | `/api/ingest/emby` · `lyjwpage-emby` | 在看什么；海报先传 R2 |
| 服务器 | server-reporter，东京 misaka-jp 容器 | `/api/ingest/server` · `lyjwpage-server` | 服务器状态，固定每 60 秒一次（config.ts:71） |
| 编码账号 | agents-reporter，misaka-jp 容器 | `/api/ingest/agents` · `lyjwpage-agents` | 各家编码工具限额；Cursor 账号的用量日行、最近一次用量事件、5 分钟 token 桶 |
| Claude Code 云端 | OTLP JSON（可 gzip） | `/api/ingest/agents/otlp` · `lyjwpage-claude-cloud` | 云端 token 与费用的累计值；状态核心做差后落成和另两个来源同形的日行、桶、最近事件，三处用量在状态核心合并（shared/coding-usage-sources.ts） |
| collector Worker | Cloudflare，cron 每分钟一响，任务表 `workers/collector/src/registry.ts#JOBS` | 不走 ingress | 见下文 |

PlayStation 的 presence、游玩列表和奖杯由 `reporters/playstation-reporter` POST 原始信封。采集 Worker 不拉 PSN。电源由 Home Assistant 上报。

### Mac 信封

- 结构是 `{version:4, presence, heartbeatAt, activeModules, modules:{…}}`，只带变了的模块（TelemetryEnvelope.swift:46-60，shared/ingest/telemetry.ts:269-280）。
- 没变化时每 **90 秒**发一个空信封报平安（ReportDecision.swift:155）。
- 切应用先等 **400 ms** 落定（ServiceController.swift:110）。
- 窗口标题上报前先过隐私判断，Jev 参与；只有放行的进信封（WindowTitleJudge.swift）。判据不写。

### 图片

- 在源头压一次，文件名是 `sha256(内容).扩展名`，直传 R2，带 `Cache-Control: public, max-age=31536000, immutable`（emby r2.ts:33-38、80；R2IconUploader.swift:85、101）。
- 三种图：
  - Mac 应用图标：96×96 PNG（TelemetryModules.swift:436）
  - Emby 海报：WebP q88
  - Mac 充电头封面：JPG（ServiceController.swift:1088）
- 信封里只带 `objectKey`。入口按正则 `^[a-f0-9]{64}\.(png|webp|jpe?g)$` 校验（asset-url.ts:2）。

### collector 的任务

- 最近在听：每 2 分钟调 `CORE.commitRecentlyPlayed`。用的 user token 是 Mac 推进 `CREDENTIALS` 的那一份，形成一次凭据接力。
- GitHub、Vercel、Cloudflare、Sentry、PageSpeed、厂商状态：直接写 `LAG`。
- PlayStation 不在这张表里。

## 2 上报入口（workers/ingress，`ingest.homepage.lyjw.llc`）

### 鉴权

- 走 Cloudflare Access service token，**每把钥匙只开权限表上写着的门**（Home Assistant 那一把开 homepod 和 playstation 两扇，ingress wrangler.toml:37）：
  1. Access 在边缘先挡一道。
  2. Worker 再验 `Cf-Access-Jwt-Assertion`（RS256，校验 aud / iss / exp）。
  3. 用 `common_name` 查 `ACCESS_CLIENTS` 权限表。
- 结果码：无 JWT 回 401，越权（例如拿 Emby 的钥匙写 mac）回 403，验不了回 503（access-auth.ts:43-61）。
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

- `server` 整封**不经过状态核心**：写 `LAG` 和上报器账本，另把小时汇总归档进 D1（prepare.ts:38；worker.ts:130-133；ingest-archive.ts:25-26）。
- 四路都按自然键幂等，重发不会重复写。

### 202 的时机

**202 要等三样**，而且是依次等：StateCore 回执 → `LAG` 写完 → 凭据写完 → 回 202。D1 归档在拿到回执后放进 waitUntil，不等（worker.ts:134-160）。

可滞后层的写入方（ingress、collector）没有 Vercel 密钥。写入时发现布局变了，就调 `CORE.revalidate(tags)` 请状态核心代发（worker.ts:147-151）。

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

- 共 17 张表（workers/api/migrations/0001–0007 的 `CREATE TABLE`，含已不再写的 `pulse_samples` 和记归档水位的 `pulse_archive_state`），长期保存、不按时间清理。写入按自然键 upsert，活动桶会按区间删掉重写（pulse-archive.ts:262-336、280；shared/history-ingest.ts:41-127），所以不能说「只增不删」。DO 里的 pulse 时间线只留 7 天。
- 写 D1 的有三方：上报入口（训练、圆环日读数、限额快照、服务器小时汇总）、采集 Worker（站点部署记录，`workers/collector/src/history.ts#archiveSiteDeploys`）、api（分钟 cron 的 pulse 事实表，以及收下奖杯信封后的 `workers/api/src/stores/trophy-history.ts#archiveTrophies`）。
- 活动历史桶在入口量化（eb429ed），防止 HealthKit 的浮点抖动让 D1 每次重写整个 24 小时窗口。

### api 的分钟 cron（index.ts:31-51）

- 每轮只做两件事：
  1. 把 pulse 归档到 D1：StateHub 给出一份有界快照 → 写事实表 → 回头确认水位。
  2. PulseScorer 调 Jev（`jev-1.13.0`），**只给 Coding 打分**：15 分钟一窗；全零的窗不问 Jev，直接记最低档。每轮最多 36 个窗，并发 3，超时 10 秒。
- 整 5 分钟那一轮包在 `Sentry.withMonitor` 里，向 `api-minute-cron` 报到（cron-heartbeat.ts:10-23）。
- 两件事都 `.catch` 吞错，所以心跳**只证明 cron 跑完了**，不证明归档或打分成功。
- 旧说法「叫 StateHub 重建读模型、KV 由 DO 定时任务写」已删除。

### 闹钟

- StateHub 每小时清一次过期键；一轮删满 1000 条就 1 秒后接着删（state-hub.ts:153-160）。
- LivePushRoom 在有人可见时每 30 秒清扫一次。

### Pulse 事实时间线

- 三条状态道：听、看、玩。
- 另有充电瓦数和五分钟步数桶。

## 4 首屏（Vercel 上的 Next.js）

### 按卡缓存

- `/api/home` 已删除（8977457）。首屏并行调 **25 次 `firstScreen(key)`**，外加头像和最近提交；第二轮再取图标内联、封面占位和歌词（page.tsx:57-83、104-108）。
- 每张卡读自己的 `/api/status/*`：实时卡读 DO，可滞后卡读 `LAG`（first-screen.ts:9-18）。
- 所有公开读取都先过 `publicBarrier()`（public-execution.ts:13-19）。
- **每张卡一条 `'use cache'`**，cacheLife 为 stale 300 / revalidate 600 / expire 7 天（first-screen.ts:27）。歌词另是 300 / 3600 / 86400。
- 标签：18 个 `page:` 标签；另有 7 个视图不带标签，只靠 600 秒定时重建（status-views.ts:52-99）。
- 一个标签失效，只让那张卡回源；整页在后台重建，旧页照给（`revalidateTag(…, "max")`，status-revalidation.ts:5）。

### 来源出问题时

- Worker 降级：回 `ok:false` 加 HTTP 200。
- 404：显示 "Status unavailable"。
- 5xx 或网络错误：抛出，Next **继续用上一份缓存**（first-screen.ts:15-18、34-35）。

## 5 浏览器

### 早开连接

- head 里的内联脚本在解析时就 `new WebSocket("wss://…/ws?visible=1")` 起手，把收到的消息攒下来（最多 50 条，看门狗 15 秒）。
- 这样**不用等整棵树 hydrate 完**才发起连接。hydrate 后由 `useLiveEvents` 接管这条连接，按顺序重放（live-socket-boot.ts）。
- 数字只在代码注释里有一次未注日期的「线上实测」（live-socket-boot.ts:4-10）：JS 347 ms 到齐，第一个 effect 878 ms 才发请求，中间 530 ms 是 hydration；连接本身约 250 ms；早开脚本 30 ms 起手。**片中不标这些数字**，时间轴只画示意；要标得先重测。
- 重连退避从 1 秒起、每次 ×1.5，封顶 30 秒。重连后所有实时视图立刻补取一次（use-live-events.ts:353）。

### 推送进卡片

- 带数据的推送直接 `mutate(path, data, {revalidate:false})` 写进 SWR，卡片当场更新。
- 时间戳挡旧：推送和轮询都按单调戳比较，慢回来的旧数据盖不掉新的（`acceptPush` / `guardPolled`，status-reads.ts:22-62）。

### 取数节奏（poll-schedule.ts，d38f2cd）

- 实时卡用自己的间隔：
  - 充电：30 秒
  - desktop：60 秒
  - 编码：2 分钟
  - pulse：5 分钟
  - 在听 / 在看 / 在玩「此刻」：60 秒
  - 列表类：10 分钟
- 推送连着、且视图标了 `pushCovers` 时，才退成 **5 分钟兜底**：listening、watching(-now)、playing(-now)、trophies。desktop、充电、listening-now、编码不退（poll-schedule.ts:46-48）。
- 可滞后卡不再固定轮询，而是在 `updatedAt + 节奏 + 15 秒` 时去取，也就是「下一次预期写入」。逾期后从 15 秒起退避，最长取 min(节奏, 5 分钟)。
- 标签页隐藏就暂停。

### 在线判断全在浏览器（8a7e63e）

- 源站只给时间戳、窗口和「亲口离线」。
- 首帧拿首屏信封的 `servedAt` 当钟；挂载后换成访客自己的钟，到点自己翻。

### 播放进度

- 位置 + (现在 − 观测时间)，单曲循环（repeatOne）时取模（track-position.ts:29-35）。
- 歌词逐字高亮。

### 年度图

在站点时区零点多出一格，有 2 秒宽限（use-site-day.ts）。

## 6 交付：图片、大陆访问、发版

### 图片

- 页面、状态 API 和推送里的图片一律写同源 `/img/<objectKey>`（asset-url.ts:16-21）。
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
5. ingress 经 RPC 调 `StateCore.broadcastVersion()`，进推送房间，不经 StateHub。同时让 collector 立刻重拉部署列表（purge-esa.yml:68-78；ingress worker.ts:203-210；state-core.ts:44-46）。
6. 页面重问自己域名的 `/api/version`（`max-age=0, must-revalidate`），顶上弹出 UPDATE 卡。

页面另有兜底：每 30 分钟问一次，切回焦点也问一次。

## 7 自适应调频

| 上报器 | 快 | 慢 | 怎么定 |
|---|---|---|---|
| PlayStation（n100 容器） | 主机醒着：`reporters/playstation-reporter/src/cadence.ts#AWAKE_TICK_INTERVAL_MS` | 休息或确认关机：`reporters/playstation-reporter/src/cadence.ts#IDLE_TICK_INTERVAL_MS` | 局域网发现包 UDP 9302，不问人数 |
| agents（限额） | 有人正看：5 分钟 | 只开在后台：10 分钟；没人：60 分钟 | `SITE_URL/count`，超时 2.5 秒 |
| 服务器（对照） | 60 秒 | 60 秒 | 不问 |

- PlayStation 大约每 `reporters/playstation-reporter/src/cadence.ts#PROBE_INTERVAL_MS` 发一次发现包，只在该打的时候打 PSN。`HTTP/1.1 200` 是醒着，`620` 是休息，超时或别的回复先记一笔，连续 `reporters/playstation-reporter/src/cadence.ts#OFF_STREAK_TO_REST` 次才离开醒着。醒着和没醒对调立刻打一轮，休息和关机来回切不额外打。退避（`reporters/playstation-reporter/src/state.ts#backoffMs`）没到时这些都不放行。
- agents 的时间取自 config.ts:62-64。闲档期间每 5 分钟醒来重查一次人数，60 分钟 ÷ 5 = 12 次小睡。
- 服务器上报器固定每分钟推，不问人数：闲时每分钟问一次人数本身就不比直接推省（config.ts:65-69 的注释说「问两个 Worker 的 /count」，那是 online-counter 退役前的说法，2880 这个数已过时，片中不用）。夜里只有它的心形还在跳。
- agents 的人数查询失败就当 0，所以只会变慢，不会变快。PlayStation 不问这个数。

## 8 站点自检

两个方向相反的信号：

- **Sentry 每分钟来敲门**：在线探测 HEAD `/api/version`，只说明 Vercel 还在出页面。这项配在 Sentry 侧，依据 AGENTS.md。
- **Worker 每 5 分钟去报到**：api 分钟 cron 的整 5 分钟那一轮。

Sentry 的结果由 **collector** 的 `sentry-status` 任务每 5 分钟用只读令牌取回，写进 `LAG` 的 `sentry:v1` 键，经 `/api/status/sentry` 上 LYJWPAGE 卡：30 天一天一格（sentry-status.ts:26）。

## 片中不用或待定

- **实测延迟**：上一版的「320–490 ms（8 月实测）」作废，因为中间多了一跳 Service Binding。上画面前要重测；没重测就不出数字。
- **按人数调频的只剩 agents-reporter**。PlayStation 按局域网发现包调频，片中不说「三」。
- **Mac `postInterval`**：默认 10 秒，注释写的是「本机 30 秒」，未确认，片中不用。
- **HA 的配置**：不在仓库里。片中只讲它报什么，不讲怎么配。

## 顺带发现的过时文档与注释（不属于动画，另行处理）

- `README.md:143`：还写「读取 Worker 的聚合快照」。
- `next.config.ts`：cacheComponents 那段注释还说「首屏那八份数据」，提到的 `lib/home-snapshot` 已不存在。
- `src/lib/home-layout.ts:6-8`：还说「整页只有一个 'use cache' 条目」。
- `src/lib/status-views.ts:97`：说 pulse「按分钟轮询」，实际是 5 分钟。
- `src/lib/freshness.ts`：PLAYSTATION_STALE_MS 的注释还提到端点读 `'use cache'` 快照。
- `workers/api/README.md:24`：说可滞后层端点「不过屏障」，实际所有公开读取都先等 `publicBarrier()`。
- `workers/api/src/cron-heartbeat.ts:5`：还提到 Apple / PageSpeed 抖动，这两项已搬到 collector。
- `reporters/agents-reporter/README.md:180`：还让人设 `ONLINE_COUNTER_URL`，与第 228 行矛盾。
- `workers/ingress/README.md`：说「报文坏了也先回 503」，实际不是 JSON 直接回 400。
- iPhone README：`KNOWN_MODULES` 的路径写成 `workers/api/src/phone-telemetry.ts`，实际在 `shared/ingest/phone.ts:27`。
- `reporters/server-reporter/src/config.ts:65-69`：注释说「问两个 Worker 的 /count」，online-counter 已退役。
- `workers/online-counter`、`workers/ingest`、`workers/playstation-reporter`：三个目录只剩未跟踪的 `node_modules`。<!-- allow: 快照里点名的已退役目录，不在仓库 -->
- `workers/api/wrangler.toml:68`：注释说 D1「这里只增不删」，实际活动桶会按区间删掉重写（见 §3 D1 那节）。（34eb555 复核时发现）
