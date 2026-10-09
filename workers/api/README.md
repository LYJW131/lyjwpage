# API 中枢（状态核心）

实时状态的唯一权威：StateHub 的 SQLite、公开读取、WebSocket 推送、首屏缓存失效和 pulse 的定时 cron。
上报器不直连这里：外部上报由上报入口 Worker（[`workers/ingress`](../ingress/README.md)）验明身份、校验收敛、按数据层拆开，
实时那一半经 Service Binding 调这里的 `StateCore.commitIngest`；采集 Worker 同样经 `StateCore` 交数据。
站点没有上报路由、rewrite、中继和事件发布逻辑。

## 代码职责

- `src/index.ts`：默认 Worker 入口与 cron（每 `CRON_HEARTBEAT_EVERY_MINUTES` 分钟一轮，时刻表 `src/cron-heartbeat.ts#CRON_SCHEDULE`；pulse 归档与评分，每几轮顺带做一次断流检测，见下文「断流告警」）；`src/origin-worker.ts` 负责 WebSocket 接入、人头数、公开 HTTP 和存储导入。
- `src/state-core.ts`：对内的 RPC 入口 `StateCore`（契约 `shared/state-core.ts`），上报入口和采集 Worker 经 Service Binding 调：
  `ready()`、`commitIngest(command)`（prepare 好的上报进 StateHub，效果在这里派发）、`broadcastVersion()`、`audience()`、
  `playstationPower()`、`appleDeveloperToken()`、`commitRecentlyPlayed()`、`revalidate()`。
- `src/live-census.ts`：推送房间的两个人头数（开着 / 可见）怎么数，纯函数；房间 `LivePushRoom` 在 `src/origin-worker.ts`。
- `src/ingest-handlers.ts`、`src/stores/`：上报的 StateHub 提交阶段，按来源分发；`src/phone-telemetry.ts`、`src/homepod-ingest.ts` 组合设备信封。
  准备阶段（收敛、校验、Emby 的 R2 HEAD）在根目录 `shared/ingest/`，跑在上报入口；这里只 `import type` 命令的类型（eslint 挡住值导入）。
- `src/ingest-effects.ts`、`src/fanout.ts`：StateHub 提交时只收集可序列化效果；持久化确认后由 `StateCore.commitIngest` 在 `waitUntil` 里补充外部数据、广播并通知首屏 stale。
- `src/apple-music-recent.ts`：收下采集 Worker 拉回的最近在听，差分、写入和广播。
- `src/musickit-token.ts`：给「一起听」签 MusicKit developer token（ES256 JWT），按 origin 声明缓存、过半衰期重签；同一把私钥也签服务端用的 developer token（`issueApiDeveloperToken`，经 `StateCore.appleDeveloperToken()` 给采集 Worker）。
- `src/origins.ts`：`ALLOWED_ORIGINS` 的解析、通配匹配和 CORS 头，`/ws`、公开 API 和令牌签发共用。
- 根目录 `shared/`：读写共用的 SQLite 键、类型和状态计算；根目录 `src/lib/` 提供读取与通用工具。
- 根目录 `src/lib/status-views.ts`：公开状态视图登记表（`path` / `layer` / `tag` / `event`）。路径常量、数据层、Vercel 缓存标签、事件→路径全部由它派生；可滞后层（`layer: "lag"`）不能带推送事件，模块加载时断言。
- 根目录 `src/lib/status-loaders.ts`：按同一组 key 登记 `endpoint(params)`，单端点由 `src/public-api.ts` 通用分发到对应 loader。`trophies` 无参回摘要（与首屏、推送同形状），带 `?titleids=` 回那几款的完整目录。
- `src/public-api.ts`、`src/public-execution.ts`：普通 Worker 中的公开 API 入口。已知路由先匹配，状态端点按 loader 表通用分发。StateHub 初始化/提交可见性屏障不单独发 RPC，由每次 `StateHub.publicRead` 随读取一起过：未初始化返回 `null`，入口据此回 503。屏障等待已经进入 `commitIngest()` 队列的提交，不等待仍在普通 Worker 做输入准备或 R2 HEAD 的请求；提交返回 202 后，经过 StateHub 的权威读取可见其持久化结果。可滞后层（`layer: "lag"`）的端点只读 `LAG` KV，写入方也不经 `commitIngest()` 队列，不发读取，也就不过屏障、不唤醒 StateHub（本地开着 `DEV_OVERRIDES` 时要先查 DO 里的注入，那次读取照常过屏障）；下面的按参数查询同样不过。
- `src/lookup-routes.ts`、`src/edge-cache.ts`：`/api/lyrics`、`/api/motion-artwork` 按参数查询，结果只由参数决定，不过公开读屏障。它们是给网页播放器按任意曲目查的按需端点，也是读取路径上唯一会现查 Apple 的入口；结果缓存在 `APPLE_CACHE` KV。先查当前机房的 Cache API（`caches.default`），命中不进 StateHub；未命中回源，只有 200 写回，按响应的 `max-age` 过期。条目只在当前机房、跨部署保留、不合并并发未命中，键里带 SQLite 那层的版本段，响应外形变了升 `EDGE_CACHE_VERSION`。存的响应不含 CORS 头，`X-Edge-Cache: hit | miss | bypass` 标识命中。
- `src/storage-driver.ts`：通过 alias 接入 StateHub 的 SQLite 存储驱动；同一公开请求、同一 microtask 的相邻只读批次合并成一次 DO RPC（命令数上限 `shared/storage-contract.ts` 的 `STORAGE_MAX_COMMANDS`），写批次保持原事务顺序。
- `src/lag-store.ts`：`@/lib/lag-store` 在 Worker 里的实现，读 `LAG` KV（可滞后层，格式见 `shared/lag.ts`）。厂商状态、GitHub、Vercel、Cloudflare、Sentry 这几条端点只读采集 Worker 写的那几条键，Vercel 与 Cloudflare 两条按名字把几条键拼成一份。
- `src/dev-override-reader.ts`：只在本地绑定的具名入口 `DevOverrideReader`，推送房间转发生产事件前经它查假数据注入。
- `src/tools/`：站点工具（`get_site_status`、`read_project_doc`）的定义与执行，登记表 `src/tools/registry.ts#SITE_TOOLS`；`/mcp`（`src/mcp.ts`）和首页对话共用这一份，见下文「MCP」。

## 端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/ws?visible=1\|0` | 浏览器接收事件推送的 WebSocket，页面开着就一直挂着；切可见性时发 `visible` / `hidden`；使用 `ALLOWED_ORIGINS` 校验来源 |
| GET | `/count` | `{ ok, connections, online }`：开着的页面数（判中档）与此刻可见的页面数（判快档） |
| GET | `/api/musickit/token` | `{ token, issuedAt, expiresAt }`：给「一起听」的 MusicKit developer token，同一份来源白名单；见下文 |
| POST | `/api/chat` | 首页对话卡片：Clef 选档后流式回 NDJSON；见下文「首页对话」 |
| POST | `/mcp` | 公开 MCP 端点（Streamable HTTP，无鉴权），给外部 AI 读站点数据；按 IP 过限流绑定 `MCP_LIMIT`；见下文「MCP」 |
| POST | `/api/build/session` | `/build` 页面连 GitHub：拿 App 用户授权的 `code` 和 PKCE 的 `codeVerifier` 换出身份、立即撤销访客令牌，回签好的会话 `{ session, login, name, expiresAt }` |
| POST | `/api/build/chat` | `/build` 页面的规划对话：带会话和历史，NDJSON 流式回复；规划模型提出计划时下发签好的计划 token。没有有效会话回 401，超出每小时额度回 429 |
| POST | `/api/build` | 带会话和计划 token 触发 Claude Code routine 改站，回 `{ runId, branch, sessionUrl }`；只收规划对话签出的计划，不收访客写的文字。几个端点都要 `ROUTINE_FIRE_URL`、`ROUTINE_FIRE_TOKEN`、`BUILD_SESSION_SECRET`、`GITHUB_APP_CLIENT_SECRET` 齐全（对话还要 `ANTHROPIC_API_KEY`），缺一样回 404，这些只设在分支预览上；见 [docs/build-routine.md](../../docs/build-routine.md) |
| GET | `/api/chat/usage` | 当前访客在本窗口里的对话额度，卡片 `/usage` 命令读它；只读不扣额度，按 IP 过限流绑定 `CHAT_USAGE_LIMIT`，拦下时回 429 |
| GET | `/` | 一行存活；不碰 Durable Object，根路径被探针不停打 |

上报端点（`/api/ingest/<来源>`、`/api/ingest/agents/otlp`、`/api/internal/site-deployed`）、鉴权和回执契约都在
[上报入口](../ingress/README.md)，这里没有上报路由。下面几节讲的是各来源收下之后在状态核心里怎么存、怎么推。

`/api/ingest/agents` 的主体仍是各家限额行，按 id 合并后写进可滞后层 KV（`limits:v1`），由 `GET /api/status/limits` 读出，
浏览器按 id 贴到 coding 卡片的 agent 行上（`src/lib/coding-agents.ts` 的 `codingAgentRows`）；限额的来源集合变了才失效首屏标签 `limits`。同一封可以另带三份 coding 数据，见下一节。

### coding agent 的 token 用量

三个来源只报自己观测到的原始事实，合并只在状态核心做一处（契约与校验在 `shared/coding-usage.ts`，来源登记与合并规则在
`shared/coding-usage-sources.ts`）：

| 来源（= 上报入口） | 范围 | 带来什么 |
| --- | --- | --- |
| `mac`（`modules.codingUsage` / `codingActivity` / `codingTokenBuckets`） | 设备：这台 Mac 本地日志里的会话 | 各 agent 的日行账本、最近事件、5 分钟桶 |
| `agents`（顶层同名三键） | 账号：Cursor 账号侧的完整历史 | 同上，眼下只有 `cursor` |
| `agents-otlp`（Claude Code 云端遥测） | 环境：那个托管环境里的会话 | 状态核心做差后整理成同形的三种事实，agent 恒为 `claude` |

同一 agent 有账号级来源时只算它，别的来源的同 agent 行标 `superseded`、不相加（Mac 就算又报 `cursor` 也不会双算）；
否则全部相加（claude 的本机与云端，假设彼此不重叠：云端遥测变量只配在云端）。

- **日行**：`coding:usage:<来源>` 是字段哈希，字段是 agent id，值是这个 (来源, agent) 的完整账本
  （`shared/coding-usage-view.ts` 的 `StoredCodingUsageAgent`）。一封里出现的 agent 整份替换；`state: "error"`
  只换状态、日子沿用上一份（Cursor 历史里一条坏事件让一整轮失败时也是这样，不清空）。Mac、agents 报来的是整份快照，
  采集时刻比存着的旧（重发、乱序晚到）的那一格不收；error 那一轮的采集时刻停在上次成功，所以同一时刻上 error 比 ok 新。
  云端 OTLP 的账本是状态核心按提交顺序做差攒出来的，不走这道淘汰（见下面云端那节）。日子或会话数变了才在
  同一次提交里重算视图 `coding:usage:view`（`CodingUsagePayload`：合计、全历史前三模型、各 agent 最近一个有行的日子、
  各来源状态）与年度视图 `coding:usage:year`（最近 380 天每天的合计与精确前五模型），算法是纯函数
  `buildCodingUsageView`；只有状态变了（采集时刻前进、出错 / 恢复）就在存着的视图上换掉那几格状态
  （`applyCodingUsageStatus`），不重扫日行、年度不写。日子变了的那次提交把账本修订号 `coding:usage:revision` 加一、
  改到的账本记下它（同一个事务）；只换状态不动它 —— Mac 每一轮采集都会带来新的采集时刻，D1 归档按修订号挑要重写的
  账本，不按时刻（时刻只取和存着的较大者，入口顺序与提交顺序相反时会停在水位上）。桶同理，每写一份
  `pulse:token-buckets:revision` 加一。前三、每天前五都在完整数据上精确累加；`activeDays` 是全部历史、全部 agent 的站点日并集；
  `costComplete` 看所有有 token 的日行，来源采集失败只体现在状态里。首屏标签 `coding` 只在新旧视图的骨架
  （行、总量、常用模型的有无，`src/lib/home-layout.ts` 的 `codingLayoutKey`）不同时打。
