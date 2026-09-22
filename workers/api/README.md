# API 中枢

所有上报器直连此 Worker。它负责鉴权、解析、写 SQLite、广播 WebSocket 和通知 Vercel 缓存失效。
站点没有上报路由、rewrite、中继和事件发布逻辑。站点部署在 Vercel，腾讯云 EdgeOne 已退役。

## 代码职责

- `src/index.ts`：默认 Worker 入口、KV 读模型前置与 cron；`src/origin-worker.ts` 负责七个上报来源、WebSocket 接入、人头数和公开 HTTP。
- `src/online-counter.ts`：「此刻在线」的房间，只数可见的页面，人数一变就广播给房间里所有连接。
- `src/stores/`：上报的 Worker 准备阶段与 StateHub 提交阶段；`src/phone-telemetry.ts`、`src/homepod-ingest.ts` 组合设备信封。
- `src/ingest-effects.ts`、`src/fanout.ts`：StateHub 提交时只收集可序列化效果；持久化确认后由普通 Worker 补充外部数据、广播并通知首屏 stale。
- `src/apple-music-recent.ts`：最近在听的拉取、写入和广播。
- `src/musickit-token.ts`：给「一起听」签 MusicKit developer token（ES256 JWT），按 origin 声明缓存、过半衰期重签。
- `src/origins.ts`：`ALLOWED_ORIGINS` 的解析、通配匹配和 CORS 头，两条 WebSocket、公开 API 和令牌签发共用。
- 根目录 `shared/`：读写共用的 SQLite 键、类型和状态计算；根目录 `src/lib/` 提供读取与通用工具。
- 根目录 `src/lib/status-views.ts`：公开状态视图登记表（`path` / `tag` / `event` / `readModel`）。路径常量、Vercel 缓存标签、事件→路径、`/api/home` 字段、KV 策略全部由它派生；有 `event` 的视图不能进 KV，模块加载时断言。
- 根目录 `src/lib/status-loaders.ts`：按同一组 key 登记 `endpoint(params)` 与可选 `home()`。`/api/home` 对表做 `Promise.all`；单端点由 `src/public-api.ts` 通用分发到同一个 loader。`trophies` 首屏是摘要、`charger` 首屏只带最近 20 分钟历史。
- `src/public-api.ts`、`src/public-execution.ts`：普通 Worker 中的公开 API 入口。已知路由先匹配，再过 StateHub 初始化/提交可见性屏障；状态端点按 loader 表通用分发。屏障等待已经进入 `commitIngest()` 队列的提交，不等待仍在普通 Worker 做输入准备或 R2 HEAD 的请求；提交返回 202 后，经过 StateHub 的权威读取可见其持久化结果。命中 KV 的四条投影路径仍按下文的 revision、刷新间隔和最大年龄最终收敛。
- `src/storage-driver.ts`：通过 alias 接入 StateHub 的 SQLite 存储驱动；同一公开请求、同一 microtask 的相邻只读批次合并成一次最多 128 条的 DO RPC，写批次保持原事务顺序。
- `src/read-model*.ts`：可选的 KV 公开读取投影。DO alarm 保留持久队列、重试与最终 KV 单写者，JSON 由同部署 `ReadModelRenderer` 普通 Worker entrypoint 生成；边界见 `docs/kv-read-model.md`。
- `src/r2-assets.ts`：R2 绑定 HEAD 检查，上报器仍直接上传图片。

## 端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/ingest/<来源>` | `mac`、`iphone`、`homepod`、`emby`、`playstation`、`server`、`agents` |

`/api/ingest/agents` 的主体仍是各家限额行。可选的 `cursorUsage` 是 Cursor 云端用量日桶
（`Asia/Shanghai`，字段与 Mac 的日用量相同，另加 `models`）。缺省表示这一轮没拉到，
站点留着上一份。读 `/api/status/vibecoding` 和 `/api/status/vibecoding/year` 时并进 Mac 的合计：
Mac 用量带 `omittedSources: ["cursor"]` 时整份另加；没有这个字段的旧 Mac 已经把 Cursor 算进合计，
锚定日按字段做差，之后的日子整段补上。`cursorUsage` 形状不合法时整封 400，限额也不会落地。

