# API 中枢（状态核心）

实时状态的唯一权威：StateHub 的 SQLite、公开读取、WebSocket 推送、首屏缓存失效和 pulse 的分钟 cron。
上报器不直连这里：外部上报由上报入口 Worker（[`workers/ingress`](../ingress/README.md)）验明身份、校验收敛、按数据层拆开，
实时那一半经 Service Binding 调这里的 `StateCore.commitIngest`；采集 Worker 同样经 `StateCore` 交数据。
站点没有上报路由、rewrite、中继和事件发布逻辑。站点部署在 Vercel，腾讯云 EdgeOne 已退役。

## 代码职责

- `src/index.ts`：默认 Worker 入口与分钟 cron（只剩 pulse 归档与评分）；`src/origin-worker.ts` 负责 WebSocket 接入、人头数、公开 HTTP 和存储导入。
- `src/state-core.ts`：对内的 RPC 入口 `StateCore`（契约 `shared/state-core.ts`），上报入口和采集 Worker 经 Service Binding 调：
  `ready()`、`commitIngest(command)`（prepare 好的上报进 StateHub，效果在这里派发）、`broadcastVersion()`、`audience()`、
  `playstationPower()`、`appleDeveloperToken()`、`commitRecentlyPlayed()`、`revalidate()`。
- `src/live-census.ts`：推送房间的两个人头数（开着 / 可见）怎么数，纯函数；房间 `LivePushRoom` 在 `src/origin-worker.ts`。
- `src/ingest-handlers.ts`、`src/stores/`：上报的 StateHub 提交阶段，按来源分发；`src/phone-telemetry.ts`、`src/homepod-ingest.ts` 组合设备信封。
  准备阶段（收敛、校验、Emby 的 R2 HEAD）在根目录 `shared/ingest/`，跑在上报入口；这里只 `import type` 命令的类型（eslint 挡住值导入）。
- `src/ingest-effects.ts`、`src/fanout.ts`：StateHub 提交时只收集可序列化效果；持久化确认后由 `StateCore.commitIngest` 在 `waitUntil` 里补充外部数据、广播并通知首屏 stale。
- `src/apple-music-recent.ts`：收下采集 Worker 拉回的最近在听，差分、写入和广播。
- `src/musickit-token.ts`：给「一起听」签 MusicKit developer token（ES256 JWT），按 origin 声明缓存、过半衰期重签。
- `src/origins.ts`：`ALLOWED_ORIGINS` 的解析、通配匹配和 CORS 头，两条 WebSocket、公开 API 和令牌签发共用。
- 根目录 `shared/`：读写共用的 SQLite 键、类型和状态计算；根目录 `src/lib/` 提供读取与通用工具。
- 根目录 `src/lib/status-views.ts`：公开状态视图登记表（`path` / `layer` / `tag` / `event`）。路径常量、数据层、Vercel 缓存标签、事件→路径全部由它派生；可滞后层（`layer: "lag"`）不能带推送事件，模块加载时断言。
- 根目录 `src/lib/status-loaders.ts`：按同一组 key 登记 `endpoint(params)`，单端点由 `src/public-api.ts` 通用分发到对应 loader。`trophies` 无参回摘要（与首屏、推送同形状），带 `?titleids=` 回那几款的完整目录。
- `src/public-api.ts`、`src/public-execution.ts`：普通 Worker 中的公开 API 入口。已知路由先匹配，再过 StateHub 初始化/提交可见性屏障；状态端点按 loader 表通用分发。屏障等待已经进入 `commitIngest()` 队列的提交，不等待仍在普通 Worker 做输入准备或 R2 HEAD 的请求；提交返回 202 后，经过 StateHub 的权威读取可见其持久化结果。可滞后层的端点数据只读 `LAG` KV，但入口相同，同样先过屏障；只有下面的按参数查询不过。
- `src/lookup-routes.ts`、`src/edge-cache.ts`：`/api/lyrics`、`/api/motion-artwork` 按参数查询，结果只由参数决定，不过公开读屏障。先查当前机房的 Cache API（`caches.default`），命中不进 StateHub；未命中回源，只有 200 写回，按响应的 `max-age` 过期。条目只在当前机房、跨部署保留、不合并并发未命中，键里带 SQLite 那层的版本段，响应外形变了升 `EDGE_CACHE_VERSION`。存的响应不含 CORS 头，`X-Edge-Cache: hit | miss | bypass` 标识命中。
- `src/storage-driver.ts`：通过 alias 接入 StateHub 的 SQLite 存储驱动；同一公开请求、同一 microtask 的相邻只读批次合并成一次最多 128 条的 DO RPC，写批次保持原事务顺序。
- `src/lag-store.ts`：`@/lib/lag-store` 在 Worker 里的实现，读 `LAG` KV（可滞后层，格式见 `shared/lag.ts`）。厂商状态、GitHub、Vercel、Cloudflare、Sentry 这几条端点只读采集 Worker 写的那几条键，Vercel 与 Cloudflare 两条按名字把几条键拼成一份。
- `src/dev-override-reader.ts`：只在本地绑定的具名入口 `DevOverrideReader`，推送房间转发生产事件前经它查假数据注入。

