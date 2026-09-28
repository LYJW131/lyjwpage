# API 中枢

所有上报器直连此 Worker。它负责鉴权、解析、写 SQLite、广播 WebSocket 和通知 Vercel 缓存失效。
站点没有上报路由、rewrite、中继和事件发布逻辑。站点部署在 Vercel，腾讯云 EdgeOne 已退役。

## 代码职责

- `src/index.ts`：默认 Worker 入口与分钟 cron（只剩 pulse 归档与评分）；`src/origin-worker.ts` 负责七个上报来源、WebSocket 接入、人头数和公开 HTTP。
- `src/online-counter.ts`：「此刻在线」的房间，只数可见的页面，人数一变就广播给房间里所有连接。
- `src/stores/`：上报的 Worker 准备阶段与 StateHub 提交阶段；`src/phone-telemetry.ts`、`src/homepod-ingest.ts` 组合设备信封。
- `src/ingest-effects.ts`、`src/fanout.ts`：StateHub 提交时只收集可序列化效果；持久化确认后由普通 Worker 补充外部数据、广播并通知首屏 stale。
- `src/apple-music-recent.ts`：收下采集 Worker 拉回的最近在听，差分、写入和广播。
- `src/musickit-token.ts`：给「一起听」签 MusicKit developer token（ES256 JWT），按 origin 声明缓存、过半衰期重签。
- `src/origins.ts`：`ALLOWED_ORIGINS` 的解析、通配匹配和 CORS 头，两条 WebSocket、公开 API 和令牌签发共用。
- 根目录 `shared/`：读写共用的 SQLite 键、类型和状态计算；根目录 `src/lib/` 提供读取与通用工具。
- 根目录 `src/lib/status-views.ts`：公开状态视图登记表（`path` / `layer` / `tag` / `event`）。路径常量、数据层、Vercel 缓存标签、事件→路径全部由它派生；可滞后层（`layer: "lag"`）不能带推送事件，模块加载时断言。
- 根目录 `src/lib/status-loaders.ts`：按同一组 key 登记 `endpoint(params)`，单端点由 `src/public-api.ts` 通用分发到对应 loader。`trophies` 无参回摘要（与首屏、推送同形状），带 `?titleids=` 回那几款的完整目录。
- `src/public-api.ts`、`src/public-execution.ts`：普通 Worker 中的公开 API 入口。已知路由先匹配，再过 StateHub 初始化/提交可见性屏障；状态端点按 loader 表通用分发。屏障等待已经进入 `commitIngest()` 队列的提交，不等待仍在普通 Worker 做输入准备或 R2 HEAD 的请求；提交返回 202 后，经过 StateHub 的权威读取可见其持久化结果。可滞后层的端点只读 `LAG` KV，不过屏障。
- `src/lookup-routes.ts`、`src/edge-cache.ts`：`/api/lyrics`、`/api/motion-artwork` 按参数查询，结果只由参数决定，不过公开读屏障。先查当前机房的 Cache API（`caches.default`），命中不进 StateHub；未命中回源，只有 200 写回，按响应的 `max-age` 过期。条目只在当前机房、跨部署保留、不合并并发未命中，键里带 SQLite 那层的版本段，响应外形变了升 `EDGE_CACHE_VERSION`。存的响应不含 CORS 头，`X-Edge-Cache: hit | miss | bypass` 标识命中。
- `src/storage-driver.ts`：通过 alias 接入 StateHub 的 SQLite 存储驱动；同一公开请求、同一 microtask 的相邻只读批次合并成一次最多 128 条的 DO RPC，写批次保持原事务顺序。
- `src/lag-store.ts`：`@/lib/lag-store` 在 Worker 里的实现，读 `LAG` KV（可滞后层，格式见 `shared/lag.ts`）。厂商状态、GitHub、Vercel、Cloudflare、Sentry 这几条端点只读采集 Worker 写的那几条键，Vercel 与 Cloudflare 两条按名字把几条键拼成一份。
- `src/dev-override-reader.ts`：只在本地绑定的具名入口 `DevOverrideReader`，推送房间转发生产事件前经它查假数据注入。
- `src/r2-assets.ts`：R2 绑定 HEAD 检查，上报器仍直接上传图片。