可选的 `cursorNow` 是 Cursor 账号最近一条用量事件：`lastActivityAt`（ISO 时刻，必填）和 `currentModel`。
容器平时随限额那一轮带上，Cursor 在用时每分钟查一次、变了单独发一封，这种信封可以不带 `agents`；不带时完全不碰限额镜像，
限额的心跳只看限额那一轮。存在 `vibecoding:cursor-now`，变了就推一条 `vibecoding-now`，
里面 `active` 固定为 `false` —— Cursor 那盏灯由浏览器按 `lastActivityAt` 在 5 分钟内现算，
事件停了灯自己灭。`agents`、`cursorUsage`、`cursorNow` 三者全缺时 400。

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
每一项各自可省、缺席表示这次不谈这一项。前三项由 `workers/playstation-reporter` 每轮交付；
`power` 是**另一个生产者**——Home Assistant 上那台 PS5 的电源开关实体，翻面时发一封
`{ version: 1, power: { on, observedAt?, entityId? } }`。两边互不覆盖：电源单独存一份，
读的出口（`/api/status/playing/now`）才并进 presence，否则 PSN 上报器每轮整份覆盖
presence 时会把它冲掉。`on` 必须是布尔值（HA 实体的 `"on"` / `"off"` 字符串要在自动化
模板里先翻译），`observedAt` 缺席按落地时刻算。

电源翻面时 API Worker 立刻广播一条 `playing-now`，页面当场就能看到；PSN 那侧的
`presence`（在玩什么）要等上报器下一轮，约 1～2 分钟。上报器自己也读这一份决定节奏，
见 `workers/playstation-reporter/README.md`。
| GET | `/ws` | 浏览器接收事件推送的 WebSocket，页面开着就一直挂着；使用 `ALLOWED_ORIGINS` 校验来源 |
| GET | `/count` | `{ ok, connections }`：开着的页面数，供上报器判定中档 |
| GET | `/api/musickit/token` | `{ token, issuedAt, expiresAt }`：给「一起听」的 MusicKit developer token，同一份来源白名单；见下文 |
| GET | `/` | 一行存活；不碰 Durable Object，根路径被探针不停打 |

两个数是两个口径，分别位于两个 Worker 的 Durable Object：`LivePushRoom` 走休眠 API，静默 5 分钟不计数、
30 分钟才关，因为后台标签页的定时器会被浏览器节流；`OnlineCounterRoom` 把连接留在实例里，
静默三个心跳周期（90 秒）就踢，因为可见页面不会被节流，一条僵尸多活 5 分钟就把三个上报器
多钉在快档 5 分钟。心跳 30 秒定义在站点 `src/hooks/use-online-count.ts`，Worker 里那份是
手抄的副本，改一边必须改另一边。独立在线人数 Worker 的 `/ws` 按可见性反复重连，不触发 API 的最近在听刷新。

上报要求 `Authorization: Bearer <TELEMETRY_INGEST_SECRET>`，未配置密钥或 SQLite 返回 503，
鉴权失败返回 401，非法报文返回 400，成功返回 202。202 表示持久化完成，广播和缓存通知由 `waitUntil` 执行。
旧站点 `/api/ingest/*` 与 Worker `/publish` 均不存在。

Worker 在 SQLite 写入完成后，仅对展示变化在 `waitUntil` 后台任务中通知 Vercel：POST `${SITE_URL}/api/revalidate`，使用同一 Bearer，只传 `{ tags }`。按白名单将 `page:<tag>` 标 stale，先返回已有 HTML，后台重建。通知 5 秒超时，失败只记日志，不能让已落库的上报重发。纯心跳和没有标签的广播不触发缓存通知。

ESA 首页不走数据上报通知。`lyjw131.com` 以 `lyjw.me` 为源站与回源 Host，控制台缓存规则「首页遵循源站缓存」（主机名等于本站、URI 路径等于 `/`，排在 PWA 绕过规则之后）让边缘按源站 `Cache-Control: public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400`（根目录 `next.config.ts`）自行缓存：5 分钟内命中，之后先回旧 HTML、后台回源取新。带内容哈希的静态 JS 按源站一年 immutable 缓存，不随上报清理。新版本部署上线时，由 GitHub Actions（`.github/workflows/purge-esa.yml`）在 Vercel 生产部署完成后自动调用 `PurgeCaches` 刷新一条首页 cachekey，随后主动发起请求预热边缘节点缓存；日常上报不触发刷新。

这条规则是必需的：`/` 没有文件后缀，不匹配任何默认缓存类型，没有规则覆盖时 ESA 直接判 DYNAMIC、每次回源——之前命中率归零的真正原因。针对高频数据上报的 `PurgeCaches` 链路（含 RAM 密钥、Worker 冷却表）已删除；日常依赖 SWR 自行收敛，仅在站点全量新构建发布时由 CI 触发单次刷新。

Vercel 仍采用后台重建，通知成功不代表新 HTML 已生成。ESA 后台回源可能取得 Vercel 仍在重建中的旧 HTML，下一轮刷新时收敛；这条链路不承诺两层缓存同步完成更新。首屏新鲜度不依赖这两层：浏览器挂载后直接向 Worker 取最新状态。