## 端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/ws?visible=1\|0` | 浏览器接收事件推送的 WebSocket，页面开着就一直挂着；切可见性时发 `visible` / `hidden`；使用 `ALLOWED_ORIGINS` 校验来源 |
| GET | `/count` | `{ ok, connections, online }`：开着的页面数（判中档）与此刻可见的页面数（判快档） |
| GET | `/api/musickit/token` | `{ token, issuedAt, expiresAt }`：给「一起听」的 MusicKit developer token，同一份来源白名单；见下文 |
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
- **5 分钟桶**：`pulse:token-buckets:<来源>`，TTL 2 天，只给 Pulse 的 Tokens 道、Jev 与归档，不推送。Mac / agents 按报告
  范围替换（`[from, to)` 内以新报告为准，缺席的桶是 0，范围外不动，报告范围并进覆盖）；跨着报告起点的那一桶只数了
  一截，按 (agent, 模型) 取大的那行，不盖掉旧报告里数全了的桶。合并规则在 `shared/coding-buckets.ts`。
- **Cursor 账号观测**：agents 来源的 cursor 行另记一笔 `pulse:cursor-observations`（Coding 三色带与 Jev 的独立来源）：
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

出口一律带 `windowTitle`：没有标题是 `null`，不是缺字段，消费方只判空。站点界面此刻不展示它。

`/api/ingest/playstation` 的信封是 `{ version: 1, presence?, playedGames?, trophies?, power? }`，
每一项各自可省、缺席表示这次不谈这一项。前三项由采集 Worker（`workers/collector` 的 `playstation` 任务）
每轮在它那边 prepare 好（`shared/ingest/playstation.ts`）、经 `StateCore.commitIngest` 交付，不走 HTTP；
`power` 是**另一个生产者**——Home Assistant 上那台 PS5 的电源开关实体，翻面时发一封
`{ version: 1, power: { on, observedAt?, entityId? } }`。两边互不覆盖：电源单独存一份，
读的出口（`/api/status/playing/now`）才并进 presence，否则 PSN 上报器每轮整份覆盖
presence 时会把它冲掉。`on` 必须是布尔值（HA 实体的 `"on"` / `"off"` 字符串要在自动化
模板里先翻译），`observedAt` 缺席按落地时刻算。

电源翻面时状态核心立刻广播一条 `playing-now`，页面当场就能看到；PSN 那侧的
`presence`（在玩什么）要等采集 Worker 下一轮，约 1～2 分钟。它自己也经 `StateCore.playstationPower()`
读这一份决定节奏，见 `workers/collector/README.md`。

奖杯内容变了（解锁、新 DLC、等级；不看 `observedAt` 和游玩时长）时广播一条 `trophies`，
带的是摘要 —— 等级、合计、最近解锁、各款进度，和 `GET /api/status/trophies` 无参回的
同一份，8 KB 级。整份目录不推：展开着的瓷砖收到后自己重取 `?titleids=` 那一两款的切片。
解锁到页面的延迟就是上报器发现它的延迟，也就是完整 tick 的节奏。

两个数出自同一个房间、同一条连接（`src/live-census.ts`）。`connections` 静默 5 分钟不计数、30 分钟才关，
因为后台标签页的定时器会被浏览器节流；`online` 只数握手带 `visible=1` 或之后报了 `visible` 的连接，
静默三个心跳周期（90 秒）就不算，因为可见页面不会被节流，一条僵尸多活 5 分钟就把调频上报器多钉在快档 5 分钟。
可见人数变了才广播 `{ type: "online", payload: { online } }`，新连接接上时单独收到一条当前值；有人可见时
挂 30 秒一次的清扫闹钟，没人可见就停。心跳 ping 仍由运行时自动回、不唤醒房间，只有接入、断开、切可见性和
闹钟会唤醒。心跳 30 秒定义在站点 `src/hooks/use-live-events.ts`，`live-census.ts` 里那份是手抄的副本，改一边必须改另一边。

上报走 `https://ingest.homepage.lyjw.llc/api/ingest/<来源>`，由上报入口 Worker 接收：Cloudflare Access 与 service token、
`[vars.ACCESS_CLIENTS]` 权限表、回执状态码都在 [上报入口 README](../ingress/README.md)。它收下的实时那一半经
`StateCore.commitIngest` 进这里：StateHub 按到达顺序串行提交，回 `{ ready, ok, data | error }`，未初始化时什么都不写；
提交确认后，推送与首屏失效由这边的 `waitUntil` 执行。api Worker 上没有 `/api/ingest/*`，旧的 `/publish` 也不存在。

Worker 在 SQLite 写入完成后，仅对首屏布局变化在 `waitUntil` 后台任务中通知 Vercel：POST `${SITE_URL}/api/revalidate`，Bearer 用只有 Worker 和 Vercel 两边有的 `REVALIDATE_SECRET`，只传 `{ tags }`。按白名单将 `page:<tag>` 标 stale，先返回已有 HTML，后台重建。首页整页只有一个缓存条目，任何标签失效都是整页重建，所以各上报在自己手里的新旧两份上判断布局有没有变：充电头 / 充电宝那一格亮灭、在听的 hero 出现或消失、「正在看」开播停播、续看和游玩列表空与非空、服务器首报 / 流量行 / 断流后回来、奖杯首次到达、训练那一块换占位（没收到过 / 一条都读不出 / 有训练）。判据与页面共用 `src/lib/home-layout.ts`。coding 用量卡片的骨架在状态核心重算视图时比新旧两份，行、总量与常用模型的有无变了才发 `coding`。读数、标题、进度、灯色等内容变化不通知，由首屏快照 `revalidate: 600` 定时重建；浏览器挂载后直接问 Worker。通知 5 秒超时，失败只记日志，不能让已落库的上报重发。纯心跳和没有标签的广播不触发缓存通知。