## 端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/ingest/<来源>` | `mac`、`iphone`、`homepod`、`emby`、`playstation`、`server`、`agents` |
| POST | `/api/ingest/agents/otlp` | Claude Code 云端线程的内置遥测（OTLP/HTTP JSON 指标），Access 权限 `ingest:agents-otlp` |

`/api/ingest/agents` 的主体仍是各家限额行，按 id 合并后写进可滞后层 KV（`limits:v1`），由 `GET /api/status/limits` 读出，浏览器按 id 贴回 vibecoding 的用量行；限额的来源集合变了才失效首屏标签 `limits`。可选的 `cursorUsage` 是 Cursor 云端用量日桶
（`Asia/Shanghai`，字段与 Mac 的日用量相同，另加 `models`）。缺省表示这一轮没拉到，
站点留着上一份。读 `/api/status/vibecoding` 和 `/api/status/vibecoding/year` 时并进 Mac 的合计：
Mac 用量带 `omittedSources: ["cursor"]` 时整份另加；没有这个字段的旧 Mac 已经把 Cursor 算进合计，
锚定日按字段做差，之后的日子整段补上。`cursorUsage` 形状不合法时整封 400，限额也不会落地。

可选的 `cursorNow` 是 Cursor 账号最近一条用量事件：`lastActivityAt`（ISO 时刻，必填）和 `currentModel`。
容器平时随限额那一轮带上，Cursor 在用时每分钟查一次、变了单独发一封，这种信封可以不带 `agents`；不带时完全不碰限额镜像，
限额的心跳只看限额那一轮。存在 `vibecoding:cursor-now`，变了就推一条 `vibecoding-now`，
里面 `active` 固定为 `false` —— Cursor 那盏灯由浏览器按 `lastActivityAt` 在 5 分钟内现算，
事件停了灯自己灭。`agents`、`cursorUsage`、`cursorNow` 三者全缺时 400。

### Claude Code 云端线程用量

Mac 的 ccusage 只扫本机会话记录，看不到云端线程。云端环境打开 Claude Code 内置遥测，
每分钟把指标推到 `/api/ingest/agents/otlp`。这组变量**只配在云端环境设置里**，不进仓库的
`.claude/settings.json`，也不配在本机：本机会话已经由 ccusage 统计，再走遥测会重复计数。

```sh
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=none
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=https://ingest.homepage.lyjw.llc/api/ingest/agents/otlp
OTEL_EXPORTER_OTLP_HEADERS="CF-Access-Client-Id=<ACCESS_CLIENT_ID>,CF-Access-Client-Secret=<ACCESS_CLIENT_SECRET>"
OTEL_METRIC_EXPORT_INTERVAL=60000
```

端点要用 `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`（原样使用）；通用的 `OTEL_EXPORTER_OTLP_ENDPOINT` 会被自动拼上 `/v1/metrics`。
只认 JSON（可 gzip），不认 protobuf。鉴权复用 Access JWT 校验，要求专属 `ingest:agents-otlp` 权限；
`ingest:agents` 不能写此端点，云端凭据也不能写限额或设备上报。不接受 Bearer 密钥。

生产使用独立 service token `lyjwpage-claude-cloud`，已加入
`lyjwpage ingest` 应用的 Service Auth 策略，其 client ID 登记在 `wrangler.toml`
的 `[vars.ACCESS_CLIENTS]`，仅授予 `["ingest:agents-otlp"]`。轮换时同步更新策略与登记表；
未登记的 client ID 会返回 403。Client Secret 只放云端环境，不用配置 Worker secret。
请求头格式见 [Cloudflare service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)。

本地沿用 `node scripts/dev-access.mjs init` 生成的测试钥匙和 `header` 输出的
`Cf-Access-Jwt-Assertion`；本地 endpoint 用 `http://localhost:8788/api/ingest/agents/otlp`，
把该 JWT 填入 `OTEL_EXPORTER_OTLP_HEADERS="Cf-Access-Jwt-Assertion=<本地 JWT>"`。
测试 JWT 十分钟过期，长期调试需重新生成请求头。