公开 API 为 `/api/status/*`、`/api/home`、`/api/lyrics`、`/api/motion-artwork`。浏览器挂载后直接访问这里：第一轮从 `/api/home` 一次取齐，之后各端点按各自周期轮询；Vercel 只在首屏生成或重建时读取 `/api/home`。`/api/home` 每个字段和对应单端点无参响应同源同形。`/api/home` 不进 KV 读模型。服务端凭据不进入任何公开响应，没有通用 HTTP 数据库端点。跨域活动脉搏（pulse）的出口是 `GET /api/status/pulse`（也进 `/api/home` 的 `pulse` 字段），见下面一节。

## 跨域活动脉搏与活动分（Pulse）

`GET /api/status/pulse` 给出六个域（`coding` / `listening` / `watching` / `gaming` / `charging` / `activity`）
最近 24 小时的实测阶跃序列或模型活动分，`/api/home` 的 `pulse` 字段是同一份，首页那张
Pulse 卡片用它。信封形状：

```jsonc
{ "ok": true, "data": {
  "generatedAt": 1770000000000,
  "window": { "from": 1769913600000, "to": 1770000000000 },
  "domains": {
    "coding": {
      "kind": "score",
      // 五分钟模型评估；尚未评分时为空数组
      "assessments": [],
      // 还没打过分时为 null
      "score": { "value": 2.4, "confidence": 0.82, "trend": "rising", "scoredAt": 1769999700000 }
    }
    // activity 同形；其余域见下方实测契约
  }
} }
```

**仅媒体／游戏段公开当时的 title；应用/模型名称与 token 用量不出公网。** 播放／游戏状态与瓦数可公开；
公开端点返回五分钟评估和同源汇总，详细契约与调度见下方统一评分章节。
没有 `TYPESAFE_API_KEY`、或本地配了 `DEV_OVERRIDES` / `UPSTREAM_API_URL` 时停用自动评分。

`activity` 是 Apple Watch 身体活动，由 `/api/ingest/iphone` 的 `modules.activity`
`history: { from, to, buckets }` 生成。iPhone 直接查询最近 24 小时已经结束的 UTC 五分钟 HealthKit
statistics；每个桶只携带实际可读的 active energy、exercise time、steps，缺失字段不补零，三项都缺失的
时间保持未知。`from` / `to` 是权威查询范围，后到的完整结果会修订或删除范围内旧桶。
按桶内平均步频或锻炼时间占比取较高档：≥60 steps/min 或 ≥50% 为 3，≥20 steps/min 或 ≥10%
为 2；其余有活动能量、步数或锻炼为 1，明确读到三项均为 0 才是 0。
样本 `{ t, until, level }` 的 `until` 是闭合桶终点；绘图、窗口统计和评分均在此截止，不向当前时刻延伸。
查询修订只失效事实实际变化的评分窗，运行中的旧 activity 评分也由 history revision 拒收。
首次发布此版本前执行 D1 迁移 `0002_pulse_activity_intervals.sql` 和 `0004_pulse_archive_revisions.sql`
（`pnpm --dir workers/api exec wrangler d1 migrations apply lyjwpage-history --remote`），
归档将终点保存在 `until_at`，并用范围 revision 原子替换 activity 历史，较旧的异步归档不能复活已删除桶；StateHub 记下已归档的查询范围与版本，没有新上报时每分钟的归档不碰 D1，替换时也只写实际新增、修订或删除的行；已有域不带终点，值为 NULL。
尚无分段评分时新行显示 `Awaiting scores`。

本地预览用夹具：`pnpm dev:override /api/status/pulse pulse-busy-day.json`。

### Pulse 统一五分钟评分

六个领域共用 `PulseScorer` 和 `pulse:assessments`。StateHub 的 metadata 保存评分 claim、generation、lease 和最近尝试时刻；普通 Worker 领取固定输入快照、执行模型请求，再用 token + generation 提交，过期任务不能覆盖新结果。
旧的十分钟 24 小时模型总评已经删除；右侧摘要由最近 24 小时的同一批五分钟评分按
实际覆盖时长加权，趋势比较最近三小时与此前三小时，没有两侧观测时为 `unknown`。
曲线和摘要不再有两套评分来源。公开契约为 `domains[domain].assessments` 和 `score`，
不再返回旧 `samples` 或根级 `codingAssessments`。

每分钟 cron 检查，两轮尝试至少隔五分钟；窗口结束后留两分钟等待采集与上报。
每个领域每个窗口各一份官方 `jev-1.13.0` 请求，强度与连续性一起评估，Coding
再判断模式。每轮最多 36 份请求，并发最多 3；优先新窗口，再补最近 24 小时。
没有观测不调用；空闲观测可评分。六项均参与模型评分。