ESA 首页不走数据上报通知。`lyjw131.com` 以 `lyjw.me` 为源站与回源 Host，控制台缓存规则「首页遵循源站缓存」（主机名等于本站、URI 路径等于 `/`，排在 PWA 绕过规则之后）让边缘按源站 `Cache-Control: public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400`（根目录 `next.config.ts`）自行缓存：5 分钟内命中，之后先回旧 HTML、后台回源取新。带内容哈希的静态 JS 按源站一年 immutable 缓存，不随上报清理。新版本部署上线时，由 GitHub Actions（`.github/workflows/purge-esa.yml`）在 Vercel 生产部署完成后自动调用 `PurgeCaches` 刷新一条首页 cachekey，随后主动发起请求预热边缘节点缓存；日常上报不触发刷新。同一工作流的第二步等 `lyjw.me` 与 `lyjw131.com` 的 `/api/version` 都答出这次部署的 sha，再用 `lyjwpage-github-actions` 那把 service token（仓库 secret `ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET`）调上报入口的 `POST https://ingest.homepage.lyjw.llc/api/internal/site-deployed`；上报入口验过之后调这里的 `StateCore.broadcastVersion()`，向所有连着的页面广播不带数据的 `version` 事件，页面重问 `/api/version` 并弹出更新提示（同时请采集 Worker 重拉部署列表，见上报入口 README）；站点自己的版本轮询因此只作半小时一次的兜底。

这条规则是必需的：`/` 没有文件后缀，不匹配任何默认缓存类型，没有规则覆盖时 ESA 直接判 DYNAMIC、每次回源——之前命中率归零的真正原因。针对高频数据上报的 `PurgeCaches` 链路（含 RAM 密钥、Worker 冷却表）已删除；日常依赖 SWR 自行收敛，仅在站点全量新构建发布时由 CI 触发单次刷新。

Vercel 仍采用后台重建，通知成功不代表新 HTML 已生成。ESA 后台回源可能取得 Vercel 仍在重建中的旧 HTML，下一轮刷新时收敛；这条链路不承诺两层缓存同步完成更新。首屏新鲜度不依赖这两层：浏览器挂载后直接向 Worker 取最新状态。

公开 API 为 `/api/status/*`、`/api/lyrics`、`/api/motion-artwork`，没有聚合端点。Vercel 生成或重建首页时按卡读各条端点（`src/lib/first-screen.ts`），浏览器挂载后实时卡各自回源一次、之后各端点按各自周期轮询。服务端凭据不进入任何公开响应，没有通用 HTTP 数据库端点。跨域活动脉搏（pulse）的出口是 `GET /api/status/pulse`，见下面一节。

## 跨域活动脉搏（Pulse）

`GET /api/status/pulse` 是最近 24 小时「在做什么」的事实时间线，七条道：`coding` / `tokens` / `listening` /
`watching` / `gaming` / `charging` / `activity`，归实时层（状态核心 DO 直读，不进 KV），首页那张
Pulse 卡片首屏按卡读它（`src/lib/first-screen.ts`）、挂载后五分钟轮询一次。**只给原始事实**（状态、标题、瓦数、步数），档位、颜色、摘要文案都在卡片里现算，
以后换展示方式不用迁移数据。信封形状：