- **活动**：`coding:activity:<来源>` 整份替换（采集时刻比存着的旧就不收）。拼好整份 `/api/status/coding/now`
  推 `coding-now`：和上一次推出去的那份（`coding:now:pushed`）比，多出一个 (agent, 来源)、换了模型、时刻往前走了
  `src/stores/coding-activity.ts#PUSH_STEP_MS` 以上才推，保活不推。灯由浏览器按
  「任一来源最近事件在 `CODING_ACTIVE_WINDOW_MS` 内」现算；Mac 亲口离线时只作废 `mac` 那条（`src/lib/coding-agents.ts`）。
- **5 分钟桶**：`pulse:token-buckets:<来源>`，TTL 2 天，只给 Pulse 的 Tokens 道、Coding 评估与归档，不推送。Mac / agents 按报告
  范围替换（`[from, to)` 内以新报告为准，缺席的桶是 0，范围外不动，报告范围并进覆盖）；跨着报告起点的那一桶只数了
  一截，按 (agent, 模型) 取大的那行，不盖掉旧报告里数全了的桶。合并规则在 `shared/coding-buckets.ts`。
- **Cursor 账号观测**：agents 来源的 cursor 行另记一笔 `pulse:cursor-observations`（Coding 三色带与 Coding 评估的独立来源）：
  用量历史采集成功就是一次心跳（时刻取采集时刻），只有活动的那封时刻往前走了才记。

读出口在 `src/lib/coding-usage.ts`：`/api/status/coding` 原样给视图，`/api/status/coding/now` 与推送用同一个
`buildCodingNowAgents` 拼、外加 Mac 存活，`/api/status/coding/year` 按站点今天切出 53 周（371 天）并编码成
`days/models/mix`（`src/lib/coding-year.ts` 的 `encodeCodingYear`）。三条都归实时层，只有 `coding/now` 推送。
展示名、图标、哪几个 agent 画全量面板由站点登记表 `src/lib/coding-agents.ts` 定，来源只报 id。