按 Jev 文档（不会数数、不会算时长、不比时间戳、档位要写情境不写程度），发给它的
state 一律是代码算好的命名秒数和次数，没有原始区间、时间戳或数字图例；判据写在
`instructions` / `criteria` 里，不塞在 state 里。各域的特征与问题在 `shared/pulse-<domain>.ts`，
共用的裁窗与计数在 `shared/pulse-features.ts`：

- listening：`playingSeconds / pausedSeconds / idleSeconds / longestPlayingRunSeconds`，以及占 `observedSeconds` 的整数百分比 `playingPercent / pausedPercent / longestPlayingRunPercent`（判据按百分比写，模型不用自己除），`trackChanges / distinctTracks / tracks / recentPlays`。切歌次数由样本里 hint 的变化数出来，指令说明连续换曲是有人在挑歌、一张专辑放到底也是在听。`recentPlays` 是「最近在听」列表落进这个窗口的痕迹，带 `gap`（within five minutes / within an hour / several hours）说明落位精度。另有 `mode` Choice：idle / paused / steady / selecting / traces。
- watching：`playingSeconds / pausedSeconds / idleSeconds / longestPlayingRunSeconds`、`playingPercent / pausedPercent / longestPlayingRunPercent`、`titleChanges / titles`。
- gaming：`inGameSeconds / onlineIdleSeconds / offlineSeconds / longestGameRunSeconds`、`inGamePercent / longestGameRunPercent`、`gameChanges / games`；「主机在线未进游戏」是它自己的桶和档位。
- charging：`secondsByBand` 与 `percentByBand`（`unplugged / trickle / moderate / high`）、`peakWatts / longestPoweredRunSeconds / longestPoweredRunPercent`，分档阈值 0 / 15 / 60 W 与 `chargingLevel` 一致。
- activity：圆环估算仍是 `stillSeconds / lightSeconds / moderateSeconds / vigorousSeconds / longestMovingRunSeconds`、`movingPercent / vigorousPercent / longestMovingRunPercent`，每档写明对应的步频与锻炼分钟占比。另外从 `workouts:recent` 读已完成训练，放进 `workoutSeconds / workoutPercent / workouts[{activityType, seconds}]`。`activityType` 是上报的项目名（例如 Fencing），`seconds` 是该次训练摊到这个五分钟窗口里的活动秒数，不含时间戳。`workoutPercent` 达到 50 对上强度最高档，达到 75 对上连续性最高档；没有圆环样本但有训练覆盖的窗口也会打分。圆环桶不把这笔时长混进去。

`PULSE_ASSESSMENT_VERSION` 进输入哈希，改问题时升版本让全部窗口重评，不靠哈希碰巧变。
改判据先跑 `node --experimental-strip-types --import ./src/lib/testing/register-alias.mjs scripts/jev-probe.mts`（key 读根目录 `.env.local` 的 `TYPESAFE_API_KEY`）：十几个代表性窗口打真实 Jev，每条都写着期望档位，答案偏了先改措辞再上线——上线一次就是整整 24 小时重评。
相同输入哈希不重复调用；晚到 token 或活动报告改变窗口事实时只重评受影响窗口。
失败保留旧成功记录，下一轮重试，存储读失败不会清空历史。

`modules.vibeCodingNow.tokenUsage` 若出现，是最近 24 小时的五分钟用量桶：
`from/to/collectedAt`（epoch 毫秒）、`sources[{id,state}]`、`windows[{from,to,agents}]`。
每行 agent 有 `id/model/inputTokens/outputTokens/cacheReadTokens/cacheCreationTokens/
reasoningTokens/eventCount`；input 不含 cache read，reasoning 属于 output 子集，
eventCount 是去重用量事件数，不宣称上游 HTTP 请求数。sources 状态区分 ok、partial、
unavailable。当前 Mac 的「正在使用」改由 Claude Code hook 触发，不再附带这段扫描；
缺窗口按未知处理，不当成零。该数据只入内部存储，不进入公开补丁。

Coding 同时读取前台应用、Agent/模型、交集时长、切换次数、连续活动时长、观测覆盖。
不上传提示词、回复正文、项目路径或 session ID。token 是工作活动的证据，不是生产力。
同状态每分钟最多保存一次内部观测，变化立即记录；缺报三分钟后中断。
其他领域的实时原始状态最长保持十分钟，activity 区间沿用明确的 until。

评分和 Coding 观测在 StateHub 保留七天，新评分不写入旧 D1 原始状态归档。
发布时先更新 Worker/前端契约，再安装新采集器；初次没有评分历史显示 Awaiting scores。
预览：`pnpm dev:override /api/status/pulse pulse-busy-day.json`（明确标为模拟数据）。