只收 `claude_code.token.usage` 与 `claude_code.cost.usage`，其余指标收下后忽略（返回 200 `{}`，
整封拒掉 exporter 不重试，这一轮的数就丢了）。数据点上的邮箱、账号 ID、组织 ID 在解析时丢掉，
只存 session、model、token 类型、值和时刻。cumulative 时序下每条序列（指标、进程起点、全部属性，主会话和子代理的 `query_source` 不同就是两条）
记上次的累计值（键和会话都只存摘要），只加差值：丢一轮下一轮补齐，重发、乱序不多算；线程恢复成新进程时起点变了，按新计数器计。
差值按数据点时刻归到 `Asia/Shanghai` 日，存在 `vibecoding:claude-cloud-usage`，日桶留 400 天，进程计数器 30 天没见就清掉。
读 `/api/status/vibecoding` 与 `/vibecoding/year` 时接在 Cursor 之后整份并进 Mac 的合计、`claude` 那一行的今天和年度图：
两边会话不重叠，不做差。费用直接用 Claude Code 报的 `cost.usage`，和它自己 `/cost` 的口径一致。
首屏标签最多 5 分钟失效一次，卡片挂载后自己定时来问。

同一份数据点亮 Claude 那盏灯：最近一次有 token 增量的时刻作为 `claude` 行的 `cloudActivityAt`，
浏览器按 5 分钟窗口现算，和 Mac 报的 `active` 取或 —— Mac 合盖、上报器离线时云端在跑照样亮。
云端比本机新时，此刻模型换成云端最近用的那个。时刻往前走了大半分钟或换了模型，就推一条
`vibecoding-now`（整行，Mac 的 `active` / `lastActivityAt` 照抄权威值）；Mac 的推送不带这个字段，
浏览器保留手上的。Claude 云端活动不进 Pulse；Cursor 账号观测独立参与 Pulse。

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
每轮经 `StateCore.ingest("playstation", raw)` 交付，不走 HTTP；
`power` 是**另一个生产者**——Home Assistant 上那台 PS5 的电源开关实体，翻面时发一封
`{ version: 1, power: { on, observedAt?, entityId? } }`。两边互不覆盖：电源单独存一份，
读的出口（`/api/status/playing/now`）才并进 presence，否则 PSN 上报器每轮整份覆盖
presence 时会把它冲掉。`on` 必须是布尔值（HA 实体的 `"on"` / `"off"` 字符串要在自动化
模板里先翻译），`observedAt` 缺席按落地时刻算。

电源翻面时 API Worker 立刻广播一条 `playing-now`，页面当场就能看到；PSN 那侧的
`presence`（在玩什么）要等采集 Worker 下一轮，约 1～2 分钟。它自己也经 `StateCore.playstationPower()`
读这一份决定节奏，见 `workers/collector/README.md`。

奖杯内容变了（解锁、新 DLC、等级；不看 `observedAt` 和游玩时长）时广播一条 `trophies`，
带的是摘要 —— 等级、合计、最近解锁、各款进度，和 `GET /api/status/trophies` 无参回的
同一份，8 KB 级。整份目录不推：展开着的瓷砖收到后自己重取 `?titleids=` 那一两款的切片。
解锁到页面的延迟就是上报器发现它的延迟，也就是完整 tick 的节奏。
| GET | `/ws` | 浏览器接收事件推送的 WebSocket，页面开着就一直挂着；使用 `ALLOWED_ORIGINS` 校验来源 |
| GET | `/count` | `{ ok, connections }`：开着的页面数，供上报器判定中档 |
| GET | `/api/musickit/token` | `{ token, issuedAt, expiresAt }`：给「一起听」的 MusicKit developer token，同一份来源白名单；见下文 |
| GET | `/` | 一行存活；不碰 Durable Object，根路径被探针不停打 |

两个数是两个口径，分别位于两个 Worker 的 Durable Object：`LivePushRoom` 走休眠 API，静默 5 分钟不计数、
30 分钟才关，因为后台标签页的定时器会被浏览器节流；`OnlineCounterRoom` 把连接留在实例里，
静默三个心跳周期（90 秒）就踢，因为可见页面不会被节流，一条僵尸多活 5 分钟就把三个上报器
多钉在快档 5 分钟。心跳 30 秒定义在站点 `src/hooks/use-online-count.ts`，Worker 里那份是
手抄的副本，改一边必须改另一边。