本地预览用夹具（`dev-fixtures/coding-*.json`）：`/api/status/coding` 有 `coding-multi-source`（三个来源都在）、
`coding-mac-only`、`coding-no-mac`（只有 Cursor 账号与云端）、`coding-claude-cloud-today`（Mac 一整天没报、Claude 今天只有云端）、
`coding-source-error`（来源采集失败），`coding-unavailable` 是还没有任何用量时 `/coding` 与 `/coding/year` 的信封；
`/api/status/coding/now` 有 `coding-now-active`、`coding-now-mac-offline`（Mac 亲口离线：mac 那一路作废、云端与账号照亮）、
`coding-now-idle`；`/api/status/coding/year` 用 `coding-year`。日期写成 `$today` 令牌（见[本地开发](#本地开发)）。

入口对坏的 coding 模块只丢它自己、回执写 `rejected`（见[上报入口](../ingress/README.md)），不连累存活和别的模块。

### Claude Code 云端线程用量

Mac 的 ccusage 只扫本机会话记录，看不到云端线程。云端环境打开 Claude Code 内置遥测，
每分钟把指标推到上报入口的 `/api/ingest/agents/otlp`；云端环境变量、专属 Access 权限和本地调试见
[上报入口 README](../ingress/README.md#claude-code-云端线程用量)。

只收 `claude_code.token.usage` 与 `claude_code.cost.usage`，其余指标收下后忽略（返回 200 `{}`，
整封拒掉 exporter 不重试，这一轮的数就丢了）。数据点上的邮箱、账号 ID、组织 ID 在解析时丢掉，
只存 session、model、token 类型、值和时刻。只收 cumulative 时序：delta 时序的点没法去重（提交成功而回执丢了时导出端重发就会重复计数），
一律不收、记一行 `[otlp] delta temporality points skipped` 的 warn —— 云端环境要配 `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative`
（Claude Code 的默认是 delta），见到这行 warn 就是那组变量掉了。每条序列（指标、进程起点、全部属性，主会话和子代理的 `query_source` 不同就是两条）
记上次的累计值（`coding:otlp`，键和会话都只存摘要），只加差值：丢一轮下一轮补齐，重发、乱序不多算；线程恢复成新进程时起点变了，按新计数器计。
进程计数器 30 天没见就清掉。每个正差值同时落成三种事实（`agents-otlp` / `claude`）：按数据点时刻的站点日加进日行
（费用直接用 Claude Code 报的 `cost.usage`，`costComplete` 恒真）；加进数据点时刻所在的 5 分钟桶（差值实际覆盖
上一次导出到这次之间约一分钟，桶边界上最多错一分钟；没有覆盖区间、事件数为 null，只作正证据）；有 token 增量的
最新时刻与模型作为活动。闲着的进程每分钟一封也不重算视图。计数器与它做出来的账本（连同视图、年度）、活动、桶
在同一个事务里落：中途哪一步失败就一条都不落，下一封从同一个前值再做差，差值不丢。入口的收到时刻和提交顺序可以
相反，差值按提交顺序做，账本不按采集时刻淘汰，账本、活动、桶上的时刻都取和存着的较大者、不往回走。

`/api/ingest/mac` 的 `modules.desktop` 描述此刻的前台应用：`applicationName`（必填）、
`bundleIdentifier`、`windowTitle`、`iconHash` 与 `iconObjectKey`（内容地址，见下文图标那段）、
`observedAt`。这一段校验不过时响应 400，`desktop` 及其后的模块都不落地，排在它前面、已经承诺过
的写保留。窗口标题的四条规则，入库、`/api/status/desktop` 和 `desktop` 推送三处一致：

- 类型只收字符串或 `null`；给数字、对象这类值按上面那条失败，不静默当成没有标题 —— 那是上报侧
  取值路径错了，收敛掉只会让它一直错下去。
- 前后空白剪掉；剪完是空串的按没有标题算。
- 上限 200 个**码点**，超出截断且不报错。按码点不按 UTF-16 码元，否则 CJK 和 emoji 的标题会在
  边界上被劈成半个字符。
- `bundleIdentifier` 是隐藏占位符 `com.liangyangjunwei.MacTelemetryHub.hidden` 时强制 `null`。
  占位符的意思就是「这一刻不许对外说我在干什么」，应用名已经是占位符，标题不跟着清等于开后门。

出口一律带 `windowTitle`：没有标题是 `null`，不是缺字段，消费方只判空。页头（`src/components/live/live-desk-card.tsx`）展示它，应用被隐藏、离线或锁屏时不展示。

`/api/ingest/playstation` 的信封是 `{ version: 1, presence?, playedGames?, trophies? }`，
每一项各自可省、缺席表示这次不谈这一项。上报入口 prepare（`shared/ingest/playstation.ts`）
后经 `StateCore.commitIngest` 交付。`StateCore.playstationPower()` 保留在内部 RPC 契约中，
当前没有调用者；PlayStation 上报和公开状态都不使用它。奖杯信封收下之后，
这里把已获得的奖杯 upsert 进 D1 `trophies`（`src/stores/trophy-history.ts` 的 `archiveTrophies`，失败只记日志）。

奖杯内容变了（解锁、新 DLC、等级；不看 `observedAt` 和游玩时长）时广播一条 `trophies`，
带的是摘要 —— 等级、合计、最近解锁、各款进度，和 `GET /api/status/trophies` 无参回的
同一份。整份目录不推：展开着的瓷砖收到后自己重取 `?titleids=` 那一两款的切片。
解锁到页面的延迟就是上报器发现它的延迟，也就是完整 tick 的节奏。

两个数出自同一个房间、同一条连接（`src/live-census.ts`）。`connections` 静默 `CONNECTION_STALE_MS` 不计数、
`CONNECTION_CLOSE_MS` 才关，因为后台标签页的定时器会被浏览器节流；`online` 只数握手带 `visible=1` 或之后报了 `visible` 的连接，
静默 `VISIBLE_STALE_MS`（三个心跳周期）就不算，因为可见页面不会被节流，一条僵尸按 `connections` 的口径多活，就会把按人数调频的上报器（agents-reporter）
多钉在快档那么久。可见人数变了才广播 `{ type: "online", payload: { online } }`，新连接接上时单独收到一条当前值；有人可见时
挂清扫闹钟（间隔 `src/origin-worker.ts` 的 `SWEEP_INTERVAL_MS`），没人可见就停。心跳 ping 仍由运行时自动回、不唤醒房间，只有接入、
断开、切可见性和闹钟会唤醒。浏览器与 Worker 的心跳间隔共用 `shared/live-heartbeat.ts#LIVE_HEARTBEAT_MS`。

上报走 `https://ingest.homepage.lyjw.llc/api/ingest/<来源>`，由上报入口 Worker 接收：Cloudflare Access 与 service token、
`[vars.ACCESS_CLIENTS]` 权限表、回执状态码都在 [上报入口 README](../ingress/README.md)。它收下的实时那一半经
`StateCore.commitIngest` 进这里：StateHub 按到达顺序串行提交，回 `{ ready, ok, data | error }`，未初始化时什么都不写；
提交确认后，推送与首屏失效由这边的 `waitUntil` 执行。api Worker 上没有 `/api/ingest/*`。

Worker 在 SQLite 写入完成后，仅对首屏布局变化在 `waitUntil` 后台任务中通知 Vercel：POST `${SITE_URL}/api/revalidate`，Bearer 用只有 Worker 和 Vercel 两边有的 `REVALIDATE_SECRET`，只传 `{ tags }`。按白名单将 `page:<tag>` 标 stale，先返回已有 HTML，后台重建。首屏每张卡各有一条缓存、各挂自己的标签（`src/lib/first-screen.ts`），标签失效让那张卡回源、整页在后台重建，所以各上报在自己手里的新旧两份上判断布局有没有变：充电头 / 充电宝那一格亮灭、在听的 hero 出现或消失、「正在看」开播停播、续看和游玩列表空与非空、服务器首报 / 流量行 / 断流后回来、奖杯首次到达、训练那一块换占位（没收到过 / 一条都读不出 / 有训练）。判据与页面共用 `src/lib/home-layout.ts`。coding 用量卡片的骨架在状态核心重算视图时比新旧两份，行、总量与常用模型的有无变了才发 `coding`。读数、标题、进度、灯色等内容变化不通知，由首屏快照（`src/lib/first-screen.ts` 的 `cacheLife`）定时重建；浏览器挂载后直接问 Worker。通知有超时（`src/live-platform.ts` 的 `REVALIDATE_TIMEOUT_MS`），失败只记日志，不能让已落库的上报重发。纯心跳和没有标签的广播不触发缓存通知。

ESA 首页不走数据上报通知：`lyjw131.com` 以 `lyjw.me` 为源站，边缘按源站 `Cache-Control` 的 SWR 头（根目录 `next.config.ts`）自行缓存与后台取新，控制台缓存规则见 [仓库外事实](../../docs/ops-facts.md)。新版本部署上线时，由 GitHub Actions（`.github/workflows/purge-esa.yml`）刷新首页并预热边缘缓存，等两个域名的 `/api/version` 都答出这次部署的 sha 后，再调上报入口的 `POST /api/internal/site-deployed`；上报入口验过之后调这里的 `StateCore.broadcastVersion()`，向所有连着的页面广播不带数据的 `version` 事件，页面重问 `/api/version` 并弹出更新提示（同时请采集 Worker 重拉部署列表，见上报入口 README）；站点自己的版本轮询因此只作兜底。日常上报不触发刷新。

Vercel 仍采用后台重建，通知成功不代表新 HTML 已生成。ESA 后台回源可能取得 Vercel 仍在重建中的旧 HTML，下一轮刷新时收敛；这条链路不承诺两层缓存同步完成更新。首屏新鲜度不依赖这两层：浏览器挂载后直接向 Worker 取最新状态。

「正在听」的写入时补全在 `src/listening-enrichment.ts`：`StateCore.commitIngest` 对 Mac（带 `appleMusic` 模块时）和 HomePod 的报文先调 `src/lib/track-enrichment.ts#enrichTrackOutcome`，查曲目目录（当前这首和队列里的后几首）和动态封面，再把结果放进报文交给 StateHub；Mac 存成遥测字段 `musicEnrichment`，HomePod 存成快照的 `enrichment`。每段各自限时（`CATALOG_TIMEOUT_MS`、`UPCOMING_TIMEOUT_MS`、`MOTION_TIMEOUT_MS`），目录与队列并行、动态封面排在目录之后；某段失败或超时只丢那一段、打一条带阶段与曲目的 `[enrichment]` warn，状态照常落库。回执之后在 `waitUntil` 里预热歌词；写入时目录、队列或动态封面有一段没查出结果的（`EnrichmentOutcome` 的 `catalogKnown` / `upcomingKnown` / `motionKnown`），在新的请求状态里按 `RETRY_BUDGET` 整份重查一次，多查到东西就经 `StateHub.commitEnrichmentPatch` 补写（`src/enrichment-patch.ts`）：与上报同一条串行队列，当前曲目的 `trackKey` 对不上（已换歌）就丢弃；否则按块合并（`mergeEnrichment`）：目录块、动态封面、队列歌曲 ID 各自只在比已存的好时才换，队列部分还要补丁所查的队列（`upcomingKeyOf`）与已存的 `upcomingTracks` 一致，同一首歌期间队列变了就不动队列；没有一块变好就丢弃。写回只改补全字段、不动接收时间，并推一次 `listening-now`。同一曲目的新上报目录没查到时沿用已存的目录与动态封面（`keepEnrichment`），队列歌曲 ID 跟本次上报的队列走。补全结果带 `trackKey`，读取时对不上当前曲目就按未补全处理。`listening/now` 读取与 `listening-now` 推送都只用存好的补全（`candidateFrom`），不请求 Apple。最近播放首项的动态封面由 `StateCore.commitRecentlyPlayed` 补进该项的 `motion`，查不出结果时沿用同一项已存的那份。

公开 API 为 `/api/status/*`、`/api/lyrics`、`/api/motion-artwork`，没有聚合端点。Vercel 生成或重建首页时按卡读各条端点（`src/lib/first-screen.ts`），浏览器挂载后实时卡各自回源一次、之后各端点按各自周期轮询。服务端凭据不进入任何公开响应，没有通用 HTTP 数据库端点。跨域活动脉搏（pulse）的出口是 `GET /api/status/pulse`，见下面一节。

## 跨域活动脉搏（Pulse）

`GET /api/status/pulse` 是最近 24 小时「在做什么」的事实时间线，七条道：`coding` / `tokens` / `listening` /
`watching` / `gaming` / `charging` / `activity`，归实时层（状态核心 DO 直读，不进 KV），首页那张
Pulse 卡片首屏按卡读它（`src/lib/first-screen.ts`）、挂载后自己轮询。**只给原始事实**（状态、标题、瓦数、步数），档位、颜色、摘要文案都在卡片里现算，
以后换展示方式不用迁移数据。信封形状：

```jsonc
{ "ok": true, "data": {
  "generatedAt": 1770000000000,
  "window": { "from": 1769913600000, "to": 1770000000000 },
  "lanes": {
    // value：0 两者都没有，1 只有前台 coding 应用，2 只有 agent 在跑，3 两者同时
    "coding": { "kind": "coding",
      "segments": { "startSec": [0, 3600], "endSec": [3600, 7200], "value": [1, 3] },
      // Clef 的十五分钟评估：强度 0–4、置信度、模式；只在悬停里出现
      "assessments": { "startSec": [0], "endSec": [900], "intensity": [3], "confidence": [0.88], "mode": ["mixed"] },
      "summary": { "humanSeconds": 3600, "agentSeconds": 0, "bothSeconds": 3600 } },
    // 各来源、各 agent、各模型相加后的五分钟桶：fresh = input + output + cache 写入，cache 读单列
    "tokens": { "kind": "tokens",
      "buckets": { "startSec": [3600, 3900], "endSec": [3900, 4200], "fresh": [120000, 64000], "output": [9000, 5100], "cacheRead": [2400000, 1300000] },
      // peak / current 是 fresh 的每分钟速率；current 为 0 是看得见、没在用，null 是未知
      "summary": { "peakPerMinute": 24000, "currentPerMinute": null, "freshTokens": 184000 } },
    // listening / watching：0 空闲，1 暂停，2 在放；gaming：0 离线，1 在线，2 在游戏里
    "listening": { "kind": "state",
      "segments": { "startSec": [1800], "endSec": [2040], "state": [2], "title": ["群青"], "subtitle": ["YOASOBI"] },
      // 只有 listening 有：别处播放，按「最近播放的歌」列表与时长推出的每首起止；marginSec 是开播时刻的理想误差半宽
      "uncertain": { "startSec": [12000, 12261], "endSec": [12261, 12474], "title": ["夜に駆ける", "アイドル"], "subtitle": ["YOASOBI", "YOASOBI"], "marginSec": [14, 14] },
      // activeSeconds 是在放段与别处播放的并集；titles 按歌名去重，含列表里出现过的歌
      "summary": { "activeSeconds": 714, "titles": 3 } },
    "watching": { "kind": "state", "segments": { /* 同上，title 片名、subtitle 集数 */ }, "summary": { } },
    "gaming": { "kind": "state", "segments": { /* 同上，title 游戏名 */ }, "summary": { } },
    // 每段一个实测读数；段之间的空当是断流
    "charging": { "kind": "power", "segments": { "startSec": [7200], "endSec": [7800], "watts": [65] },
      "currentPowerW": null, "summary": { "peakW": 65, "energyWh": 10.8 } },
    // HealthKit 五分钟桶的步数（没有步数的桶不出现），加上已完成训练
    "activity": { "kind": "steps", "buckets": { "startSec": [0], "endSec": [300], "steps": [480] },
      "workouts": { "startSec": [0], "endSec": [1500], "activityType": ["Cycling"] }, "summary": { "steps": 480 } }
  }
} }
```

各道都**按列**给出：各列等长，第 i 行是各列的第 i 个。时刻一律是**相对 `window.from` 的整秒**，
还原为 `window.from + startSec * 1000`；`window` 与 `generatedAt` 仍是 epoch 毫秒。行 ⇄ 列的转换在
`src/lib/pulse-columns.ts`，出口和卡片共用；卡片认不出的形状（站点与 Worker 部署有先后）当没数据。
**没有段的时间就是未知**（没有观测），和观测到的空闲、离线、0 瓦、0 步分开：卡片上空闲是一条贴底的
细灰线，未知只剩虚线轨道。

**只有媒体与游戏标题公开**；应用名、模型名、充电设备名不出这个端点，Coding 只给三色带和
Clef 的强度、模式。token 只以各来源、各 agent、各模型相加后的五分钟桶出现（Tokens 道），不带模型名和来源：
Mac / agents 的桶只认起点在报告范围里的（跨着范围起点的那一桶只数了一截），被 24 小时窗口截断的首桶不画，
末桶截到这一桶里有数的来源里最晚的覆盖终点（云端 OTLP 用最后一封的收到时刻），不足 60 秒不画，只出有用量的桶。

### 存储：事实时间线

纯函数在 `shared/pulse-timeline.ts`，写入在 `workers/api/src/stores/pulse.ts`，键在 `src/lib/pulse-keys.ts`。
全部在 StateHub SQLite，TTL 是 `src/lib/limits.ts` 的 `PULSE_TTL_MS`（一直有效的开区间例外，见下）。

- **状态区间**（listening / watching / gaming）：每条道一个开着的区间 `pulse:v2:<道>:open`
  （`{from, seenAt, holdUntil, endsBy, state, …原始字段}`）加一串已关闭区间 `pulse:v2:<道>`（`{from, to, state, …}`，
  条数上限见 `shared/pulse-timeline.ts` 的 `STATE_LANE_CAPS`）。同一状态、同一标题只续 `seenAt`、`holdUntil`、`endsBy`，每条道每分钟最多写一次
  （有效期或结束时刻挪动超过一分钟也写）；状态或标题变了在那一刻关上旧段、开新段。
  `holdUntil` 是每次观测带宽限的有效期，只决定这段还开不开着、在线时画到此刻：Mac 的播放、Emby 播放与暂停
  用 `PULSE_STATE_HOLD_MS`；HomePod 只在状态变化时由 HA 推一次，按那份快照的可见期限（`src/lib/homepod-store.ts`
  的 `homePodVisibleUntil`：剩余时长加宽限，单曲循环另算，与首页判 HomePod 是否还在放同一个口径）；主机没醒时
  只按闲档查一次，用 `GAMING_HOLD_MS`；Emby 明确停播之后一直是空闲、`holdUntil` 为 null，开着的那一段不设过期，
  七天没开播仍是观测到的空闲。
  过了 `holdUntil` 来源就算断了，旧段只认到确实知道的那一刻 `max(seenAt, endsBy)`，宽限不算进事实，中间是未知：
  定期确认的来源（Mac、Emby、PSN）`endsBy` 为 null，认到最后一次确认；HomePod 的 `endsBy` 是这首按剩余时长
  该放完的那一刻（单曲循环、没有时长时为 null），一首长歌只有开头那一次推送也能整段留下到曲终。
  过期还没被下一次观测关上的段在图上也只画到那一刻，关上之后画法不变。原始字段分开存：listening 是
  `source`（mac / homepod）、`title`、`artist`、`album`、`trackId`；watching 是 `itemId`、`title`、`subtitle`；
  gaming 是 `titleId`、`title`。标题只防病态长度（`PULSE_TITLE_MAX`）。
  - listening 每封 Mac 信封（纯心跳也算）和每次 HomePod 事件都记一次，不查 Apple 目录：
    Mac 在放 → HomePod 在放 → Mac 暂停 → HomePod 暂停 → 空闲。不套首页 Hero 的 10 秒暂停宽限，
    音乐 App 停在暂停就是暂停。Mac 离线（或关了 `appleMusic` 模块）而 HomePod 也没有有效快照时是未知。
  - watching 只在 Emby 推来播放状态时记；详情按 itemId 对上才用，位置更新没带详情时沿用存着的那份。
  - gaming 每次 PSN presence 都记（它本身就是心跳）。
- **别处播放** `pulse:v2:listening-traces`：Apple「最近播放的歌」去重、最新在前，一首歌开播就排到最前
  （滞后 `shared/pulse-listening.ts#LISTENING_TRACE_LAG_MS`），但不给时刻。两轮刷新之间新播的歌是新列表的前缀
  （`playedBetween`，只比条目 id 与顺序）：每首记一行 `{since, t, title, artist, album, itemId, durationMs}`，意思是这首在
  上一轮被接受的刷新 `since` 与这一轮 `t` 之间开播，同一轮多首按播放先后排；上限 `LISTENING_TRACE_CAP`。反过来能解释旧列表的
  回应是边缘副本给的更旧列表，不记、也不当新基线；两边都解释不了的只换基线不记。
  出口画图时（`inferredPlays`）连续播放的一串里每首开播 = 第一首开播 + 前面各首时长，各行窗口都约束同一个起点，放宽
  `LISTENING_RUN_SLACK_MS` 后求交取中点，交集为空就是切歌或停过、另起一串；一首放到时长用完或下一首开播为止。不放宽时交集的半宽
  是理想误差（连续播放、滞后恰为 `LISTENING_TRACE_LAG_MS` 时），进 `marginSec`。没有时长的行在
  `LISTENING_TRACE_BRIDGE_MS` 内接到下一首开播，否则只画到自己的窗口末尾。Mac / HomePod 在放（暂停不算）同一首（`sameSong`：歌名与艺人）、前后差不过
  `LISTENING_TRACE_MATCH_SLACK_MS` 的推断已被实测解释，不再重复画。
  改这些常量或算法前后各跑一次 `node --experimental-strip-types --import ./src/lib/testing/register-alias.mjs scripts/listening-replay.mts`：
  回放一段录下来的 iPhone 连续播放（`src/lib/testing/recent-tracks-session.json`），按不同拉取间隔打印标对歌名的比例与开播误差，
  口径与当时的数字见 [别处播放推断精度实测](../../docs/listening-inference-accuracy.md)；`src/lib/pulse-listening-replay.test.mts` 守住每分钟一轮与活跃档（`workers/collector` 的 `ACTIVE_POLL_MS`）一轮的下限。
- **Coding 三色带**不另存：读时从 `pulse:coding-observations`、`pulse:cursor-observations` 与云端的
  `pulse:token-buckets:agents-otlp` 现算，切片规则同 Coding 评估特征（每条 Mac 观测撑到下一条或 3 分钟，`available: false` 不算观测）。
  human 是前台为 coding 应用（`desktop.coding`），agent 是有 agent `active`、Cursor 账号最近 5 分钟有活动，
  或云端 Claude Code 在这个 5 分钟桶里有用量（`shared/pulse-coding.ts#cloudAgentActivity`；云端只有正证据，没有桶的时段是未知，不画 0）。
  Cursor 那一路的覆盖也算「看得见」：Mac 离线而 Cursor 覆盖着且没有活动时画 0（观测到没有 agent 活动），
  这时前台其实是未知，和 Coding 评估特征的口径一致。不读档位时代的 `pulse:coding`（它让 agent 压过前台，画不出「两者同时」）。
- **充电瓦数** `pulse:v2:charging` `{t, watts, device?}`，上限 `CHARGING_SAMPLE_CAP`。闸门见 `planChargingSample`：
  跨待机门槛、换设备立刻写；通电时变化够明显才写；其余最多隔 `PULSE_REPEAT_AFTER_MS` 再确认一次。一笔撑到下一笔或
  `CHARGING_HOLD_MS`；最后一笔过期后 `currentPowerW` 为 null。
- **活动** `pulse:v2:activity` 原样留 HealthKit 五分钟桶 `{from, to, steps, moveKcal, exerciseMinutes}`（缺项为 null），
  iPhone 每次查询是一段权威范围：范围内旧桶按新结果修订或删除，`pulse:v2:activity:range` 记范围，
  `pulse:v2:activity:revision` 在内容真变了时 +1（归档用它挡较旧的替换）。写入只从第一处不同的桶往后重写，
  通常每封只动最后一两行。训练区间 `pulse:v2:workouts` `{items:[{startedAt, endedAt, activityType}]}` 由 iPhone 训练
  写入口自己留一份（训练卡片那份列表在可滞后层 `workouts:v1`），内容没变不写。

本地预览用夹具：`pnpm dev:override /api/status/pulse pulse-busy-day.json`（另有 `pulse-empty`、`pulse-zero-lanes`、
`pulse-activity-boundary`，以及 `pulse-tokens-idle`：Tokens 道白天有用量、此刻为 0）。卡片右下角开发开关「Traces」切换别处播放的斜线 / 淡色画法，默认斜线。

### Coding 的 Clef 评估

Clef（Workers AI 上的决策模型，经 `AI` 绑定调用）只给 Coding 打分：原始观测说得出「前台是不是 coding 应用、agent 在不在跑」，说不出「写得多投入」，
强度和模式仍问模型，只在悬停里出现。别的道画的就是事实本身，不再有模型分、趋势和置信度。
`PulseScorer` 和 `pulse:assessments` 只剩 `coding`；StateHub 的 metadata 保存评分 claim、generation、lease 和
最近尝试时刻；普通 Worker 领取固定输入快照（评估、Coding 观测、三个来源的 token 桶、Cursor 观测）、执行模型请求，
再用 token + generation 提交，过期任务不能覆盖新结果。公开的评估只有区间、强度、置信度与模式；
概率分布、输入哈希、模型名和评分时刻只留在库里。

cron 落在窗口结束后 `PULSE_SCORE_SETTLE_MS`（`src/pulse-score.ts`，等采集与上报到齐），每个五分钟时段最多一轮尝试；没有可评的窗口时不交还任务，租约 `PULSE_SCORE_LEASE_MS` 短于 cron 间隔，下一轮前自然过期（`src/cron-heartbeat.test.ts` 守着）。有活动，或覆盖不全、缺报、
未知的窗口，每个十五分钟一份 Clef 请求（型号写在 `src/pulse-score.ts#clefDecide`），强度、连续性、模式一起评估。窗口被完整观测且信号
全是 0 时不请求模型，写成确定的最低档（强度 0、连续性 0、置信度 1、mode idle，模型名 `rules`）。每轮最多
36 份请求、并发最多 3，优先新窗口再补最近 24 小时，稳定时每小时最多 4 次。没有观测不调用，也不写评分。
没有 `AI` 绑定（`wrangler.test.toml` 不配，本地起的 Worker 都不评分）、或本地配了 `DEV_OVERRIDES` / `UPSTREAM_API_URL` 时停用。

决策模型不会数数、不会算时长、不比时间戳，所以发给它的 state 是代码算好的命名秒数和次数
（`shared/pulse-coding.ts` 的 `codingWindowFeatures`）：`codingAppSeconds`、`agentActiveSeconds`、
`concurrentAgentSeconds`、`codingAppAndAgentSeconds`、切换次数、最长连续时长、观测覆盖和前几个应用 / agent，
没有原始区间或时间戳；判据写在 `instructions` / `criteria` 里。

`PULSE_ASSESSMENT_VERSION` 进输入哈希，改问题时升版本让全部窗口重评，不靠哈希碰巧变。
改判据先跑 `node --experimental-strip-types --import ./src/lib/testing/register-alias.mjs scripts/clef-probe.mts`
（读环境变量或根目录 `.env.local` 的 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`，令牌要有 Workers AI 权限；`CLEF_PROBE_MODEL=clef-flash` 换小模型）：几个代表性的 Coding 窗口打真实 Clef，每条都写着期望答案，
偏了先改措辞再上线——改判据上线会触发最近 24 小时重评。相同输入哈希不重复调用；晚到 token 改变窗口事实时
只重评受影响窗口。失败保留旧成功记录，下一轮重试，存储读失败不会清空历史。评估列表追加写，同一窗口以
最后一行为准，被覆盖的行多过有效行的 `COMPACT_GARBAGE_RATIO` 或总数超过 `COMPACT_MAX_ROWS`（`src/pulse-score-state.ts`）才整表压缩。

token 证据来自三个来源的 5 分钟桶（上一节）。原始桶保持五分钟，不随 Clef 评分改动；评分时聚合窗口内三个桶，
按 (来源, agent, 模型) 相加，每行带 `source`。`observedBucketCount` 只数被 Mac 本机扫描的报告范围完整盖住的桶：
范围内缺席的桶是零事件，范围外或 Mac 的来源 partial / unavailable 保留 unknown；「确定为零」只认 Mac 的覆盖。
Cursor 账号与云端 OTLP 的桶只作正证据（没行不代表 0），不按 token 计费的请求记 0 token、1 次事件，照样算活动。
每行有 `inputTokens/outputTokens/cacheReadTokens/cacheCreationTokens/reasoningTokens/eventCount`；input 不含 cache read，
reasoning 属于 output 子集，eventCount 是去重用量事件数（数不出来的来源为 null），不宣称上游 HTTP 请求数。

不上传提示词、回复正文、项目路径或 session ID。token 是工作活动的证据，不是生产力。
Mac 同状态每分钟最多保存一次内部观测，变化立即记录；缺报三分钟后中断。
Cursor 使用独立的 `pulse:cursor-observations`：agents 来源的 cursor 活动往前走了、或成功的 cursor 用量采集都会记录，账本内容没变化也更新观测。重复、乱序的采集时刻不延长有效期，error / warning 不当成零活动。检查覆盖最多保持 `shared/pulse-cursor.ts` 的 `CURSOR_OBSERVATION_HOLD_MS`（略长于账号上报器闲时最长的上报周期）；最近事件只按 5 分钟活动窗口计入，之后仅表示 Cursor 来源可用。Mac 离线不会抹掉这份覆盖，Cursor 过期也不会抹掉 Mac 的覆盖；两者并集去重。仅 Cursor 可用且没有活动或正 token 证据时直接写 0，置信度为 0.5，内部模型标记为 `rules:limited-source`，不调用模型；这不等于确定全局没有 Coding。

### 长期归档（D1）

写入方是状态核心：cron 每轮调一次 StateHub 的 `pulseTick`，同时拿到评分任务和归档快照；StateHub 按各路水位（metadata `pulse-archive:v2:<路>`）给出一份有界快照，
普通 Worker 按自然键拼成 upsert（活动桶另有受版本保护的范围删除）写 D1，全部成功后才确认水位；一路读坏、写坏不挡别的路。
奖杯目录是另一张表 `trophies`，在收下奖杯信封后写（`src/stores/trophy-history.ts#archiveTrophies`），不走这张水位。
代码在 `src/pulse-archive.ts`，表在迁移 `0007_history_pulse.sql` 与 `0008_coding_usage.sql`：

| 表 | 内容 | 自然键 |
| --- | --- | --- |
| `listening_plays` | 每段实测在放（`certain = 1`，来源 mac / homepod，曲名 / 艺人 / 专辑 / 曲目 id）与别处播放的原始窗口（`certain = 0`，`source = 'recent'`，`started_at` / `ended_at` 是开播所在的 `(since, t]`，同一轮多首按播放先后给 `started_at` 加 0、1、2… 毫秒；曲名 / 艺人 / 专辑照列、曲目 id 在 `item_id`；`title` 为空的是专辑粒度的痕迹，专辑 / 歌单名在 `album`） | `(source, started_at)` |
| `watching_sessions` | 同一条目首尾相接的播放 + 暂停，`playing_seconds` 只算在播 | `(item_id, started_at)` |
| `game_sessions` | 在游戏里的时段 | `(title_id, started_at)` |
| `charging_samples` / `charging_sessions` | 过了闸门的瓦数；一次充电的起止、峰值、能量、设备 | `t` / `started_at` |
| `activity_buckets` | HealthKit 五分钟桶原值；范围替换由 `pulse_archive_state` 里 `activity_buckets` 那行的版本挡住旧快照 | `started_at` |
| `coding_observations` | Coding 原始观测（agents 为 JSON） | `t` |
| `coding_usage_days` / `coding_usage_models` | 来源 × agent × 站点日的日行（token 分类、reasoning、合计、API 等值费用、费用是否估全）与当天按来源的模型拆分 | `(date, source, agent)` / `(date, source, agent, model)` |
| `coding_usage_buckets` | 各来源的五分钟 token 桶，agent × 模型（云端 OTLP 的事件数为 NULL） | `(bucket_at, source, agent, model)` |
| `coding_active_days` | agent 在跑的秒数（来自 Coding 观测），`model = '*'` 是当天合计 | `(date, agent, model)` |

日行按「修订号过了水位的 (来源, agent) 账本」整份 upsert（每行存着写下它的修订号，只在新来的修订号更大时才改：两轮归档重叠、旧快照晚写时不回退；`coding:usage:revision` 没过水位就不读账本；
桶那一路同样按 `pulse:token-buckets:revision`，这两路的水位是修订号、不是时刻），
存事实不存合并：被账号级来源覆盖的 Mac cursor 行照样归档，合并规则只在视图里。模型拆分只增不删，来源事后从某天
拿掉的模型旧行还在。桶不汇成日：Mac / agents 只写起点被报告范围盖住的桶，还在累积的末桶照写、下一次用更完整的数覆盖；
报告范围本身不归档，所以归档里「没有行」分不清是零事件还是没报。`coding_active_days` 按 max 只增不减，
3 分钟保持，Cursor 只有账号级。`model = ''` 是没有模型名的 token 事件。

旧表 `coding_token_buckets`、`agent_usage_days`、`pulse_samples` 已冻结、不再写；`0008` 把 Mac 的桶和活跃秒数复制进了新表，日事实不回填
（新契约第一封就带完整历史）。新增迁移要先应用、再部署带 `HISTORY` 绑定的版本（命令见「配置与部署」），迁移文件在 `migrations/`。

## 最近在听

拉取在采集 Worker（`workers/collector` 的 `apple-recent`，节奏见该任务，不看有没有人在看），
拉回来的专辑粒度列表经 `StateCore.commitRecentlyPlayed` 交给这里差分、落库、推 `listening`；同一轮拉的单曲列表
（带每首时长、目录 id 与封面）经 `StateCore.commitRecentTracks` 与上一轮比较，新播的歌记成 Pulse 听歌道上的别处播放（`pulse:v2:listening-traces`），
有新歌就推一次 `listening-now`：`listening/now` 读取与推送都从同一批痕迹推出 `elsewhere`（此刻大概在别处放的那首，按时长放完后再留
`LISTENING_ELSEWHERE_HOLD_MS` 等下一首）。`commitRecentTracks` 的回执带 `nextBy`：照推断接着放，下一首最晚这一刻排进列表最前，
采集 Worker 据此提前补拉一次（`shared/pulse-listening.ts#nextTraceBy`）。api 自己不拉，WebSocket 连上也不触发。

`commitRecentlyPlayed` 的第二个参数是专辑粒度列表最前那个歌单 / 专辑里可播的歌（按容器里的顺序，带时长与封面；电台为 null，缺省不动存着的那份），
变了才写 `apple-music:playing-container:v1` 并推一次 `listening-now`。`elsewhere.next` 是照规则推出的下一首（`shared/pulse-listening.ts#predictedNext`），
只看最后一段连续播放（相邻两首停得不超过 `LISTENING_SESSION_GAP_MS`）：

- `loop`：最近几首按同样顺序完整重复过一轮（一轮 2 到 `NEXT_LOOP_MAX` 首），下一首照上一轮。手动凑几首循环就是这种。
- `order`：连着 `NEXT_IN_ORDER_MIN_RUN` 首（含正在放的）对上容器里相邻的歌，下一首是容器里的后一首；放到最后一首不猜，不知道是否整单循环。

两条都成立时用 `loop`。随机播放、刚开始放、换了容器而列表还没跟上时为 null，卡片就不显示 Up Next。
单曲循环看不出来：列表去重，同一首重放不会再排一次。Apple 不给别的设备上的队列、随机或循环开关，手动插进 Up Next 的歌只能等它放过一轮。
`scripts/listening-replay.mts` 末尾按录下来的那段歌单顺序播放回放下一首的猜中、猜错与不猜次数，`src/lib/listening-next.test.mts` 守住猜错为零。
Mac 上报的 Apple Music 凭据在凭据 KV（`shared/credentials.ts`），不向外提供凭据端点；状态读取不触发拉取或广播。

## 首页对话

`POST /api/chat`（`src/chat/handler.ts`）收浏览器的对话历史与 Turnstile token，契约在 `shared/god-chat.ts`：请求体、NDJSON 事件、上下文与输出上限都在那一份，站点卡片 `src/components/god-chat.tsx` 读同一份。

- 一条消息的路径：请求体按读到的字节数截停（`src/chat/guard.ts#readJsonBody`）→ Turnstile 校验（`TURNSTILE_SECRET_KEY`；除了 success，还核对 action 是 `shared/god-chat.ts#GOD_CHAT_TURNSTILE_ACTION`、hostname 落在 `ALLOWED_ORIGINS` 里，见 `turnstilePassed`）→ `ChatQuota.admitVisitor` 在路由前过三道：访客总量、全站路由次数（`shared/god-chat-tiers.ts#GOD_CHAT_ROUTE_LIMIT`，各档全站名额之和）、这位访客此刻至少有一档访客与全站都有空位；访客自己超额回「Too many prayers」，全站忙回「All the heavens are busy」，都是 429，到此为止、不再触发付费的路由 → Clef 选档（`src/chat/router.ts`，经 `AI` 绑定调 `@cf/cloudflare/clef`，选项在 `CLEF_CHOICES`：Haiku 按思考强度拆成 low / medium / high 三项，加 Opus、Fable 与 refuse；Clef 不可用时落到 `ROUTER_FALLBACK`）→ `ChatQuota.admitTier` 扣档位额度，该档满了就往下逐档降级（`shared/god-chat-tiers.ts#downgradeChain`）→ 调 Anthropic（`ANTHROPIC_API_KEY`）。refuse 不调模型，只占访客总量与一次全站路由，直接回一句关门话。
- 三档与人设：Fable 是神、Opus 是先知、Haiku 是杂鱼，型号与展示名在 `shared/god-chat-tiers.ts#GOD_CHAT_TIER_INFO`。提示词在 `src/chat/handler.ts`：`BASE_PROMPT` 讲清 Clef 怎么选档、额度用完怎么降级，`PERSONA` 告诉每档自己是哪个模型、什么身份；被降级时另在末尾加一条 system 消息说明替谁作答（`downgradeNote`），不动缓存前缀。
- 额度数值在 `shared/god-chat-tiers.ts#GOD_CHAT_QUOTA`（窗口、访客总量、每档访客与全站），计数在 Durable Object `ChatQuota`（`src/chat/quota.ts`，全站一个实例 `global`，SQLite 存窗口内的命中，每次调用先删窗口外的再数再记）。`/api/chat/usage` 读同一份；它不验人，每次都要进这个全站共用的对象跑一个事务，所以先过 Rate Limiting 绑定 `CHAT_USAGE_LIMIT` 按 IP 限流；这类绑定在生产实测拦不住单 IP 的持续请求，只是尽力而为（见 `docs/ops-facts.md`）。`resetInMs` 倒数到这位访客看到的数下一次会变的时刻（自己最早的命中过期，或某档全站、全站路由次数已满时它最早的命中过期）；路由次数不单列在用量里。没有 `CHAT_QUOTA` 绑定时对话端点回 503，不放行。真正的花费上限是 Anthropic Console 里这把 key 所在 workspace 的月度上限（见 `docs/ops-facts.md`）。
- 对 Anthropic 的请求不从 Worker 当地机房直接发：Anthropic 拒绝来自不支持地区（如香港）的请求，回 403 `Request not allowed`，而 Worker 跟着访客落在亚洲机房。SDK 的 `fetch` 换成转给 Durable Object `AnthropicEgress`（`src/chat/egress.ts`），它以 `locationHint: "wnam"` 建在北美，只转发 `api.anthropic.com`。本地没有这层绑定时直接发。
- 中断：Worker 开了 `enable_request_signal`，入站请求的 `signal` 一 abort 就停下工具循环，SDK 的 fetch 信号带进 `AnthropicEgress`，那边再经带信号的管道掐断对 Anthropic 的连接（原样直通响应体时取消要拖十来秒才传到上游）。但线上 Cloudflare 在流式响应途中不把访客断开传给 Worker（见 `docs/ops-facts.md`），这套接线只在本地 workerd 起作用：生产里访客点停止后模型照样生成到这条回复结束，多花的不超过这一条回复剩下的部分（各档 `maxTokens`，兜底拒答时最多再溢出一次 `max_tokens`，且受额度约束）。
- `draft_github_issue`（`src/chat/issue-draft.ts`）只起草：NDJSON 发一行 `issue`，卡片打开可编辑的表单，模型自己提交不了。访客点提交时在弹窗里走 GitHub App `LYJW131` 的用户授权，带 PKCE（S256）：卡片每次提交现生成 code verifier，只放在这次提交的内存里，授权 URL 只带它的 SHA-256。回调页 `src/app/github-callback/page.tsx` 与卡片同源，读完参数先把 code 从地址栏抹掉，只把 code 经 postMessage 交回同源窗口；卡片把 code、`codeVerifier` 和改过的标题正文 POST 到 `/api/github/issue`（`src/github-issue.ts`），verifier 不合 RFC 7636 的直接 400。Worker 用 `GITHUB_APP_CLIENT_SECRET` 加 verifier 换出访客的 token，单拿到 code 换不出来；以访客身份在 `shared/github-issue.ts#GITHUB_ISSUE_REPO` 开 issue，随即撤销 token，不存。这个端点按 IP 过 Rate Limiting 绑定 `GITHUB_ISSUE_LIMIT`。访客没有推送权限时 GitHub 会丢掉标签，所以来源靠正文末尾的固定一行标记。
- `show_card`（`src/chat/show-card.ts`）在回复里画一张实时卡片：模型只选卡片名，卡片名与每张卡片背后的状态视图登记在 `shared/god-chat.ts#GOD_CHAT_CARD_VIEWS`，模型给不了任何文字、图片或链接。NDJSON 发一行 `card`，站点 `src/components/chat-card.tsx` 按登记的视图读公开状态自己画，画在收到这一行时正文已到的位置；它和首页卡片共用 SWR 缓存键，推送写进同一份缓存、卡片跟着变，自己不轮询。工具结果把同一组视图的数据回给模型（走 `get_site_status` 的执行与这条回复的账本，读过的不再读），模型据此用一两句话作答、不复述卡片内容。同一条回复里同一张卡片只画一次。
- 请求带 `thinking.display: "summarized"`：模型思考时流出 `thinking` 事件（思考摘要），卡片在正文出来前显示，正文开始后折叠；摘要不进对话历史。
- 模型由 Anthropic 的拒答兜底（`fallbacks: "default"`，Haiku 没有）换掉时，NDJSON 末尾多一行 `served`，卡片标出实际作答的模型；下一轮的 trace 带 `fallback`。兜底按单次请求生效、兜底模型自己也可能拒，所以只按给出最终答案的那一轮、且它没被拒时才报。
- 读取类工具有三种。前两种是和 `/mcp` 共用的站点工具（`src/tools/registry.ts#SITE_TOOLS`），对话把整条回复的调用记在同一本账本（`newLedger`）上：`get_site_status` 经 `executePublicRequest` 读本 Worker 的公开状态视图（和浏览器看到的同一份公开模型，不出网），一条回复里所有调用合计有视图数上限、读过的不再读（`src/tools/site-status.ts#claimViews`）；`read_project_doc` 读本项目的设计文档（`src/tools/project-docs.ts`），只认 `PROJECT_DOCS` 白名单里的文档键，运行时从公开仓库 main 分支的 raw.githubusercontent.com 取并在边缘缓存，所以改文档不用重发 Worker、新增文档才要加一行；长文档先回目录和开头，模型再按章节读，一条回复的读取次数有上限（`claimDoc`，上限说明经 `replyCap` 只附给对话）。`web_search` 是服务端工具，Haiku 用基础版，其余用带动态过滤的版本（原因写在 `src/chat/web-search.ts#webSearchTool`），每轮请求的 `max_uses` 是这条回复还剩的次数，用完就不再带这个工具。
- 历史由浏览器提交，Worker 给每一问一答盖章（`src/chat/seal.ts`，HMAC 密钥是 Secret `CHAT_HISTORY_SECRET`，缺了对话端点回 503）：回复正常结束时 NDJSON 末尾发一行 `seal`，带章和 trace（哪一档答的、读过哪些视图与文档、搜了几次、是否兜底代答、起草过 issue、画过哪些卡片），浏览器原样带回。章签的是「访客消息 + 回复 + trace」整对，进 Clef 与模型之前先验章，没有章或对不上的一对整对丢掉：Clef 拒掉的、模型拒答的、半路中断的、浏览器伪造或改过的都进不了上下文。验过章的 trace 拼成一条说明附在那条回复之前的访客消息里（`src/chat/history.ts`），模型因此知道那条回复当时查过什么；说明只用枚举与计数拼，不带自由文本。
- 回复上限按档位定（`shared/god-chat-tiers.ts#GOD_CHAT_TIER_INFO` 的 `maxTokens`）；思考强度在选中 Haiku 时由 Clef 一并选出，其余情况（Opus、Fable、降级、强制档位、Clef 不可用）取同一处的 `effort` 默认值。访客没有手动调高的命令。`maxTokens` 是一条回复所有轮次（工具循环、暂停续跑）合计的输出上限，每轮请求只给剩下的部分；每轮按计费量扣（`src/chat/billing.ts#billedOutputTokens`）。同一请求内本档中途拒答后兜底模型还能再用满一次 `max_tokens`，这部分溢出有意接受。省钱靠 system 与末尾各一个缓存断点；缓存按模型分开，换档不会互相命中。
- 本地：`workers/api/.dev.vars` 配 `ANTHROPIC_API_KEY` 与 `TURNSTILE_SECRET_KEY`（可用 Cloudflare 官方测试密钥）；只在配了 `UPSTREAM_API_URL` 的本地与预览里认 localhost 签出的 token 和测试密钥的结果，生产不认，所以 `pnpm dev`（本地页面连生产 Worker）里对话会验人失败，调对话用 `pnpm dev:worker` 加 `pnpm dev:local`。同样只在这两处认两个调试开关：`CHAT_RATE_LIMIT=off` 关限额（`ChatQuota` 照样记账，`/usage` 仍看得到用量，只是不拦），`CHAT_FORCE_TIER=<档位|CLEF_CHOICES 的键>` 跳过 Clef（如 `haiku-high`）。本地 `AI` 绑定总是连远程，需要 wrangler 已登录。预览不复制 Secret，所以预览上这个端点回 503。

## MCP

`POST /mcp`（`src/mcp.ts`）是给外部 AI 用的公开 MCP 端点，不要鉴权。对外地址是 `https://lyjw.me/mcp`：站点在 `next.config.ts` 里用 307 跳到本 Worker（307 保留 POST 与请求体，MCP 客户端会跟），不用 rewrite，否则 Worker 只看得到 Vercel 的出口 IP，按 IP 限流就成了所有人共用一个桶。

- 工具就是 `src/tools/registry.ts#SITE_TOOLS`，和首页对话同一份定义与执行。这里只放只读、只读公开模型的工具：`draft_github_issue`（要访客在卡片里确认）、`show_card`（只对对话卡片有意义）和 `web_search`（Anthropic 服务端工具）只在对话里。每次调用各开一本账本，单次调用的视图数与截断长度和对话相同，跨调用不累计。
- 协议：无状态，只回 JSON，不发会话 ID，不开 SSE（GET、DELETE 回 405），JSON-RPC 批量请求回 400。两代客户端都收：`_meta` 里带版本的新协议（`MODERN_VERSIONS`）逐个请求核对 `MCP-Protocol-Version`、`Mcp-Method`、`Mcp-Name` 头与正文一致，`server/discover`、`tools/list` 带缓存提示（`CACHE_HINTS`，缺了 Claude Code 整张工具表都不认）；旧协议（`LEGACY_VERSIONS`）先 `initialize` 握手。
- 限流与来源：按 `CF-Connecting-IP` 过 Rate Limiting 绑定 `MCP_LIMIT`，拦下时回 429 带 `Retry-After`；和 `CHAT_USAGE_LIMIT` 一样只是尽力而为（见 `docs/ops-facts.md`）。带 `Origin` 的请求按 `ALLOWED_ORIGINS` 校验（与 `/api/*` 同口径），不在名单里回 403；服务端和桌面端的 MCP 客户端不带 `Origin`，不受影响。
- 验证：`src/mcp.test.ts` 覆盖两代握手与报错，但客户端会按自己的 schema 严格校验结果，单测验不出这类不兼容；改了协议处理，起 `pnpm dev:worker` 后用真实客户端各连一次：`claude -p --strict-mcp-config --mcp-config '{"mcpServers":{"lyjw":{"type":"http","url":"http://localhost:8788/mcp"}}}' "…"` 走新协议，`npx @modelcontextprotocol/inspector --cli http://localhost:8788/mcp --transport http --method tools/list` 走旧协议握手。

## MusicKit 令牌

访客用自己的 Apple Music 订阅跟听之前，先得有一份 developer token 才能把 MusicKit JS 配起来。
这份令牌发给**任何一个访客**，和凭据 KV 里 Mac 上报的那份私人凭据（带 music user token）
不是一回事、不共用路径。

`ALLOWED_ORIGINS` 一份名单，两道限制：

1. **谁能来要令牌** —— 比请求的 `Origin` 头，配了名单之后不带这个头一律拒绝。这道只是让
   「拿一份」不那么随手，Origin 头非浏览器伪造得了。
2. **令牌只在这些域上有效** —— 名单里写死的域签进 JWT 的 `origin` 声明，由 Apple 校验。
   通配项（`https://*.vercel.app`）Apple 不解析，匹配到的预览域名和 localhost **只签它自己一个**，
   不把生产域名一起捎上；否则任何人带一句 `Origin: http://localhost:3000` 就能要走一份在
   `lyjw.me` 上可用的令牌。

同一份 origin 声明的令牌在 isolate 里复用，过了「签发 → 到期」的中点才重签；`issuedAt` 和
`expiresAt` 一起给，站点用同一条半衰期规则决定何时再要。响应一律 `Cache-Control: no-store`。
出错时 `{ "error": "..." }`：403 来源不对、405 方法不对、500 变量没配或私钥坏（只有自己写死
的配置提示外带，运行时异常只进日志）。

三样东西来自 [Apple Developer](https://developer.apple.com/account/resources/authkeys/list) 勾了
**MusicKit** 的密钥：`APPLE_MUSIC_TEAM_ID`、`APPLE_MUSIC_KEY_ID` 放 `[vars]`，
`APPLE_MUSIC_PRIVATE_KEY`（`.p8` 全文，带不带 PEM 头尾、换行是真的还是 `\n` 都吃）走 secret。
有效期 `MUSICKIT_TOKEN_TTL_SECONDS` 不填按 `DEFAULT_TTL_SECONDS`，上限 `MAX_TTL_SECONDS`（Apple 允许的最长期限）；不取上限是因为令牌一旦被复制走，
域名限制之外就只剩有效期这一道闸。

## 断流告警

cron 心跳与 `HEAD /api/version` 在线探测都不经过数据链路，上报器断了它们照样绿。断流检测补这一块，代码在 `src/freshness-watch.ts`。

**节奏**：cron 每 `FRESHNESS_CHECK_EVERY_ROUNDS` 轮查一次（按 `scheduledTime` 取轮次，不存计数）。最短阈值是 `QUEST_STALE_MS`，值得告警的断流按小时计，检测晚几轮换来成倍少的读量。
只在归档或评分开着时跑（与它们同一道隔离闸：preview、`DEV_OVERRIDES`、`UPSTREAM_API_URL` 都不跑），本地空库不会报断流。

**来源**：只覆盖按固定节奏上报、断了就是坏了的来源；按事件才上报的（iPhone 活动与训练、HomePod、时区）不算。阈值一律复用站点卡片判过期的那个常量，告警与卡片同一口径。

| 来源（`freshness.source`） | 读哪里 | 时刻字段 | 阈值 |
| --- | --- | --- | --- |
| `quest` | StateHub `questMirror` | `observedAt` | `shared/quest.ts#QUEST_STALE_MS`，判法就是 `questNow` 的 `available` |
| `playstation` | StateHub `presenceMirror` | `observedAt` | `src/lib/freshness.ts#PLAYSTATION_STALE_MS` |
| `emby` | StateHub `resumeMirror`（续播列表，上报器至少每 `FULL_PUSH_INTERVAL_MS` 整推一次） | `at` | `shared/emby-store.ts#RESUME_STALE_MS` |
| `server` | LAG `server:v1` | `updatedAt` | `SERVER_STALE_MS` |
| `agents-reporter` | LAG `reporter:agents-reporter:v1`（每封都写，与站点状态卡那一格同源） | `updatedAt` | `AGENT_LIMITS_STALE_MS` |
| 采集 Worker 写的各条键 | LAG，见 `src/freshness-watch.ts#LAG_FEEDS` | `updatedAt` | 上文「外部数据卡片」那张表的卡片阈值 |

同一上报器只看一条：`reporter:server-reporter:v1` 与 `server:v1`、`limits:v1` 与 agents 账本都来自同一个上报器，两条都看会一次断流报两遍。
StateHub 的三条用一次 `publicRead` 批量读，键取各 mirror 的 `key`（`src/lib/storage.ts#mirrorKey`），不另抄键名。读不到的来源（没写过、DO 未初始化、读失败）这一轮不下结论、沿用上次状态，读故障不会被报成断流或恢复。

**只在翻转时报**：翻转状态是 LAG KV 里的一条 `freshness-watch:v1`（`{ updatedAt, data: { <来源>: "fresh" | "stale" } }`），只在有来源翻转时整份写一次；没有记录的来源按新鲜算，所以首次部署时已经断着的来源会报一次。先写状态再发事件，写失败这一轮不发、下一轮重判。

**事件格式**：每次翻转一条 Sentry 消息，进 `api-worker` 项目：

| 字段 | 断流 | 恢复 |
| --- | --- | --- |
| 消息 | `Feed stale: <来源>` | `Feed recovered: <来源>` |
| level | `warning` | `info` |
| tag | `freshness.source=<来源>`、`freshness.state=stale` | 同左，`freshness.state=recovered` |
| fingerprint | `["freshness", <来源>, "stale"]` | `["freshness", <来源>, "recovered"]` |
| extra | `lastSeenAt`（ISO）、`ageMinutes`、`thresholdMinutes` | 同左 |

每个来源的断流、恢复各归成一个 issue，告警规则按 tag 过滤，配在 Sentry 控制台（仓库外）。

### cron 失败口径

- StateHub 整个调不通（`pulseTick` 抛错）：这一轮抛给 `Sentry.withMonitor`，按失败报到，`withSentry` 同时记一条异常。监控 `failureIssueThreshold` 见 `src/cron-heartbeat.ts#CRON_MONITOR_CONFIG`。
- 子步骤失败（归档、评分、断流检测）：只打 `console.warn` 并记一条 `warning` 级异常（tag `cron.step=pulse-archive | pulse-score | freshness-watch`），这一轮照常报 ok。取舍：站点「API」在线行读的就是这个监控，子步骤坏了 API 本身仍在服务，不该让在线行闪；子步骤的故障靠事件看。StateHub 内部 `pulseTick` 里读归档快照、领评分任务各自兜底，只记 warn，不算 StateHub 调不通。

## 配置与部署

生产发布走 Cloudflare Workers Builds 原生 Git 集成，推送 `main` 且本 Worker 或共享代码变化时触发。构建命令、监视路径与验收流程见 [原生部署配置](../../docs/workers-builds.md)。

`wrangler.toml` 中配置公开变量 `SITE_URL`、`STORAGE_PREFIX`、
`APPLE_MUSIC_STOREFRONT`、`ALLOWED_ORIGINS`、`APPLE_MUSIC_TEAM_ID`、
`APPLE_MUSIC_KEY_ID`（响应里的图片地址是 `/img/<对象键>` 同源路径，Worker 不配交付域，
回源 R2 由站点的 rewrite 和 ESA 负责，见根 README「图片」；上报器直传图片那个桶的 HEAD 在上报入口），
以及 `LIVE_PUSH` 与 `STATE` 两个 Durable Object 绑定（迁移只追加新 tag，不改旧的）。`LAG`、`CREDENTIALS` 两个 KV 绑定见 `shared/lag.ts`、`shared/credentials.ts`，这里只读（唯一例外是 cron 写断流检测的翻转状态 `freshness-watch:v1`，见「断流告警」）；`HISTORY` 是长期归档用的 D1 库 `lyjwpage-history`（这里写 Pulse 事实表，收下奖杯信封后写 `trophies`；上报的那几张表由上报入口写，站点部署由采集 Worker 写，见上文「长期归档（D1）」），
几乎只增不删（活动桶按权威范围替换）、无公开读路径，建表只在 `migrations/` 里，部署带这个绑定的版本**之前**先手动应用一次
（`pnpm --dir workers/api exec wrangler d1 migrations apply lyjwpage-history --remote`，Workers Builds 不跑迁移），
边界与回滚见 [Worker 数据后端与首屏缓存](../../docs/state-storage.md)。
实时状态存在 StateHub，展示快照存在 `LAG`，凭据存在 `CREDENTIALS`，Vercel 不连接任何数据库。秘密通过以下命令配置：

```sh
pnpm --dir workers/api exec wrangler secret put REVALIDATE_SECRET
pnpm --dir workers/api exec wrangler secret put APPLE_MUSIC_PRIVATE_KEY < AuthKey_XXXXXXXXXX.p8
pnpm --dir workers/api exec wrangler secret put ANTHROPIC_API_KEY
pnpm --dir workers/api exec wrangler secret put TURNSTILE_SECRET_KEY
```

外部数据的令牌（GitHub、Vercel、Cloudflare、Sentry、PageSpeed）在采集 Worker 上，见 [采集 Worker README](../collector/README.md)。PSN 登录在 `reporters/playstation-reporter` 的数据卷里。

站点配置 `NEXT_PUBLIC_BACKEND_URL=https://api.homepage.lyjw.llc` 与相同的
`REVALIDATE_SECRET`；浏览器由这一个源拼 `/ws` 和 `/api/musickit/token`。所有上报器的目标为
上报入口 Worker（`workers/ingress`）在 ingest 域名上的 `/api/ingest/<来源>`，不经过站点。PlayStation 的游戏数据也走这一条：`reporters/playstation-reporter` POST 原始信封。按人数调频的是 agents-reporter，读此源 `/count` 的 `connections` 与 `online`；server-reporter 节奏固定，PlayStation 按局域网发现包调频，都不读它。实例清单见 [端点核验记录](../../docs/reporter-endpoints.md)。

提交并推送 main，由 Cloudflare Workers Builds 原生 Git 集成自动部署。
`shared/`（`shared/ingest/` 除外，校验改了只发布上报入口）、共用 `src/lib/`、根依赖及路径配置变化也触发 api 部署，见 [原生部署配置](../../docs/workers-builds.md)。

## 本地开发

```sh
cp .dev.vars.example .dev.vars      # STATE_IMPORT_SECRET 本地随便填；外部数据的令牌放 workers/collector/.dev.vars
pnpm dev:worker                     # 仓库根目录执行；http://localhost:8788
pnpm dev:worker:init                # 只需一次，初始化空的 StateHub
pnpm dev:local                      # 站点指向本地 Worker
```

`pnpm dev:worker` 是一个 `wrangler dev` 进程、四份配置：`workers/dev-router/wrangler.toml`（第一个，拿端口）、
本目录的 `wrangler.test.toml`、`workers/ingress/wrangler.test.toml` 和 `workers/collector/wrangler.test.toml`。多配置下只有第一个 Worker 有端口，
dev-router 按路径分发：`/__dev/collector/*` 给采集 Worker 的调试入口（见它的 README），
`/api/ingest/*` 与 `/api/internal/site-deployed` 给上报入口，其余一切（含 `/ws`、`/api/internal/storage/import`）给 api。四个 Worker 共用 `--persist-to`，
`LAG`、`CREDENTIALS` 两个本地 KV 用同一个 id，一边写的另一边读得到；Service Binding 按生产名字
（`api`、`ingress`、`collector`）互相找到，所以本地 api 的名字也是 `api`。
`curl localhost:8788/cdn-cgi/local/scheduled` 触发的是 dev-router 的 `scheduled`，它让采集 Worker 跑这一分钟到期的任务；
api 自己的 cron 本地触发不到（Service Binding 调不了别的 Worker 的 `scheduled`），它本地要做的
D1 归档、Clef 打分本来也被隔离开关关着。

本地用 `wrangler.test.toml`：生产配置里的 `deleted_classes` 迁移在空环境下起不来，测试配置有从头开始的迁移链，且没有生产域名和 cron。
状态持久化在 `.wrangler/dev-state`（`DEV_WORKER_STATE` 可以另指一个目录），重装或想清库就删它，再跑一次 init。

本地是空库。`.dev.vars` 里的 `UPSTREAM_API_URL` 让 `publicResponse` 按端点整份兜底（`src/public-api.ts#overlayResponse`）：生产回 `ok:true` 的端点整份用生产的，
生产没有的端点、或生产也 `ok:false` 的才用本地的（只读、不上报）。不按字段合并：给已有端点加的新字段，本地算出来也会被生产那份整份盖掉，
要看就用下面的 `pnpm dev:override` 把本地那份注入到该端点。生产的 wrangler.toml 不配它。
分支预览是同一套兜底的线上版：`wrangler preview` 在生产脚本 `api` 上按分支开一份隔离的 Preview，Vercel 预览改连它。见 [Workers 构建](../../docs/workers-builds.md)。
要测上报链路，把这个变量注释掉让本地只看自己，然后往 `http://localhost:8788/api/ingest/<来源>` 推（dev-router 转给上报入口）。本地没有 Access：
先 `node scripts/dev-access.mjs init` 生成测试钥匙、把它打印的 `ACCESS_DEV_JWKS` 填进 `workers/ingress/.dev.vars`（上报入口那份，不是本目录的），
推的时候带 `node scripts/dev-access.mjs header` 打出的 `Cf-Access-Jwt-Assertion` 头（10 分钟有效），见 [上报入口 README](../ingress/README.md#本地开发)。

配了 `UPSTREAM_API_URL` 后，本地的推送房间还会在有页面连着时自己去连生产的 `/ws`，把事件转发给本地页面（最后一个页面断开就跟着断，不多占生产那边的连接数），所以本地也能收到实时推送。事件对应的端点有生效的注入时，payload 换成注入的那份，假数据不会被生产一推就盖掉。

`DEV_OVERRIDES=true` 时另开 `PUT` / `DELETE /api/dev/override/<端点路径>` 和 `GET /api/dev/overrides`，往本地 SQLite 里注入某条端点的信封，
优先于上游和本地；夹具放 `dev-fixtures/`，用根目录的 `pnpm dev:override` 推。`src/origin-worker.ts` 只在这个变量开着时放行非 GET。
夹具里的时间戳写成 `"$now"` / `"$now-90000"`（毫秒偏移），推送脚本在发出前换成当下 —— 注入绕过路由，没人替它续心跳，写死的 `pushedAt` 几分钟就会被判成过期。
按站点日判的日期串写成 `"$today"` / `"$today-1"`（按日历加减天数，站点时区），「最近一天是不是今天」这类夹具靠它。

## 验证

```sh
pnpm --dir workers/api typecheck
pnpm --dir workers/api test
node scripts/verify-api-worker.mjs --build
```

集成脚本和 `pnpm dev:worker` 一样用 dev-router 把上报路由到上报入口、经 Service Binding 打本 Worker，启动隔离 SQLite、KV 和缓存通知测试服务器，检查鉴权、404、初始化屏障、并发假数据索引、写入、缓存失效、真实 WebSocket（含部署通知的 `version` 事件）、重启持久化。`--build` 还会在已初始化的隔离 Worker 存活期间，把 `NEXT_PUBLIC_BACKEND_URL`（状态、推送与在线人数同源）指向该本地地址并运行生产构建。退出时清理临时状态，不使用生产绑定或凭据。

SQLite 初始化、迁移与权限见 [后端架构](../../docs/state-storage.md)。

## Durable Object 迁移

生产服务是 `api`（域名见 `wrangler.toml`）。迁移只追加新 tag、不改旧的；`v3-chat-quota` 新建首页对话的计数类 `ChatQuota`，`v4-anthropic-egress` 新建出站转发类 `AnthropicEgress`；`v1-transfer-from-ingest` 把旧 Worker 的 SQLite 命名空间整体转移（ID 与数据不变），不要对这些类另加创建或删除迁移，见 [AGENTS.md](./AGENTS.md)。

## 外部数据卡片（可滞后层）

厂商状态、GitHub 贡献日历与仓库统计、Vercel、Cloudflare Workers、Sentry 这几条端点的数据都由采集 Worker
（`workers/collector`）按各自节奏拉取、写进可滞后层 KV（`shared/lag.ts` 的键表），这里的公开端点**只读**：
不持有任何外部令牌、不在读路径上现拉、不推送。每条都带写入方最后一次成功取到的时刻，信封里给 `updatedAt`；
过没过时由浏览器按 `src/lib/freshness.ts` 里各块的阈值判断，过了那一格回到「—」或 Unavailable，服务端不下结论。
还没写过的键回 `ok: false`（等采集）。取数口径、失败时的沿用规则、节奏与监控见
[采集 Worker 的 README](../collector/README.md)。

| 端点 | 读哪几条键 | 卡片阈值（`src/lib/freshness.ts`） |
| --- | --- | --- |
| `/api/status/agent-status` | `agent-status:v1` | `AGENT_STATUS_STALE_MS` |
| `/api/status/github-chart`（可带 `?since=`） | `github-chart:v1`，切片在这一侧做 | `GITHUB_CHART_STALE_MS` |
| `/api/status/github-repo` | `github-repo:v1` | `GITHUB_REPO_STALE_MS` |
| `/api/status/vercel-deployments` | `vercel-deployments:v1` + `vercel-metrics:v1` + `pagespeed:v1` | 部署 `VERCEL_DEPLOYMENTS_STALE_MS`、指标 `VERCEL_METRICS_STALE_MS`、PageSpeed `PAGESPEED_STALE_MS` |
| `/api/status/cloudflare-workers` | `cloudflare-metrics:v1` + `cloudflare-deployments:v1`，按 Worker 名拼 | 统计 `CLOUDFLARE_METRICS_STALE_MS`、部署 `CLOUDFLARE_DEPLOYMENTS_STALE_MS` |
| `/api/status/sentry` | `sentry:v1` | 各块 `SENTRY_STALE_MS` |

几份拼起来的端点，各部分带自己的采集时刻（Vercel 部署的 `fetchedAt`、指标每组的 `fetchedAt`、PageSpeed 最近一轮的
`fetchedAt`；Cloudflare 统计的 `fetchedAt` 与部署的 `deploymentsFetchedAt`；Sentry 各块的 `blockAt`），卡片分别判过期。
信封的 `updatedAt` 取最常刷新的那一份，用来决定挂载时要不要补取一次，也是后续轮询排期的依据（`src/lib/poll-schedule.ts` 的 `nextLagDelay`）。

### Workers 统计

只查询本仓库的 `api`、`ingress`、`collector`（名单在 `src/lib/cloudflare-workers-types.ts`，
GraphQL 的 `scriptName_in` 跟着它），不公开账号内其他 Worker；还没部署的脚本那一格为空。
统计是一个滚动窗口（长度与对齐粒度见 `workers/collector/src/jobs/cloudflare.ts` 的 `WINDOW_MS`、`WINDOW_ALIGN_MS`）的调用量、执行错误、子请求和整段窗口 CPU P50（微秒转成 `cpuTimeP50Ms`），
采样统计不是账单，也不将执行错误等同于 HTTP 错误或可用率。部署只投影部署时间、正在分流的版本与比例，
以及流量最大版本的提交 SHA、分支和标题（改密钥这类没有构建记录的版本借前一个有构建的版本的提交）。
两半按 Worker 名拼，名单再变也不会错位。不输出部署作者、邮箱或账号凭据。

### Vercel 部署与指标

`targets.production` 决定当前生产版本，新构建失败或回滚不会把最新创建的部署误当成线上版本；另带最近几次部署。
`metrics` 两组各带采集时刻与窗口：`functions` 是最近十二小时生产环境的函数调用、错误、超时、CPU P75 与平均峰值内存；
`analytics` 是前七个完整 UTC 日的页面浏览与访客（不累加每日独立访客数）。
仅公开这些聚合指标及部署 ID、状态、时间、生产/预览标记、提交 SHA、分支和标题。

### 性能评分（PageSpeed Insights）

同一份载荷的 `pagespeed` 字段，数据来自 Google `runPagespeed`，与 Vercel 无关，所以不在 `metrics` 里。
测的是 `lyjw.me`（`src/lib/site.ts` 的 `site.url`），载荷里带着这个地址，卡片表头显示它。
这是**实验室数据**：一台模拟设备上跑出来的，不是访客的真实体验，所以没有 INP，表上那一列是同一轮测出的 TBT。
**每一格是滚动窗口内各轮实测的中位数**（窗口长度与样本上限见 `src/lib/pagespeed.ts` 的 `WINDOW_MS`、`MAX_SAMPLES`），一轮异常被旁边几轮压住；
载荷里的 `samples` 与 `start` 是参与的轮数和最早一轮的时间。

### Sentry

四块数据：`uptime`（对 `https://lyjw.me/api/version` 的在线探测，配置见 [仓库外事实](../../docs/ops-facts.md)）、`heartbeat`（本 Worker cron 的
心跳监控 `api-minute-cron`，只算 production；cron 每 `CRON_HEARTBEAT_EVERY_MINUTES`（`src/lib/sentry.ts`，站点卡片上的文案也读它）分钟一轮，每轮都报到，监控的 crontab 与 wrangler 触发器同是 `src/cron-heartbeat.ts#CRON_SCHEDULE`；slug 里的 minute 不改，改了丢监控历史）、
`errors`（production 报错：`site` 是站点项目，`worker` 是 api 与采集 Worker 两个项目合计）、
`vitals`（站点 production 的 7 天 p75 与样本数，站点按 Lighthouse 曲线算出 Users 那行的分）。
只放计数、比率和时刻，不放 issue 标题、报错内容和调用栈。

## 常驻上报器账本

misaka-jp 上的 server-reporter 与 agents-reporter 每封报文顶上带一个 `reporter` 块：镜像提交（Actions 以 `GIT_SHA`
烧进 `REPORTER_COMMIT`）、窗口内（`push-ledger.ts` 的 `WINDOW_MS`）推成功几封（含这一封）、这些封往返的中位数 `rttMs`、窗口起止。次数和延迟由
上报器自己数（两边同一份 `push-ledger.ts`），上报入口只校验、把最新一份加上收到的时刻写进可滞后层（每个上报器一条，
`reporter:server-reporter:v1` / `reporter:agents-reporter:v1`），由 `GET /api/status/reporters` 给卡片服务区最后两格。块写坏或上报器没带都当没有，不因此拒掉整封上报。

## 最近训练

`POST /api/ingest/iphone` 的 v1 信封接受 `modules.workouts: { items: [...] }`，每次完整替换最近的训练，最多 `WORKOUT_LIMIT` 条（`shared/workouts.ts`，空列表清空）。记录字段为 `id`（HealthKit UUID）、`activityType`（英文类型）、`startedAt` / `endedAt`（epoch 毫秒）、`secondsFromGMT`（训练当地 UTC 偏移秒）、`durationSeconds`（扣除暂停的活动秒数），以及可选的 `distanceMeters` / `activeEnergyKcal`、`averageHeartRateBpm` / `maximumHeartRateBpm`、`elevationAscendedMeters`、`indoor`（boolean）。缺失指标对外为 null，不能解释为零。

`GET /api/status/workouts` 返回 `{ items, pushedAt }` 的标准状态信封，信封带 `updatedAt`。训练列表是可滞后层的一条（KV `workouts:v1`，`{ updatedAt, data: { items } }`），由上报入口在这封 iPhone 上报的状态核心那一半成功之后整份写入；上报带的心率摘要只进历史归档，写入和读出都经 `shared/workouts.ts#publicWorkout` 只留公开字段；`pushedAt` 就是 `updatedAt`，读时补上。状态核心只留 Pulse 活动道要的训练区间（`pulse:v2:workouts`）。训练是历史事实，列表不设过期阈值，只有取数失败时卡片注明同步延迟。首页 `workouts` 缓存标签只在训练那一块换占位（没收到过 / 一条都读不出 / 有训练）时失效，条目增减交给定时重建；浏览器按 `STATUS_VIEWS.workouts.cadenceMs` 排期轮询（`nextLagDelay`），不新增推送事件。

活动圆环（`modules.activity` 里的当天圆环）同理：读数在 KV `activity:v1`（`{ updatedAt, data: ActivityStatus }`），只在这封带了当天圆环时写，只带五分钟统计桶的上报不碰它；五分钟桶是 Pulse 的输入，留在状态核心。`GET /api/status/activity` 读 KV，`pushedAt` 取 `updatedAt`，「手表那边还是不是这一天」（`currentAtSource`）在读时按源站的钟现算。卡片超过 `ACTIVITY_STALE_MS` 没有新读数就写 Unavailable，版面不动。

本地预览：`pnpm dev:override /api/status/workouts workouts.json`，夹具仅供开发环境，启用时页面显示 Fake data。真实记录需要安装 iOS 27 上报器并允许训练读取。

`workouts.json` 是从真机读取的最近一批训练快照（剑术、骑行、滑冰），保留原日期与观测指标，UUID 替换为演示标识。信封的 `updatedAt` 与 `pushedAt` 注入时更新，但训练时间不变；圆环夹具 `activity-afternoon.json` 同样带信封级 `updatedAt`。剑术不把步行距离当成主要成绩；滑冰没有距离就不显示速度；网页每项最多两个指标：有距离时显示时长与距离，否则显示时长与活动消耗；不展示心率或均速。

网页卡片按页横向吸附滚动（每页条数与页数由 `src/components/live/workouts-strip.tsx` 定），隐藏独立标题栏，通过触控板、触摸或键盘横向浏览；上报和存储仍保留最近 `WORKOUT_LIMIT` 条。训练记录合并在 Activity 卡片右侧（窄屏放底部），圆环区域保持原高度；出口节点卡全宽排列在其下。

## Quest 实时游戏状态

`/api/status/quest/now` 从 StateHub SQLite 读取最新 Quest 快照。`available` 区分可信空闲与断流，陈旧窗口由 `shared/quest.ts#QUEST_STALE_MS` 定义；过期保留观测时刻，`playing` 返回空值。上报带的 `discordStatus`（Discord 账号的在线状态）只存不出：公开快照与推送都不带，它单独变化也不推送。内容变化或断流后的恢复发送 `quest-now`，普通心跳仅更新存储；按 `observedAt` 拒绝旧值与重复报告。首页的 Now Playing 卡读这个视图，「在玩」有无切换时失效首屏标签 `quest-now`。游戏道（Pulse 的 `gaming`）由 PlayStation 与 Quest 合并写入（`src/stores/quest.ts`、`src/stores/playstation.ts`）：Quest 在玩时记 Quest 的游戏（`shared/pulse-timeline.ts#questGamingFacts`，`titleId` 带 `quest:` 前缀），这期间 PS 的上报不改写游戏道；Quest 从在玩变为不在玩时交还 PS 的状态，PS 也已过期就记离线；其余时候游戏道只由 PS 写。上报入口与信封见 [Ingress](../ingress/README.md#quest-实时游戏状态)。