## 最近在听

WebSocket 连接成功时检查一次。cron 每分钟检查，不看连接数：列表变动是 listening 评分的证据（`pulse:listening-plays`），只在有访客时刷会漏掉没人看站点时在 iPhone 上听的那些。上游频率由两分钟的 SQLite 闸门管，最多每两分钟拉一次 Apple。
SQLite `SET NX PX` 闸门与实例节流将真正的拉取限制为至少两分钟一次。
Mac 上报的 Apple Music 凭据保存在 SQLite，Worker 读取使用，不向外提供凭据端点。
状态读取不再触发拉取或广播。

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
以及 `LIVE_PUSH` 与 `STATE` 两个 Durable Object 绑定（迁移只追加新 tag，不改旧的）。`READ_MODEL_RENDERER` 是回绑同一 `api` 部署具名 entrypoint 的 Service Binding，不经公网，也不新增部署单元。
`READ_MODEL` KV 绑定见 [KV 公开读模型](../../docs/kv-read-model.md)；`HISTORY` 是 pulse 长期归档用的 D1 库 `lyjwpage-history`，
只增不删、无公开读路径，建表只在 `migrations/` 里，部署带这个绑定的版本**之前**先手动应用一次
（`pnpm --dir workers/api exec wrangler d1 migrations apply lyjwpage-history --remote`，Workers Builds 不跑迁移），
边界与回滚见 [Worker 数据后端与首屏缓存](../../docs/state-storage.md)。
状态和凭据只存于 Worker 的 StateHub，Vercel 不连接数据库。秘密通过以下命令配置：

```sh
pnpm --dir workers/api exec wrangler secret put GITHUB_TOKEN
pnpm --dir workers/api exec wrangler secret put TELEMETRY_INGEST_SECRET
pnpm --dir workers/api exec wrangler secret put APPLE_MUSIC_PRIVATE_KEY < AuthKey_XXXXXXXXXX.p8
pnpm --dir workers/api exec wrangler secret put TYPESAFE_API_KEY
```

Worker 不再调用阿里云 OpenAPI。旧的 `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`
Secrets 与专用 RAM 用户已无用，在 Cloudflare 控制台和阿里云 RAM 控制台删掉即可。

站点配置 `NEXT_PUBLIC_BACKEND_URL=https://api.homepage.lyjw.llc` 与相同的
`TELEMETRY_INGEST_SECRET`；浏览器由这一个源拼 `/ws` 和 `/api/musickit/token`。所有上报器的目标为
这个 Worker 的 `/api/ingest/<来源>`，不经过站点，调频同时读取此源 `/count` 的 `connections` 与 `ONLINE_COUNTER_URL/count` 的 `online`。实例清单见 [端点核验记录](../../docs/reporter-endpoints.md)。

提交并推送 main，由 Cloudflare Workers Builds 原生 Git 集成自动部署。
`shared/`、共用 `src/lib/`、根依赖及路径配置变化也触发 api 部署。

## 本地开发

```sh
cp .dev.vars.example .dev.vars      # 填 GITHUB_TOKEN；STATE_IMPORT_SECRET 本地随便填
pnpm dev:worker                     # 仓库根目录执行；http://localhost:8788
pnpm dev:worker:init                # 只需一次，初始化空的 StateHub
pnpm dev:local                      # 站点指向本地 Worker
```

本地用 `wrangler.test.toml`：生产配置里的 `deleted_classes` 迁移在空环境下起不来，测试配置有从头开始的迁移链，且没有生产域名和 cron。
状态持久化在 `.wrangler/dev-state`，重装或想清库就删它，再跑一次 init。

本地是空库。`.dev.vars` 里的 `UPSTREAM_API_URL` 让 `publicResponse` 生产为主、本地补缺：生产 `ok:true` 的快照字段和端点用生产的，
生产没有的（新加的端点、新字段）或生产也 `ok:false` 的才用本地的（只读、不上报）。生产的 wrangler.toml 不配它。
分支预览是同一套兜底的线上版：`wrangler preview` 在生产脚本 `api` 上按分支开一份隔离的 Preview，Vercel 预览改连它。见 [Workers 构建](../../docs/workers-builds.md)。
要测上报链路，把这个变量注释掉让本地只看自己，然后往 `http://localhost:8788/api/ingest/<来源>` 推，鉴权用 `.dev.vars` 里的 `TELEMETRY_INGEST_SECRET`。

配了 `UPSTREAM_API_URL` 后，本地的推送房间还会在有页面连着时自己去连生产的 `/ws`，把事件转发给本地页面（最后一个页面断开就跟着断，不多占生产那边的连接数），所以本地也能收到实时推送。事件对应的端点有生效的注入时，payload 换成注入的那份，假数据不会被生产一推就盖掉。