上报走 `https://ingest.homepage.lyjw.llc/api/ingest/<来源>`。这个域名整站挂在 Cloudflare Access 应用「lyjwpage ingest」后面，
策略只放行登记过的 service token：每个来源一把（`lyjwpage-mac`、`-iphone`、`-emby`、`-server`、`-agents`、
`-home-assistant`、`-github-actions`），上报器带 `CF-Access-Client-Id` / `CF-Access-Client-Secret` 两个头。
Access 在边缘核对，不对直接回 401；放行的请求带着 Access 签的 JWT（`Cf-Access-Jwt-Assertion`）到 Worker，
`src/access-auth.ts` 再验一遍签名、受众（`ACCESS_AUD`）、签发方（`ACCESS_TEAM_DOMAIN`）和时效 —— 同一个 Worker
还能从 `api.` 域名和 workers.dev 进来，那两条路不过 Access。验过之后按 JWT 里的 `common_name`（client id）查
`wrangler.toml` 的 `[vars.ACCESS_CLIENTS]`，只许写登记的来源，越权回 403。新增或轮换 token 在 Zero Trust 控制台做，
新 token 要加进策略，再把 client id 登记进那张表。

SQLite 未就绪返回 503，鉴权失败返回 401，非法报文返回 400，成功返回 202。202 表示持久化完成，广播和缓存通知由 `waitUntil` 执行。
旧站点 `/api/ingest/*` 与 Worker `/publish` 均不存在。

Worker 在 SQLite 写入完成后，仅对首屏布局变化在 `waitUntil` 后台任务中通知 Vercel：POST `${SITE_URL}/api/revalidate`，Bearer 用只有 Worker 和 Vercel 两边有的 `REVALIDATE_SECRET`，只传 `{ tags }`。按白名单将 `page:<tag>` 标 stale，先返回已有 HTML，后台重建。首页整页只有一个缓存条目，任何标签失效都是整页重建，所以各上报在自己手里的新旧两份上判断布局有没有变：充电头 / 充电宝那一格亮灭、在听的 hero 出现或消失、「正在看」开播停播、续看和游玩列表空与非空、服务器首报 / 流量行 / 断流后回来、奖杯首次到达、训练条目。判据与页面共用 `src/lib/home-layout.ts`。Vibe coding 的骨架由三路拼成，在出口按拼好的那份比对上一次通知时的骨架（`home-layout:vibecoding`），行数、总量与常用模型的有无变了才发。读数、标题、进度、灯色等内容变化不通知，由首屏快照 `revalidate: 600` 定时重建；浏览器挂载后直接问 Worker。通知 5 秒超时，失败只记日志，不能让已落库的上报重发。纯心跳和没有标签的广播不触发缓存通知。

ESA 首页不走数据上报通知。`lyjw131.com` 以 `lyjw.me` 为源站与回源 Host，控制台缓存规则「首页遵循源站缓存」（主机名等于本站、URI 路径等于 `/`，排在 PWA 绕过规则之后）让边缘按源站 `Cache-Control: public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400`（根目录 `next.config.ts`）自行缓存：5 分钟内命中，之后先回旧 HTML、后台回源取新。带内容哈希的静态 JS 按源站一年 immutable 缓存，不随上报清理。新版本部署上线时，由 GitHub Actions（`.github/workflows/purge-esa.yml`）在 Vercel 生产部署完成后自动调用 `PurgeCaches` 刷新一条首页 cachekey，随后主动发起请求预热边缘节点缓存；日常上报不触发刷新。同一工作流的第二步等 `lyjw.me` 与 `lyjw131.com` 的 `/api/version` 都答出这次部署的 sha，再用 `lyjwpage-github-actions` 那把 service token（仓库 secret `ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET`）调 `POST https://ingest.homepage.lyjw.llc/api/internal/site-deployed`，Worker 向所有连着的页面广播不带数据的 `version` 事件，页面重问 `/api/version` 并弹出更新提示；站点自己的版本轮询因此只作半小时一次的兜底。

这条规则是必需的：`/` 没有文件后缀，不匹配任何默认缓存类型，没有规则覆盖时 ESA 直接判 DYNAMIC、每次回源——之前命中率归零的真正原因。针对高频数据上报的 `PurgeCaches` 链路（含 RAM 密钥、Worker 冷却表）已删除；日常依赖 SWR 自行收敛，仅在站点全量新构建发布时由 CI 触发单次刷新。