```jsonc
{ "ok": true, "data": {
  "generatedAt": 1770000000000,
  "window": { "from": 1769913600000, "to": 1770000000000 },
  "lanes": {
    // value：0 两者都没有，1 只有前台 coding 应用，2 只有 agent 在跑，3 两者同时
    "coding": { "kind": "coding",
      "segments": { "startSec": [0, 3600], "endSec": [3600, 7200], "value": [1, 3] },
      // Jev 的十五分钟评估：强度 0–4、置信度、模式；只在悬停里出现
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
      // 只有 listening 有：「最近在听」列表变动，只知道落在 (start, end] 之间某处
      "uncertain": { "startSec": [12000], "endSec": [18600], "title": ["THE BOOK 3"], "subtitle": ["YOASOBI"] },
      "summary": { "activeSeconds": 240, "titles": 1 } },
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
Jev 的强度、模式。token 只以各来源、各 agent、各模型相加后的五分钟桶出现（Tokens 道），不带模型名和来源：
Mac / agents 的桶只认起点在报告范围里的（跨着范围起点的那一桶只数了一截），被 24 小时窗口截断的首桶不画，
末桶截到这一桶里有数的来源里最晚的覆盖终点（云端 OTLP 用最后一封的收到时刻），不足 60 秒不画，只出有用量的桶。

### 存储：事实时间线

纯函数在 `shared/pulse-timeline.ts`，写入在 `workers/api/src/stores/pulse.ts`，键在 `src/lib/pulse-keys.ts`。
全部在 StateHub SQLite，TTL 7 天。

- **状态区间**（listening / watching / gaming）：每条道一个开着的区间 `pulse:v2:<道>:open`
  （`{from, seenAt, holdUntil, endsBy, state, …原始字段}`）加一串已关闭区间 `pulse:v2:<道>`（`{from, to, state, …}`，
  上限 3000 / 1000 / 1000 段）。同一状态、同一标题只续 `seenAt`、`holdUntil`、`endsBy`，每条道每分钟最多写一次
  （有效期或结束时刻挪动超过一分钟也写）；状态或标题变了在那一刻关上旧段、开新段。
  `holdUntil` 是每次观测带宽限的有效期，只决定这段还开不开着、在线时画到此刻：Mac 的播放、Emby 播放与暂停
  10 分钟；HomePod 只在状态变化时由 HA 推一次，按那份快照的剩余时长加 5 分钟宽限（单曲循环 30 分钟，与首页
  判 HomePod 是否还在放同一个口径）；PSN 没人看站点时 29.5 分钟才查一次，35 分钟；Emby 明确停播之后一直是
  空闲、`holdUntil` 为 null，开着的那一段不设过期，七天没开播仍是观测到的空闲。
  过了 `holdUntil` 来源就算断了，旧段只认到确实知道的那一刻 `max(seenAt, endsBy)`，宽限不算进事实，中间是未知：
  定期确认的来源（Mac、Emby、PSN）`endsBy` 为 null，认到最后一次确认；HomePod 的 `endsBy` 是这首按剩余时长
  该放完的那一刻（单曲循环、没有时长时为 null），一首长歌只有开头那一次推送也能整段留下到曲终。
  过期还没被下一次观测关上的段在图上也只画到那一刻，关上之后画法不变。原始字段分开存：listening 是
  `source`（mac / homepod）、`title`、`artist`、`album`、`trackId`；watching 是 `itemId`、`title`、`subtitle`；
  gaming 是 `titleId`、`title`。标题只防病态长度（200 字），不再压成 48 字 hint。
  - listening 每封 Mac 信封（纯心跳也算）和每次 HomePod 事件都记一次，不查 Apple 目录：
    Mac 在放 → HomePod 在放 → Mac 暂停 → HomePod 暂停 → 空闲。不套首页 Hero 的 10 秒暂停宽限，
    音乐 App 停在暂停就是暂停。Mac 离线（或关了 `appleMusic` 模块）而 HomePod 也没有有效快照时是未知。
  - watching 只在 Emby 推来播放状态时记；详情按 itemId 对上才用，位置更新没带详情时沿用存着的那份。
  - gaming 每次 PSN presence 都记（它本身就是心跳）。
- **「最近在听」不确定区间** `pulse:v2:listening-traces`：Apple 的列表按最后播放倒序、不给时刻，
  列表变动（只比条目 id 与顺序）只能说明在上一轮成功刷新 `since` 与这一轮 `t` 之间某处放过，
  记 `{since, t, title, artist, itemId}`（条目是专辑 / 歌单），上限 2000。出口如实给出 `(since, t]`；
  Mac / HomePod 那一路正放着同一张专辑的痕迹已被实测解释，不再重复给。
- **Coding 三色带**不另存：读时从 `pulse:coding-observations` 与 `pulse:cursor-observations` 现算，
  切片规则同 Jev 特征（每条 Mac 观测撑到下一条或 3 分钟，`available: false` 不算观测）。
  human 是前台为 coding 应用（`desktop.coding`），agent 是有 agent `active`，或 Cursor 账号最近 5 分钟有活动。
  Cursor 那一路的覆盖也算「看得见」：Mac 离线而 Cursor 覆盖着且没有活动时画 0（观测到没有 agent 活动），
  这时前台其实是未知，和 Jev 特征的口径一致。不读档位时代的 `pulse:coding`（它让 agent 压过前台，画不出「两者同时」）。
- **充电瓦数** `pulse:v2:charging` `{t, watts, device?}`，上限 6000。闸门：跨 1 W 待机门槛立刻写；通电时至少隔
  30 秒、且变化 ≥ 2 W 且 ≥ 10% 才写；换设备立刻写；其余最多 5 分钟再确认一次。一笔撑到下一笔或 10 分钟；
  最后一笔过期后 `currentPowerW` 为 null。
- **活动** `pulse:v2:activity` 原样留 HealthKit 五分钟桶 `{from, to, steps, moveKcal, exerciseMinutes}`（缺项为 null），
  iPhone 每次查询是一段权威范围：范围内旧桶按新结果修订或删除，`pulse:v2:activity:range` 记范围，
  `pulse:v2:activity:revision` 在内容真变了时 +1（归档用它挡较旧的替换）。写入只从第一处不同的桶往后重写，
  通常每封只动最后一两行。训练区间 `pulse:v2:workouts` `{items:[{startedAt, endedAt, activityType}]}` 由 iPhone 训练
  写入口自己留一份（训练卡片那份列表在可滞后层 `workouts:v1`），内容没变不写。

档位时代的 `pulse:<domain>`、`pulse:listening-plays`、`pulse:listening-checks` 不再写，随 TTL 过期，不迁移。

本地预览用夹具：`pnpm dev:override /api/status/pulse pulse-busy-day.json`（另有 `pulse-empty`、`pulse-zero-lanes`、
`pulse-activity-boundary`，以及 `pulse-tokens-idle`：Tokens 道白天有用量、此刻为 0）。卡片右下角开发开关「Traces」切换不确定区间的斜线 / 淡色画法，默认斜线。

### Coding 的 Jev 评估

Jev 只给 Coding 打分：原始观测说得出「前台是不是 coding 应用、agent 在不在跑」，说不出「写得多投入」，
强度和模式仍问 Jev，只在悬停里出现。别的道画的就是事实本身，不再有模型分、趋势和置信度。
`PulseScorer` 和 `pulse:assessments` 只剩 `coding`；StateHub 的 metadata 保存评分 claim、generation、lease 和
最近尝试时刻；普通 Worker 领取固定输入快照（评估、Coding 观测、三个来源的 token 桶、Cursor 观测）、执行模型请求，
再用 token + generation 提交，过期任务不能覆盖新结果。公开的评估只有区间、强度、置信度与模式；
概率分布、输入哈希、模型名和评分时刻只留在库里。

每分钟 cron 检查，两轮尝试至少隔五分钟；窗口结束后留两分钟等待采集与上报。有活动，或覆盖不全、缺报、
未知的窗口，每个十五分钟一份官方 `jev-1.13.0` 请求，强度、连续性、模式一起评估。窗口被完整观测且信号
全是 0 时不请求 Jev，写成确定的最低档（强度 0、连续性 0、置信度 1、mode idle，模型名 `rules`）。每轮最多
36 份请求、并发最多 3，优先新窗口再补最近 24 小时，稳定时每小时最多 4 次。没有观测不调用，也不写评分。
没有 `TYPESAFE_API_KEY`、或本地配了 `DEV_OVERRIDES` / `UPSTREAM_API_URL` 时停用。

按 Jev 文档（不会数数、不会算时长、不比时间戳），发给它的 state 是代码算好的命名秒数和次数
（`shared/pulse-coding.ts` 的 `codingWindowFeatures`）：`codingAppSeconds`、`agentActiveSeconds`、
`concurrentAgentSeconds`、`codingAppAndAgentSeconds`、切换次数、最长连续时长、观测覆盖和前几个应用 / agent，
没有原始区间或时间戳；判据写在 `instructions` / `criteria` 里。

`PULSE_ASSESSMENT_VERSION`（现为 6）进输入哈希，改问题时升版本让全部窗口重评，不靠哈希碰巧变。
改判据先跑 `node --experimental-strip-types --import ./src/lib/testing/register-alias.mjs scripts/jev-probe.mts`
（key 读根目录 `.env.local` 的 `TYPESAFE_API_KEY`）：几个代表性的 Coding 窗口打真实 Jev，每条都写着期望答案，
偏了先改措辞再上线——改判据上线会触发最近 24 小时重评。相同输入哈希不重复调用；晚到 token 改变窗口事实时
只重评受影响窗口。失败保留旧成功记录，下一轮重试，存储读失败不会清空历史。评估列表追加写，同一窗口以
最后一行为准，被覆盖的行多过有效行一半或总数超过上限（2016）的 1.5 倍才整表压缩。

token 证据来自三个来源的 5 分钟桶（上一节）。原始桶保持五分钟，不随 Jev 评分改动；评分时聚合窗口内三个桶，
按 (来源, agent, 模型) 相加，每行带 `source`。`observedBucketCount` 只数被 Mac 本机扫描的报告范围完整盖住的桶：
范围内缺席的桶是零事件，范围外或 Mac 的来源 partial / unavailable 保留 unknown；「确定为零」只认 Mac 的覆盖。
Cursor 账号与云端 OTLP 的桶只作正证据（没行不代表 0），不按 token 计费的请求记 0 token、1 次事件，照样算活动。
每行有 `inputTokens/outputTokens/cacheReadTokens/cacheCreationTokens/reasoningTokens/eventCount`；input 不含 cache read，
reasoning 属于 output 子集，eventCount 是去重用量事件数（数不出来的来源为 null），不宣称上游 HTTP 请求数。

不上传提示词、回复正文、项目路径或 session ID。token 是工作活动的证据，不是生产力。
Mac 同状态每分钟最多保存一次内部观测，变化立即记录；缺报三分钟后中断。
Cursor 使用独立的 `pulse:cursor-observations`：agents 来源的 cursor 活动往前走了、或成功的 cursor 用量采集都会记录，账本内容没变化也更新观测。重复、乱序的采集时刻不延长有效期，error / warning 不当成零活动。闲时上报周期最长一小时，因此检查覆盖最多保持 65 分钟；最近事件只按 5 分钟活动窗口计入，之后仅表示 Cursor 来源可用。Mac 离线不会抹掉这份覆盖，Cursor 过期也不会抹掉 Mac 的覆盖；两者并集去重。仅 Cursor 可用且没有活动或正 token 证据时直接写 0，置信度为 0.5，内部模型标记为 `rules:limited-source`，不调用 Jev；这不等于确定全局没有 Coding。

### 长期归档（D1）

写入方是状态核心：cron 每分钟由 StateHub 按各路水位（metadata `pulse-archive:v2:<路>`）给出一份有界快照，
普通 Worker 拼成按自然键幂等的 upsert 写 D1，全部成功后才确认水位；一路读坏、写坏不挡别的路。
代码在 `src/pulse-archive.ts`，表在迁移 `0007_history_pulse.sql` 与 `0008_coding_usage.sql`：

| 表 | 内容 | 自然键 |
| --- | --- | --- |
| `listening_plays` | 每段实测在放（`certain = 1`，来源 mac / homepod，曲名 / 艺人 / 专辑 / 曲目 id）与不确定区间（`certain = 0`，`source = 'recent'`，专辑 / 歌单名在 `album`、目录 id 在 `item_id`） | `(source, started_at)` |
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

旧表 `coding_token_buckets`、`agent_usage_days` 冻结：`0008` 把 Mac 的桶和活跃秒数复制进新表，日事实不回填（新契约第一封就带完整历史）。
旧表 `pulse_samples` 原样冻结，不再写。首次部署带本版本的 Worker 之前先应用迁移
（`pnpm --dir workers/api exec wrangler d1 migrations apply lyjwpage-history --remote`）。

## 最近在听

拉取在采集 Worker（`workers/collector` 的 `apple-recent`，每两分钟一轮，不看有没有人在看），
拉回来的列表经 `StateCore.commitRecentlyPlayed` 交给这里差分、落库、推 `listening`，列表变动记成 Pulse
听歌道上的不确定区间（`pulse:v2:listening-traces`）。api 自己不再拉，WebSocket 连上也不触发。
Mac 上报的 Apple Music 凭据在凭据 KV（`shared/credentials.ts`），不向外提供凭据端点；状态读取不触发拉取或广播。

## MusicKit 令牌

访客用自己的 Apple Music 订阅跟听之前，先得有一份 developer token 才能把 MusicKit JS 配起来。
这份令牌发给**任何一个访客**，和 SQLite 里 Mac 上报的那份私人凭据（带 music user token）
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
有效期 `MUSICKIT_TOKEN_TTL_SECONDS` 不填按 7 天，上限半年；不取上限是因为令牌一旦被复制走，
域名限制之外就只剩有效期这一道闸。

## 配置与部署

生产发布走 Cloudflare Workers Builds 原生 Git 集成，推送 `main` 且本 Worker 或共享代码变化时触发。构建命令、监视路径与验收流程见 [原生部署配置](../../docs/workers-builds.md)。

`wrangler.toml` 中配置公开变量 `SITE_URL`、`STORAGE_PREFIX`、
`APPLE_MUSIC_STOREFRONT`、`ALLOWED_ORIGINS`、`APPLE_MUSIC_TEAM_ID`、
`APPLE_MUSIC_KEY_ID`（响应里的图片地址是 `/img/<对象键>` 同源路径，Worker 不配交付域，
回源 R2 由站点的 rewrite 和 ESA 负责，见根 README「图片」；上报器直传图片那个桶的 HEAD 在上报入口），
以及 `LIVE_PUSH` 与 `STATE` 两个 Durable Object 绑定（迁移只追加新 tag，不改旧的）。`LAG`、`CREDENTIALS` 两个 KV 绑定见 `shared/lag.ts`、`shared/credentials.ts`，这里只读；`HISTORY` 是长期归档用的 D1 库 `lyjwpage-history`（这里写 Pulse 事实表，上报的四张表由上报入口写，见上文「长期归档（D1）」），
只增不删、无公开读路径，建表只在 `migrations/` 里，部署带这个绑定的版本**之前**先手动应用一次
（`pnpm --dir workers/api exec wrangler d1 migrations apply lyjwpage-history --remote`，Workers Builds 不跑迁移），
边界与回滚见 [Worker 数据后端与首屏缓存](../../docs/state-storage.md)。
状态和凭据只存于 Worker 的 StateHub，Vercel 不连接数据库。秘密通过以下命令配置：

```sh
pnpm --dir workers/api exec wrangler secret put GITHUB_TOKEN
pnpm --dir workers/api exec wrangler secret put REVALIDATE_SECRET
pnpm --dir workers/api exec wrangler secret put APPLE_MUSIC_PRIVATE_KEY < AuthKey_XXXXXXXXXX.p8
pnpm --dir workers/api exec wrangler secret put TYPESAFE_API_KEY
pnpm --dir workers/api exec wrangler secret put SENTRY_API_TOKEN
```

Worker 不再调用阿里云 OpenAPI。旧的 `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`
Secrets 与专用 RAM 用户已无用，在 Cloudflare 控制台和阿里云 RAM 控制台删掉即可。

站点配置 `NEXT_PUBLIC_BACKEND_URL=https://api.homepage.lyjw.llc` 与相同的
`REVALIDATE_SECRET`；浏览器由这一个源拼 `/ws` 和 `/api/musickit/token`。所有上报器的目标为
上报入口 Worker（`workers/ingress`）在 ingest 域名上的 `/api/ingest/<来源>`，不经过站点；PlayStation 例外，由采集 Worker（`workers/collector`）
自己 prepare 好信封，经 Service Binding 调具名 entrypoint `StateCore`（`src/state-core.ts`，契约 `shared/state-core.ts`）的 `commitIngest(command)`，
并通过 `audience()` / `playstationPower()` 读取人头数与主机电源，不带凭据；按人数调频的（如 agents-reporter）读此源 `/count` 的 `connections` 与 `online`，server-reporter 固定每分钟推一次。实例清单见 [端点核验记录](../../docs/reporter-endpoints.md)。