`DEV_OVERRIDES=true` 时另开 `PUT` / `DELETE /api/dev/override/<端点路径>` 和 `GET /api/dev/overrides`，往本地 SQLite 里注入某条端点的信封，
优先于上游和本地，`/api/home` 里对应字段一起生效；夹具放 `dev-fixtures/`，用根目录的 `pnpm dev:override` 推。`index.ts` 只在这个变量开着时放行非 GET。
夹具里的时间戳写成 `"$now"` / `"$now-90000"`（毫秒偏移），推送脚本在发出前换成当下 —— 注入绕过路由，没人替它续心跳，写死的 `pushedAt` 几分钟就会被判成过期。

## 验证

```sh
pnpm --dir workers/api typecheck
pnpm --dir workers/api test
node scripts/verify-api-worker.mjs --build
node scripts/verify-kv-read-model.mjs
```

集成脚本启动隔离 SQLite、Worker、KV 和缓存通知测试服务器，检查鉴权、404、初始化屏障、并发假数据索引、写入、缓存失效、真实 WebSocket、重启持久化，以及 StateHub alarm → 内部 renderer → StateHub 批量读取 → KV 的循环调用。`--build` 还会在已初始化的隔离 Worker 存活期间，把 `NEXT_PUBLIC_BACKEND_URL` 和在线人数源指向该本地地址并运行生产构建。退出时清理临时状态，不使用生产绑定或凭据。

SQLite 初始化、迁移与权限见 [后端架构](../../docs/state-storage.md)。

## Worker 更名

生产服务为 `api`，域名 `api.homepage.lyjw.llc`。`v1-transfer-from-ingest` 将旧 Worker 的三个 SQLite Durable Object 命名空间整体转移，保持 ID 与数据不变；后续部署保留这条迁移记录。不要对这些类另加创建或删除迁移。
## Workers 统计卡片

`GET /api/status/cloudflare-workers` 与 `/api/home` 的 `cloudflareWorkers` 字段共用一份统计。
只查询本仓库的 `api`、`online-counter`、`playstation-reporter`，不公开账号内其他 Worker。
API Worker 使用 `CLOUDFLARE_METRICS_TOKEN`（只读 Secret：账号分析、Workers 脚本与构建读取）和
`wrangler.toml` `[vars]` 里的 `CLOUDFLARE_ACCOUNT_ID`；令牌本地放在忽略提交的 `.dev.vars`，
生产发布前为 `api` 配置同名 Secret。Vercel 不需要令牌。

Cloudflare GraphQL `workersInvocationsAdaptive` 提供滚动 12 小时（窗口按 15 分钟对齐）的调用量、执行错误、
子请求和整段窗口 CPU P50；CPU 从微秒转为公开字段 `cpuTimeP50Ms`。只取汇总，不取分桶序列。
采样统计不是账单，也不将执行错误等同于 HTTP 错误或可用率。统计缓存十五分钟。
部署 API 只投影部署时间、正在分流的版本 ID 与比例，再用版本号批量查构建历史拿到流量最大版本的提交 SHA、分支和标题。改密钥、控制台上传生成的版本没有构建记录但代码与前一版相同，按版本列表往前找最近一个有构建记录的版本借用其提交（最多回看 8 个）；都没有才为空。不输出部署作者、邮箱或账号凭据，独立缓存十五分钟。

浏览器五分钟轮询，无推送。上游失败时最多保留一天的最后成功结果并保留原始时间；
没有统计时显示 `—`，部署时间与版本在服务名提示中查看。
首次部署先配置 API Worker 的只读凭据，再发布 Worker 和站点；构建监视路径已有 `src/lib/*` 与 `workers/api/*`。


## Vercel 卡片

`GET /api/status/vercel-deployments` 与 `/api/home` 的 `vercelDeployments` 字段共用数据。
API Worker 使用一个 `VERCEL_TOKEN` Secret，以及 `wrangler.toml` `[vars]` 里的 `VERCEL_PROJECT_ID`、`VERCEL_TEAM_ID`。
Token 只放本地 `.dev.vars` 或生产 Worker Secret，不配置到 Next.js。Vercel Token 不分读写权限，
对整个团队都能写，是这个 Worker 里权限最大的凭据：创建时选团队范围并设到期时间；代码只查询指定项目，
所有请求只读取数据。凭据到期后替换同名 Secret。

`GET /v9/projects/{id}` 的 `targets.production` 决定当前生产版本，随后读取该部署详情；
`GET /v6/deployments` 读取最近五次记录。新构建失败或回滚不会把最新创建的部署误当成线上版本。
部署缓存一分钟；上游失败最多沿用一天的成功结果，保留原始时间。