Vercel 仍采用后台重建，通知成功不代表新 HTML 已生成。ESA 后台回源可能取得 Vercel 仍在重建中的旧 HTML，下一轮刷新时收敛；这条链路不承诺两层缓存同步完成更新。首屏新鲜度不依赖这两层：浏览器挂载后直接向 Worker 取最新状态。

公开 API 为 `/api/status/*`、`/api/lyrics`、`/api/motion-artwork`，没有聚合端点。Vercel 生成或重建首页时按卡读各条端点（`src/lib/first-screen.ts`），浏览器挂载后实时卡各自回源一次、之后各端点按各自周期轮询。服务端凭据不进入任何公开响应，没有通用 HTTP 数据库端点。跨域活动脉搏（pulse）的出口是 `GET /api/status/pulse`，见下面一节。

## 跨域活动脉搏（Pulse）

`GET /api/status/pulse` 是最近 24 小时「在做什么」的事实时间线，六条道：`coding` / `listening` /
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

**只有媒体与游戏标题公开**；应用名、模型名、token 用量、充电设备名不出这个端点，Coding 只给三色带和
Jev 的强度、模式。

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
  写入口自己留一份（训练卡片的数据以后可能挪去 KV），内容没变不写。

档位时代的 `pulse:<domain>`、`pulse:listening-plays`、`pulse:listening-checks` 不再写，随 TTL 过期，不迁移。

本地预览用夹具：`pnpm dev:override /api/status/pulse pulse-busy-day.json`（另有 `pulse-empty`、`pulse-zero-lanes`、
`pulse-activity-boundary`）。卡片右下角开发开关「Traces」切换不确定区间的斜线 / 淡色画法，默认斜线。

### Coding 的 Jev 评估

Jev 只给 Coding 打分：原始观测说得出「前台是不是 coding 应用、agent 在不在跑」，说不出「写得多投入」，
强度和模式仍问 Jev，只在悬停里出现。别的道画的就是事实本身，不再有模型分、趋势和置信度。
`PulseScorer` 和 `pulse:assessments` 只剩 `coding`；StateHub 的 metadata 保存评分 claim、generation、lease 和
最近尝试时刻；普通 Worker 领取固定输入快照（评估、Coding 观测、token 报告、Cursor 观测）、执行模型请求，
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

`PULSE_ASSESSMENT_VERSION`（现为 5）进输入哈希，改问题时升版本让全部窗口重评，不靠哈希碰巧变。
改判据先跑 `node --experimental-strip-types --import ./src/lib/testing/register-alias.mjs scripts/jev-probe.mts`
（key 读根目录 `.env.local` 的 `TYPESAFE_API_KEY`）：几个代表性的 Coding 窗口打真实 Jev，每条都写着期望答案，
偏了先改措辞再上线——改判据上线会触发最近 24 小时重评。相同输入哈希不重复调用；晚到 token 改变窗口事实时
只重评受影响窗口。失败保留旧成功记录，下一轮重试，存储读失败不会清空历史。评估列表追加写，同一窗口以
最后一行为准，被覆盖的行多过有效行一半或总数超过上限（2016）的 1.5 倍才整表压缩。

MacTelemetryHub 的 `modules.vibeCodingNow.tokenUsage` 携带最近 24 小时的用量桶。原始桶保持五分钟，不随 Jev 评分改动；评分时聚合窗口内三个桶，完整上报范围内缺失的桶视为零事件，范围外或来源 partial/unavailable 保留 unknown。字段为 `from/to/collectedAt`（epoch 毫秒）、`sources[{id,state}]`、
`windows[{from,to,agents}]`。每行 agent 有 `id/model/inputTokens/outputTokens/
cacheReadTokens/cacheCreationTokens/reasoningTokens/eventCount`；input 不含 cache read，
reasoning 属于 output 子集，eventCount 是去重用量事件数，不宣称上游 HTTP 请求数。
Codex 与 Claude 使用本地日志事件时间，sources 状态区分 ok、partial、unavailable；
其他来源没有细粒度用量，不能由日总量拆分。该数据只入内部存储，不进入公开补丁。