提交并推送 main，由 Cloudflare Workers Builds 原生 Git 集成自动部署。
`shared/`（`shared/ingest/` 除外，校验改了只发布上报入口）、共用 `src/lib/`、根依赖及路径配置变化也触发 api 部署，见 [原生部署配置](../../docs/workers-builds.md)。

## 本地开发

```sh
cp .dev.vars.example .dev.vars      # 填 GITHUB_TOKEN；STATE_IMPORT_SECRET 本地随便填
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
api 自己的分钟 cron 本地触发不到（Service Binding 调不了别的 Worker 的 `scheduled`），它本地要做的
D1 归档、Jev 打分本来也被隔离开关关着。

本地用 `wrangler.test.toml`：生产配置里的 `deleted_classes` 迁移在空环境下起不来，测试配置有从头开始的迁移链，且没有生产域名和 cron。
状态持久化在 `.wrangler/dev-state`（`DEV_WORKER_STATE` 可以另指一个目录），重装或想清库就删它，再跑一次 init。
本地 api 从 `ingest-do-test` 改名为 `api` 之后，Durable Object 的本地目录跟着换了名字，旧库不再被读到：再跑一次 init。

本地是空库。`.dev.vars` 里的 `UPSTREAM_API_URL` 让 `publicResponse` 生产为主、本地补缺：生产 `ok:true` 的快照字段和端点用生产的，
生产没有的（新加的端点、新字段）或生产也 `ok:false` 的才用本地的（只读、不上报）。生产的 wrangler.toml 不配它。
分支预览是同一套兜底的线上版：`wrangler preview` 在生产脚本 `api` 上按分支开一份隔离的 Preview，Vercel 预览改连它。见 [Workers 构建](../../docs/workers-builds.md)。
要测上报链路，把这个变量注释掉让本地只看自己，然后往 `http://localhost:8788/api/ingest/<来源>` 推（dev-router 转给上报入口）。本地没有 Access：
先 `node scripts/dev-access.mjs init` 生成测试钥匙、把它打印的 `ACCESS_DEV_JWKS` 填进 `workers/ingress/.dev.vars`（上报入口那份，不是本目录的），
推的时候带 `node scripts/dev-access.mjs header` 打出的 `Cf-Access-Jwt-Assertion` 头（10 分钟有效），见 [上报入口 README](../ingress/README.md#本地开发)。

配了 `UPSTREAM_API_URL` 后，本地的推送房间还会在有页面连着时自己去连生产的 `/ws`，把事件转发给本地页面（最后一个页面断开就跟着断，不多占生产那边的连接数），所以本地也能收到实时推送。事件对应的端点有生效的注入时，payload 换成注入的那份，假数据不会被生产一推就盖掉。

`DEV_OVERRIDES=true` 时另开 `PUT` / `DELETE /api/dev/override/<端点路径>` 和 `GET /api/dev/overrides`，往本地 SQLite 里注入某条端点的信封，
优先于上游和本地；夹具放 `dev-fixtures/`，用根目录的 `pnpm dev:override` 推。`index.ts` 只在这个变量开着时放行非 GET。
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

## Worker 更名

生产服务为 `api`，域名 `api.homepage.lyjw.llc`。`v1-transfer-from-ingest` 将旧 Worker 的三个 SQLite Durable Object 命名空间整体转移，保持 ID 与数据不变；后续部署保留这条迁移记录。不要对这些类另加创建或删除迁移。
## 外部数据卡片（可滞后层）

厂商状态、GitHub 贡献日历与仓库统计、Vercel、Cloudflare Workers、Sentry 这几条端点的数据都由采集 Worker
（`workers/collector`）按各自节奏拉取、写进可滞后层 KV（`shared/lag.ts` 的键表），这里的公开端点**只读**：
不持有任何外部令牌、不在读路径上现拉、不推送。每条都带写入方最后一次成功取到的时刻，信封里给 `updatedAt`；
过没过时由浏览器按 `src/lib/freshness.ts` 里各块的阈值判断，过了那一格回到「—」或 Unavailable，服务端不下结论。
还没写过的键回 `ok: false`（等采集）。取数口径、失败时的沿用规则、节奏与监控见
[采集 Worker 的 README](../collector/README.md)。

| 端点 | 读哪几条键 | 卡片阈值 |
| --- | --- | --- |
| `/api/status/agent-status` | `agent-status:v1` | 10 分钟 |
| `/api/status/github-chart`（可带 `?since=`） | `github-chart:v1`，切片在这一侧做 | 6 小时 |
| `/api/status/github-repo` | `github-repo:v1` | 3 小时 |
| `/api/status/vercel-deployments` | `vercel-deployments:v1` + `vercel-metrics:v1` + `pagespeed:v1` | 部署 10 分钟、指标 1 小时、PageSpeed 3 小时 |
| `/api/status/cloudflare-workers` | `cloudflare-metrics:v1` + `cloudflare-deployments:v1`，按 Worker 名拼 | 统计 1 小时、部署 15 分钟 |
| `/api/status/sentry` | `sentry:v1` | 各块 30 分钟 |

几份拼起来的端点，各部分带自己的采集时刻（Vercel 部署的 `fetchedAt`、指标每组的 `fetchedAt`、PageSpeed 最近一轮的
`fetchedAt`；Cloudflare 统计的 `fetchedAt` 与部署的 `deploymentsFetchedAt`；Sentry 各块的 `blockAt`），卡片分别判过期。
信封的 `updatedAt` 取最常刷新的那一份，只用来决定挂载时要不要补取一次。

### Workers 统计

只查询本仓库的 `api`、`ingress`、`collector`（名单在 `src/lib/cloudflare-workers-types.ts`，
GraphQL 的 `scriptName_in` 跟着它），不公开账号内其他 Worker；还没部署的脚本那一格为空。
统计是滚动 12 小时（窗口按 15 分钟对齐）的调用量、执行错误、子请求和整段窗口 CPU P50（微秒转成 `cpuTimeP50Ms`），
采样统计不是账单，也不将执行错误等同于 HTTP 错误或可用率。部署只投影部署时间、正在分流的版本与比例，
以及流量最大版本的提交 SHA、分支和标题（改密钥这类没有构建记录的版本借前一个有构建的版本的提交）。
两半按 Worker 名拼，名单再变也不会错位。不输出部署作者、邮箱或账号凭据。

### Vercel 部署与指标

`targets.production` 决定当前生产版本，新构建失败或回滚不会把最新创建的部署误当成线上版本；另带最近五次部署。
`metrics` 两组各带采集时刻与窗口：`functions` 是最近十二小时生产环境的函数调用、错误、超时、CPU P75 与平均峰值内存；
`analytics` 是前七个完整 UTC 日的页面浏览与访客（不累加每日独立访客数）。
仅公开这些聚合指标及部署 ID、状态、时间、生产/预览标记、提交 SHA、分支和标题。

### 性能评分（PageSpeed Insights）

同一份载荷的 `pagespeed` 字段，数据来自 Google `runPagespeed`，与 Vercel 无关，所以不在 `metrics` 里。
测的是 `lyjw.me`（`src/lib/site.ts` 的 `site.url`），载荷里带着这个地址，卡片表头显示它。
这是**实验室数据**：一台模拟设备上跑出来的，不是访客的真实体验，所以没有 INP，表上那一列是同一轮测出的 TBT。
**每一格是 6 小时滚动窗口内各轮实测的中位数**（按小时一轮约六个样本，上限 12 条），一轮异常被旁边几轮压住；
载荷里的 `samples` 与 `start` 是参与的轮数和最早一轮的时间。

### Sentry

四块数据：`uptime`（每分钟 HEAD `https://lyjw.me/api/version` 的在线探测）、`heartbeat`（本 Worker 分钟 cron 的
心跳监控 `api-minute-cron`，只算 production，心跳只在整 5 分钟那一轮报到，见 `src/cron-heartbeat.ts`）、
`errors`（production 报错：`site` 是站点项目，`worker` 是 api 与采集 Worker 两个项目合计）、
`vitals`（站点 production 的 7 天 p75 与样本数，站点按 Lighthouse 曲线算出 Users 那行的分）。
只放计数、比率和时刻，不放 issue 标题、报错内容和调用栈。

## 常驻上报器账本

misaka-jp 上的 server-reporter 与 agents-reporter 每封报文顶上带一个 `reporter` 块：镜像提交（Actions 以 `GIT_SHA`
烧进 `REPORTER_COMMIT`）、过去 12 小时推成功几封（含这一封）、这些封往返的中位数 `rttMs`、窗口起止。次数和延迟由
上报器自己数（两边同一份 `push-ledger.ts`），上报入口只校验、把最新一份加上收到的时刻写进可滞后层（每个上报器一条，
`reporter:server-reporter:v1` / `reporter:agents-reporter:v1`），由 `GET /api/status/reporters` 给卡片服务区最后两格。块写坏或旧版没带都当没有，不因此拒掉整封上报。

## 最近训练

`POST /api/ingest/iphone` 的 v1 信封接受 `modules.workouts: { items: [...] }`，每次完整替换最近最多 10 条训练（空列表清空）。记录字段为 `id`（HealthKit UUID）、`activityType`（英文类型）、`startedAt` / `endedAt`（epoch 毫秒）、`secondsFromGMT`（训练当地 UTC 偏移秒）、`durationSeconds`（扣除暂停的活动秒数），以及可选的 `distanceMeters` / `activeEnergyKcal`、`averageHeartRateBpm` / `maximumHeartRateBpm`、`elevationAscendedMeters`、`indoor`（boolean）。缺失指标对外为 null，不能解释为零。

`GET /api/status/workouts` 返回 `{ items, pushedAt }` 的标准状态信封，信封带 `updatedAt`。训练列表是可滞后层的一条（KV `workouts:v1`，`{ updatedAt, data: { items } }`），由上报入口在这封 iPhone 上报的状态核心那一半成功之后整份写入；`pushedAt` 就是 `updatedAt`，读时补上。状态核心只留 Pulse 活动道要的训练区间（`pulse:v2:workouts`）。训练是历史事实，列表不设过期阈值，只有取数失败时卡片注明同步延迟。首页 `workouts` 缓存标签只在训练那一块换占位（没收到过 / 一条都读不出 / 有训练）时失效，条目增减交给定时重建；浏览器每 5 分钟轮询，不新增推送事件。共享代码路径已包含在 Worker 原生构建监视范围内。

活动圆环（`modules.activity` 里的当天圆环）同理：读数在 KV `activity:v1`（`{ updatedAt, data: ActivityStatus }`），只在这封带了当天圆环时写，只带五分钟统计桶的上报不碰它；五分钟桶是 Pulse 的输入，留在状态核心。`GET /api/status/activity` 读 KV，`pushedAt` 取 `updatedAt`，「手表那边还是不是这一天」（`currentAtSource`）在读时按源站的钟现算。卡片超过 `ACTIVITY_STALE_MS`（12 小时，一夜加余量）没有新读数就写 Unavailable，版面不动。

本地预览：`pnpm dev:override /api/status/workouts workouts.json`，夹具仅供开发环境，启用时页面显示 Fake data。真实记录需要安装 iOS 27 上报器并允许训练读取。

`workouts.json` 是从真机读取的最近 10 次训练快照（6 次剑术、3 次骑行、1 次滑冰），保留原日期与观测指标，UUID 替换为演示标识。信封的 `updatedAt` 与 `pushedAt` 注入时更新，但训练时间不变；圆环夹具 `activity-afternoon.json` 同样带信封级 `updatedAt`。剑术不把步行距离当成主要成绩；滑冰没有距离就不显示速度；网页每项最多两个指标：有距离时显示时长与距离，否则显示时长与活动消耗；不展示心率或均速。

网页卡片最多显示最近 10 条，每页上下排列 2 条，横向吸附滚动（共 5 页），隐藏独立标题栏，通过触控板、触摸或键盘横向浏览；上报和存储仍保留最近 10 条。训练记录合并在 Activity 卡片右侧（窄屏放底部），圆环区域保持原高度；出口节点卡全宽排列在其下。