调用量与访问统计在 `metrics` 中按组独立缓存，浏览器沿用一分钟轮询；每组保留自己的采集时间与窗口。
上游失败只影响对应组，最多沿用一天的成功数据；从未成功则显示 `—`。
- `functions`：最近十二小时（窗口按 15 分钟对齐）、生产环境的函数调用、错误、超时、CPU P75 与平均峰值内存，缓存十五分钟。
  读取控制台 `/api/observability/metrics` 的整段 `summary`（`summaryOnly`，不取分桶序列）；错误与超时分开，CPU 不是每日或每桶 P75 的平均值。
- `analytics`：前七个完整 UTC 日的页面浏览与访客，使用官方 `/v1/query/web-analytics/visits/count`，
  保留接口返回的实际时间边界，不累加每日独立访客数。

函数统计目前使用控制台接口，平台可能调整，解析失败会显示上次数据或暂不可用。
仅公开上述聚合指标及部署 ID、状态、时间、生产/预览标记、提交 SHA、分支和标题；
不转发平台原始响应、查询元数据、访问者明细、邮箱、环境变量和日志。
首次发布先配置生产 API Worker 凭据，再发布 Worker 和站点。

首页将仓库、Vercel 和 Workers 合为一张站点卡片：顶部是七天浏览量与仓库总提交、增删行数和按提交数的贡献占比条；
中部左侧贡献者名单、右侧最近三条提交，提交与部署按 SHA 关联，当前线上版本标绿并给出构建时长；
下方左侧桌面 / 移动端性能评分，右侧 Vercel 与三个 Worker 的调用量、CPU 分位和当前部署的提交短哈希。

### 性能评分（PageSpeed Insights）

同一份载荷的 `pagespeed` 字段，数据来自 Google `runPagespeed`，与 Vercel 无关，所以不在 `metrics` 里。
每轮桌面与移动端各测一次，取 Lighthouse 性能分与 LCP、TBT、CLS、FCP、TTFB（`server-response-time`）。
测的是 `lyjw.me`（`src/lib/site.ts` 的 `site.url`），载荷里带着这个地址，卡片表头显示它。

这是**实验室数据**：一台模拟设备上跑出来的，不是访客的真实体验。PSI 同时会返回 CrUX 真实用户字段，
但这个站的流量不够进 CrUX 数据集，那两段是空的 —— 所以没有 INP（它只有真实用户才测得到），
表上那一列是同一轮测出的 TBT。

**卡片上每一格是滚动窗口内各轮实测的中位数，不是某一轮的完整报告。** Google 那边的跑测机偶尔会卡一下，
TBT 和总分能跳出明显偏低的一轮（实测见过桌面端 96 掉到 65）；窗口取最近 **6 小时**（按小时一轮约六个样本，
上限 12 条），逐格取中位数，一轮异常就被旁边几轮压住。代价是滞后：真的变慢了也要过半个窗口才在卡片上稳下来。

窗口按时间而不是条数定 —— Worker 停过一段时间之后，剩下的样本得是真的近期实测，不是几天前那几轮凑数；
窗口里只剩一轮时中位数就是那一轮。逐格算意味着某几轮测不出的指标只按测出来的那几轮算，一轮都没测出才是空。
载荷里带着 `samples`（参与的轮数）和 `start`（最早一轮的时间），卡片表头的提示显示它们。

一轮实测要二十多秒，读路径一步都不去跑上游：由 cron 每分钟进来一次、自己判该不该跑，
跑完并进窗口、重算中位数再写进缓存，`/api/status/vercel-deployments` 只读已经算好的那份。
缓存和样本历史各保留一天，连续失败超过一天才回到 `—`。没配 `PAGESPEED_API_KEY` 就整段跳过。

**一次 cron 只测一端**：先桌面、攒进 `:pending`，下一次 cron 补上移动端再合成一个样本，
所以一轮要跨两次 cron（配着五分钟的重试锁，大约五六分钟凑齐）。两端并行跑过，线上一次占 96 秒
（cron 日志里的 `wallTime`，跑完了、没被掐）—— 能跑通，但一次定时调用占着一分半实在长，
上游慢一点就没有余量。拆成两次之后每次三四十秒，`fetch` 超时 60 秒，卡住的那次会落进 catch
留下 `[pagespeed]` 日志。