不上传提示词、回复正文、项目路径或 session ID。token 是工作活动的证据，不是生产力。
Mac 同状态每分钟最多保存一次内部观测，变化立即记录；缺报三分钟后中断。
Cursor 使用独立的 `pulse:cursor-observations`：`cursorNow` 或成功的 `cursorUsage` 检查都会记录，日桶内容没变化也更新观测。重复、乱序的采集时刻不延长有效期，error / warning 不当成零活动。闲时上报周期最长一小时，因此检查覆盖最多保持 65 分钟；最近事件只按 5 分钟活动窗口计入，之后仅表示 Cursor 来源可用。Mac 离线不会抹掉这份覆盖，Cursor 过期也不会抹掉 Mac 的覆盖；两者并集去重。仅 Cursor 可用且没有活动或正 token 证据时直接写 0，置信度为 0.5，内部模型标记为 `rules:limited-source`，不调用 Jev；这不等于确定全局没有 Coding。

### 长期归档（D1）

写入方是状态核心：cron 每分钟由 StateHub 按各路水位（metadata `pulse-archive:v2:<路>`）给出一份有界快照，
普通 Worker 拼成按自然键幂等的 upsert 写 D1，全部成功后才确认水位；一路读坏、写坏不挡别的路。
代码在 `src/pulse-archive.ts`，表在迁移 `0007_history_pulse.sql`：

| 表 | 内容 | 自然键 |
| --- | --- | --- |
| `listening_plays` | 每段实测在放（`certain = 1`，来源 mac / homepod，曲名 / 艺人 / 专辑 / 曲目 id）与不确定区间（`certain = 0`，`source = 'recent'`，专辑 / 歌单名在 `album`、目录 id 在 `item_id`） | `(source, started_at)` |
| `watching_sessions` | 同一条目首尾相接的播放 + 暂停，`playing_seconds` 只算在播 | `(item_id, started_at)` |
| `game_sessions` | 在游戏里的时段 | `(title_id, started_at)` |
| `charging_samples` / `charging_sessions` | 过了闸门的瓦数；一次充电的起止、峰值、能量、设备 | `t` / `started_at` |
| `activity_buckets` | HealthKit 五分钟桶原值；范围替换由 `pulse_archive_state` 里 `activity_buckets` 那行的版本挡住旧快照 | `started_at` |
| `coding_observations` | Coding 原始观测（agents 为 JSON） | `t` |
| `coding_token_buckets` | Mac 本机五分钟 token 桶，agent × 模型 | `(bucket_at, agent, model)` |
| `agent_usage_days` | 每天（Asia/Shanghai）× agent × 模型，各来源只填真有的列 | `(date, agent, model)` |

`agent_usage_days` 的来源与缺口：具体模型的行里，codex / claude 由 `coding_token_buckets` 汇总（token 分类、
reasoning、事件数），cursor / claude-cloud 只有云端日桶给的每模型 `total_tokens`；`model = '*'` 是这个 agent 当天
的合计，token 分类与 API 等值费用只在这一级（没有按模型的费用），codex / claude 取 Mac 用量摘要的 `today`
（只归档到那天最后一次采集），cursor / claude-cloud 取各自日桶；`active_seconds` 来自 Coding 观测
（agent 在跑的时长，3 分钟保持，按 max 只增不减），Cursor 只有账号级。`model = ''` 是没有模型名的 token 事件。
token 报告范围本身不归档，所以归档里「没有行」分不清是零事件还是没报。

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
不是一回事、不共用路径。从前是单独的 musickit-token Worker，09-07 并进来。

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
`EMBY_PUBLIC_URL`、`APPLE_MUSIC_STOREFRONT`、`ALLOWED_ORIGINS`、`APPLE_MUSIC_TEAM_ID`、
`APPLE_MUSIC_KEY_ID`，`IMAGES` 桶绑定（只 HEAD；响应里的图片地址是 `/img/<对象键>` 同源路径，
Worker 不配交付域，回源 R2 由站点的 rewrite 和 ESA 负责，见根 README「图片」），
以及 `LIVE_PUSH` 与 `STATE` 两个 Durable Object 绑定（迁移只追加新 tag，不改旧的）。`LAG`、`CREDENTIALS` 两个 KV 绑定见 `shared/lag.ts`、`shared/credentials.ts`；`HISTORY` 是长期归档用的 D1 库 `lyjwpage-history`（上报入口的四张表与 Pulse 事实表，见上文「长期归档（D1）」），
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
这个 Worker 在 ingest 域名上的 `/api/ingest/<来源>`，不经过站点；PlayStation 例外，由采集 Worker（`workers/collector`）
经 Service Binding 调具名 entrypoint `StateCore`（`src/state-core.ts`，契约 `shared/state-core.ts`）的 `ingest("playstation", raw)`，
并通过 `connections()` / `playstationPower()` 读取连接数与主机电源，不带凭据；按人数调频的（如 agents-reporter）同时读取此源 `/count` 的 `connections` 与 `ONLINE_COUNTER_URL/count` 的 `online`，server-reporter 固定每分钟推一次。实例清单见 [端点核验记录](../../docs/reporter-endpoints.md)。

提交并推送 main，由 Cloudflare Workers Builds 原生 Git 集成自动部署。
`shared/`、共用 `src/lib/`、根依赖及路径配置变化也触发 api 部署。

## 本地开发

```sh
cp .dev.vars.example .dev.vars      # 填 GITHUB_TOKEN；STATE_IMPORT_SECRET 本地随便填
pnpm dev:worker                     # 仓库根目录执行；http://localhost:8788
pnpm dev:worker:init                # 只需一次，初始化空的 StateHub
pnpm dev:local                      # 站点指向本地 Worker
```

`pnpm dev:worker` 是一个 `wrangler dev` 进程、三份配置：`workers/dev-router/wrangler.toml`（第一个，拿端口）、
本目录的 `wrangler.test.toml` 和 `workers/collector/wrangler.test.toml`。多配置下只有第一个 Worker 有端口，
dev-router 按路径分发：`/__dev/collector/*` 给采集 Worker 的调试入口（见它的 README），
`/api/ingest/*`、`/api/internal/*` 以及其余一切（含 `/ws`）给 api。三个 Worker 共用 `--persist-to`，
`LAG`、`CREDENTIALS` 两个本地 KV 用同一个 id，一边写的另一边读得到；Service Binding 按生产名字
（`api`、`collector`）互相找到，所以本地 api 的名字也是 `api`。
`curl localhost:8788/cdn-cgi/local/scheduled` 触发的是 dev-router 的 `scheduled`，它让采集 Worker 跑这一分钟到期的任务；
api 自己的分钟 cron 本地触发不到（Service Binding 调不了别的 Worker 的 `scheduled`），它本地要做的
D1 归档、Jev 打分本来也被隔离开关关着。

本地用 `wrangler.test.toml`：生产配置里的 `deleted_classes` 迁移在空环境下起不来，测试配置有从头开始的迁移链，且没有生产域名和 cron。
状态持久化在 `.wrangler/dev-state`（`DEV_WORKER_STATE` 可以另指一个目录），重装或想清库就删它，再跑一次 init。
本地 api 从 `ingest-do-test` 改名为 `api` 之后，Durable Object 的本地目录跟着换了名字，旧库不再被读到：再跑一次 init。

本地是空库。`.dev.vars` 里的 `UPSTREAM_API_URL` 让 `publicResponse` 生产为主、本地补缺：生产 `ok:true` 的快照字段和端点用生产的，
生产没有的（新加的端点、新字段）或生产也 `ok:false` 的才用本地的（只读、不上报）。生产的 wrangler.toml 不配它。
分支预览是同一套兜底的线上版：`wrangler preview` 在生产脚本 `api` 上按分支开一份隔离的 Preview，Vercel 预览改连它。见 [Workers 构建](../../docs/workers-builds.md)。
要测上报链路，把这个变量注释掉让本地只看自己，然后往 `http://localhost:8788/api/ingest/<来源>` 推。本地没有 Access：
先 `node scripts/dev-access.mjs init` 生成测试钥匙、把它打印的 `ACCESS_DEV_JWKS` 填进 `.dev.vars`，
推的时候带 `node scripts/dev-access.mjs header` 打出的 `Cf-Access-Jwt-Assertion` 头（10 分钟有效）。