两把闸门分开：`:done` 成功才写、占一小时，它决定节奏；`:attempt` 一进来就抢、只占五分钟，
它挡并发和紧接着的重试。`:pending` 则是「这一轮还没提交」的凭证，**必须赶在写 `:history` 之前消费掉** ——
Worker 侧 storage 写失败是冒泡的，先写 `:history` 再清 `:pending` 的话，中间抛了就会把 `:pending`
留成一张可重放的凭证：五分钟后拿同一份桌面端再配一次移动端，窗口里多出一个共用同一份 desktop
的样本（`mergePageSpeed` 只按 `at` 追加、不去重）。合成一把的话，上游一次偶发就把整个小时烧掉 —— `runPagespeed` 确实会偶发
500（`Lighthouse returned error`，连跑十轮撞见过两轮），一小时一次的节奏下那就是一小时的窗口空档。
密钥只走查询参数（接口只认这一种），错误信息只带状态码，不回显密钥或上游响应体。
请求用 `fields` 裁掉截图等字段，Worker 不必解那 800 KB 的整份响应。

## 最近训练

`POST /api/ingest/iphone` 的 v1 信封接受 `modules.workouts: { items: [...] }`，每次完整替换最近最多 10 条训练（空列表清空）。记录字段为 `id`（HealthKit UUID）、`activityType`（英文类型）、`startedAt` / `endedAt`（epoch 毫秒）、`secondsFromGMT`（训练当地 UTC 偏移秒）、`durationSeconds`（扣除暂停的活动秒数），以及可选的 `distanceMeters` / `activeEnergyKcal`、`averageHeartRateBpm` / `maximumHeartRateBpm`、`elevationAscendedMeters`、`indoor`（boolean）。缺失指标对外为 null，不能解释为零。

`GET /api/status/workouts` 返回 `{ items, pushedAt }` 的标准状态信封，同时包含在 `/api/home.workouts`。快照保存在 `workouts:recent`，不按训练日期过期；超过 7 天未同步时卡片标明同步延迟。上报失效 `workouts` 首页缓存标签，浏览器每 5 分钟轮询，不新增推送事件。共享代码路径已包含在 Worker 原生构建监视范围内。

本地预览：`pnpm dev:override /api/status/workouts workouts.json`，夹具仅供开发环境，启用时页面显示 Fake data。真实记录需要安装 iOS 27 上报器并允许训练读取。

`workouts.json` 是 2026-09-20 从真机读取的最近 10 次训练快照（6 次剑术、3 次骑行、1 次滑冰），保留原日期与观测指标，UUID 替换为演示标识。`pushedAt` 注入时更新，但训练时间不变。剑术不把步行距离当成主要成绩；滑冰没有距离就不显示速度；网页每项最多两个指标：有距离时显示时长与距离，否则显示时长与活动消耗；不展示心率或均速。

网页卡片最多显示最近 10 条，每页上下排列 2 条，横向吸附滚动（共 5 页），隐藏独立标题栏，通过触控板、触摸或键盘横向浏览；上报和存储仍保留最近 10 条。训练记录合并在 Activity 卡片右侧（窄屏放底部），圆环区域保持原高度；出口节点卡全宽排列在其下。

### Pulse 实测域

Watching / Gaming 返回 `{kind:"binary",segments:[{from,to,value}],activeSeconds}`，
上述两种实测形状均额外包含 `score`，与 Coding / Activity 的右侧摘要同形。
`value` 仅为 0 或 1：只有播放或游戏中为 1，暂停、停止和仅主机在线为 0。
Charging 返回 `{kind:"power",segments:[{from,to,value}],currentPowerW}`，value 单位为 W。
Watching / Gaming 的 segments 可带当时的 `title`，来自历史记录；切换影片或游戏时不合并段，停止时不沿用旧标题。
Listening 不在此列：它返回 `{kind:"score",assessments}`，与 Coding / Activity 同形。实测只看得见 Mac 和 HomePod，在别的设备上放一整天那条线也是平的，而那些设备唯一的痕迹（「最近在听」列表变动）只有评分那一侧收得到。每份 assessment 可带 `title`，取该窗口内占时最长且 level ≥ 2 的曲名，与实测段同一份 hint、同一个公开口径。
实测三域的曲线独立于 Jev，仍返回 score（评分、趋势、置信度）；前端每分钟刷新。
段来自实际观测：通常超过 10 分钟未确认留空，含零值；Gaming 按 30 分钟空闲轮询设置 35 分钟有效期。Watching 的明确停止（level 0）持续至下次播放事件，暂停／播放仍按 10 分钟失效。曲线与 Jev 输入共用这些有效期；当前功率过期为 null。
充电使用已有 Mac `totalPower`，未连接记录 0 W；功率变化最多每 30 秒取一点，
零／非零切换立即记录，保留 6000 点。旧档位记录缺少 powerW 时留空，不推算瓦数。
发布前应用 `0003_pulse_power.sql`，D1 将实测瓦数存入 power_w；其他域该列为 NULL。