配了 `UPSTREAM_API_URL` 后，本地的推送房间还会在有页面连着时自己去连生产的 `/ws`，把事件转发给本地页面（最后一个页面断开就跟着断，不多占生产那边的连接数），所以本地也能收到实时推送。事件对应的端点有生效的注入时，payload 换成注入的那份，假数据不会被生产一推就盖掉。

`DEV_OVERRIDES=true` 时另开 `PUT` / `DELETE /api/dev/override/<端点路径>` 和 `GET /api/dev/overrides`，往本地 SQLite 里注入某条端点的信封，
优先于上游和本地；夹具放 `dev-fixtures/`，用根目录的 `pnpm dev:override` 推。`index.ts` 只在这个变量开着时放行非 GET。
夹具里的时间戳写成 `"$now"` / `"$now-90000"`（毫秒偏移），推送脚本在发出前换成当下 —— 注入绕过路由，没人替它续心跳，写死的 `pushedAt` 几分钟就会被判成过期。

## 验证

```sh
pnpm --dir workers/api typecheck
pnpm --dir workers/api test
node scripts/verify-api-worker.mjs --build
```

集成脚本启动隔离 SQLite、Worker、KV 和缓存通知测试服务器，检查鉴权、404、初始化屏障、并发假数据索引、写入、缓存失效、真实 WebSocket、重启持久化。`--build` 还会在已初始化的隔离 Worker 存活期间，把 `NEXT_PUBLIC_BACKEND_URL` 和在线人数源指向该本地地址并运行生产构建。退出时清理临时状态，不使用生产绑定或凭据。

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

只查询本仓库的 `api`、`ingress`、`collector`、`online-counter`（名单在 `src/lib/cloudflare-workers-types.ts`，
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
上报器自己数（两边同一份 `push-ledger.ts`），这里只校验、把最新一份加上收到的时刻写进可滞后层（每个上报器一条，
`reporter:server-reporter:v1` / `reporter:agents-reporter:v1`），由 `GET /api/status/reporters` 给卡片服务区最后两格。块写坏或旧版没带都当没有，不因此拒掉整封上报。

## 最近训练

`POST /api/ingest/iphone` 的 v1 信封接受 `modules.workouts: { items: [...] }`，每次完整替换最近最多 10 条训练（空列表清空）。记录字段为 `id`（HealthKit UUID）、`activityType`（英文类型）、`startedAt` / `endedAt`（epoch 毫秒）、`secondsFromGMT`（训练当地 UTC 偏移秒）、`durationSeconds`（扣除暂停的活动秒数），以及可选的 `distanceMeters` / `activeEnergyKcal`、`averageHeartRateBpm` / `maximumHeartRateBpm`、`elevationAscendedMeters`、`indoor`（boolean）。缺失指标对外为 null，不能解释为零。

`GET /api/status/workouts` 返回 `{ items, pushedAt }` 的标准状态信封。快照保存在 `workouts:recent`，不按训练日期过期；超过 7 天未同步时卡片标明同步延迟。上报失效 `workouts` 首页缓存标签，浏览器每 5 分钟轮询，不新增推送事件。共享代码路径已包含在 Worker 原生构建监视范围内。

本地预览：`pnpm dev:override /api/status/workouts workouts.json`，夹具仅供开发环境，启用时页面显示 Fake data。真实记录需要安装 iOS 27 上报器并允许训练读取。

`workouts.json` 是 2026-09-20 从真机读取的最近 10 次训练快照（6 次剑术、3 次骑行、1 次滑冰），保留原日期与观测指标，UUID 替换为演示标识。`pushedAt` 注入时更新，但训练时间不变。剑术不把步行距离当成主要成绩；滑冰没有距离就不显示速度；网页每项最多两个指标：有距离时显示时长与距离，否则显示时长与活动消耗；不展示心率或均速。

网页卡片最多显示最近 10 条，每页上下排列 2 条，横向吸附滚动（共 5 页），隐藏独立标题栏，通过触控板、触摸或键盘横向浏览；上报和存储仍保留最近 10 条。训练记录合并在 Activity 卡片右侧（窄屏放底部），圆环区域保持原高度；出口节点卡全宽排列在其下。

