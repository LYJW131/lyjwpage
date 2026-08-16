# lyjwpage

个人主页。信息展示 + 实时状态：**最近在看**（Emby）、**最近在听**（Apple Music）、**充电头**（Anker Prime 160W）、**Vibe Coding**（Claude Code + Codex）。

## 技术栈

|      |                                                               |
| ---- | ------------------------------------------------------------- |
| 框架 | Next.js 16 App Router（Turbopack）                            |
| UI   | React 19 · Tailwind CSS v4（CSS-first，无 `tailwind.config`） |
| 动画 | `motion` · `@number-flow/react`（实时数字滚动）               |
| 数据 | Route Handlers 代理 + SWR 轮询 + 自建 Worker 推送             |
| 字体 | Geist Sans / Geist Mono（本地字体包，构建不依赖网络）         |

## 跑起来

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

填好 `.env.local` 后：

```bash
pnpm dev
```

开发服务器固定使用 `http://localhost:3211`，避开已占用的 3210。

## 部署在哪

同一个仓库三份部署，各有各的 Redis：

| 域名 | 平台 | 环境 | 说明 |
| --- | --- | --- | --- |
| `lyjw.me` | Vercel | 生产 | 主站 |
| `lyjw131.com` | EdgeOne | 生产 | 国内 CDN |
| `dev.lyjw.me` | Vercel | 预览 | 跟 `dev` 分支，开着 Vercel Authentication |

分不清哪个是哪个时看响应头：Vercel 是 `server: Vercel`，EdgeOne 是 `Server: edgeone-pages`。

### 两份生产之间靠传播上报对齐

上报器只跟其中一个源站说话，而两份生产各有各的 Redis、各有各的 live-push Worker、
各有各的 Next 缓存。所以**收到上报的那份除了自己落库，还会把同一个请求原样转给
对面**：对面进的是同一条路由、同一个 handler，于是它写自己的 Redis、推自己的 Worker、
刷自己的 tag —— 三件事都在它自己那边发生，没有谁远程指挥谁。

```text
上报器 ──▶ EdgeOne ──▶ 自己的 Redis / 自己的 Worker / 自己的 tag
              └─转发─▶ Vercel ──▶ 自己的 Redis / 自己的 Worker / 自己的 tag
```

两边各自填对面那个源（`INGEST_PEERS`），不在代码里写死谁转给谁。转发出去的请求带
`x-ingest-relay`，对端见到它就不再往下传 —— 两边互填对方，再传一次就成环了；三份
以上各自填齐其余几份，一跳照样到齐。实现在 `lib/ingest-relay.ts`，挂在
`lib/api.ts` 的 `ingestRoute` 上，所以新加一个 `/api/ingest/*` 自动就带传播。

从前传播的是「缓存失效」这一件事：一个 `/api/ingest/revalidate` 端点，收到上报的那份
把 tag 名单发给对面（`revalidateTag` 只打得到本进程）。那条路只管缓存，数据本身仍然
靠两边共用一个 Redis 才对得上 —— 于是国内那份的每一次读写都要跨一次海，而缓存还要
单独再传播一遍。改成传播上报之后，缓存失效变成对端处理这次上报的自然结果，那个端点
和它那套 tag 名单校验就一起删掉了。

代价说清楚：转发是尽力而为，对端挂了只记一行日志，不把这次上报打成 4xx（数据在本地
已经落库了，回 4xx 只会让上报器把同一份再写一遍）。所以对端会漏掉那一次变化 ——
两张列表的上报器每 10 分钟兜底整推一次，能自己追上；Mac 那几份要等下一次内容变化。
另外两边的 `receivedAt` 是各自收到的时刻，差几百毫秒，充电头曲线的采样点因此不完全
对齐，那是各存各的历史，不影响读数。

还有一类字段是**各部署各算**的，回执要并起来再回给上报器：Emby 的 `missingImages`
和 Mac 的 `desktopIconAvailable` 问的都是「你那边有没有这份图」，两边的 Redis 不是同一个，
答案可能不一样。上报器只跟一个源站说话，只要有一份说没有就得让它补传，否则那张图在
对端永远缺着（见 `mergeEmbyReceipt` / `mergeTelemetryReceipt`）。

实时推送、在线人数、动态封面各是一个独立的 Cloudflare Worker（都在 `workers/` 下）。
**live-push 一份生产一个** —— 上报传到对端之后对端也要推一次，两边填同一个 Worker
的话每个浏览器会收到两份一样的事件；在线人数和动态封面没有写入方，仍然共用一组。
**Worker 的地址一律走环境变量**，源码里不写死 —— 否则任何人 clone 这个仓库跑起来
都会去打这边的 Worker。

## 状态是怎么接的

所有凭据只存在于服务端，浏览器只看得到 `/api/status/*` 返回的规范化数据。这些路由共用 `src/lib/api.ts` 的信封：上游挂掉时返回 `{ ok: false, error }` 而不是 5xx，让某一路数据源离线不至于把整页 SWR 打成错误态。

八条状态 GET 的快照走 Next `'use cache'`（`lib/status-cache`），上报按 tag 失效，轮询命中时不再每次打 Redis。CDN 故意 `Cache-Control: no-store`：最终响应里有存活、`?since=` 切片、`expiresInMs` 这类现算字段，不能冻在边缘。函数每次进；心跳那种不触发 tag 的戳记在 overlay 里现读一把小 key。充电头和 vibe coding 的游标也是缓存命中后在内存里切全量，不按 `since` 分键。

Redis TCP 连接按请求作用域租用：同一 Node 实例里的并发请求共用一条，最后一个请求和命令结束后主动断开。不能让 ioredis 永久单例留在 serverless 实例里——实例暂停时普通 idle timer 不会跑，旧部署和 Preview 会各留一条空闲连接。Preview 必须不配 Redis 或使用独立 `REDIS_URL`；`REDIS_PREFIX` 只隔离键，不隔离连接额度。

各路数据全是**推进来**的，本站不主动轮询任何上游。推送入口共用 `/api/ingest/*` 和同一个 `TELEMETRY_INGEST_SECRET`，状态落在 `lib/redis.ts` 的 mirrorKey 里（Redis 为主、进程内存为辅，没配 `REDIS_URL` 也能跑）。四个上报侧：Mac Telemetry Hub、Home Assistant（HomePod）、Emby 推送代理、Apple Music 上报器。上报器只跟一个源站说话，收到的那份会把请求原样转给对端部署，见[上面那节](#两份生产之间靠传播上报对齐)。

站点仍会出网的只剩一处：给此刻在播的曲子查一个可跳转的地址，走 `src/lib/cache.ts`（带 TTL、in-flight 去重和 5 秒负缓存）。**核心原则：前端轮询多快，回源频率都不变**，由各自的 TTL 决定。值存 Redis（进程重启和多实例共享）；in-flight 去重始终在进程内，它挡的是同一进程的并发穿透，Redis 代劳不了。

### 推给浏览器 — 自建 Worker

状态落库之后，`lib/live-events.ts` 往 `workers/live-push` POST 一条事件；浏览器直连那个 Worker 收推送（`hooks/use-live-events.ts` 把收到的写进 SWR 缓存，卡片照旧用 `useStatus` 读，不用管数据是推来的还是轮询来的）。**本站不持有任何长连接** —— 从前这里是一条自建的 SSE，但在 serverless 上每条 SSE 连接都钉死一个函数调用、到 maxDuration 被掐断再重连，全程计费。

长连接挂在 Cloudflare 的 Durable Object 上，一个全站房间：

| 方法 | 路径       | 谁在用                                                    |
| ---- | ---------- | --------------------------------------------------------- |
| GET  | `/ws`      | 浏览器。按 `ALLOWED_ORIGINS` 校验来源，支持后缀通配        |
| POST | `/publish` | 站点。`Authorization: Bearer <LIVE_PUSH_SECRET>`          |

站点这侧只配一个 `NEXT_PUBLIC_LIVE_PUSH_URL`（Worker 的源）加一个 `LIVE_PUSH_SECRET`，两条路径写在代码里 —— 它们和事件名一样，本来就是站点和自己那个 Worker 之间的约定。

这里从前走 Pusher 协议（云 Pusher，或自部署 [Sockudo](https://github.com/sockudo/sockudo)）。换掉的理由不是它不好用，而是这条链路上唯一还托在别人手里的一环：单条事件 10 KB 的上限就近在眼前（两张列表 4.4 KB / 2.8 KB），免费额度按连接数和消息数计，而在线人数那条已经在自己的 Worker 上跑着了（`workers/online-counter`）。两个 Worker 分开部署：那个只数人头，谁连上谁断开就是全部输入；这个要接站点的写入、要鉴权、要转发任意负载。

连接走休眠版的 `ctx.acceptWebSocket()`，心跳用 `setWebSocketAutoResponse` 由运行时直接回 —— 这些连接绝大多数时间空转（上报器几十秒才来一条），实例可以被回收、连接照样挂着。

推送上只跑「状态翻面」：换前台应用、换曲子、插拔充电头、上报器上下线、两张列表变了。滚动读数（功率曲线、token 用量）仍由卡片自己 30 秒一轮地取 —— 推它们等于把推送当轮询用。丢一条也不至于卡住页面，轮询是兜底。

事件名和 `/api/status/*` 的路径一一对应：**`X` 是列表，`X-now` 是此刻**。带不带数据分两类：

| 事件 | 形状 |
| --- | --- |
| `desktop` · `listening-now` · `watching-now` · `charger` · `listening` · `watching` | 带数据，浏览器直接写进 SWR 缓存 |
| `presence` | 只发失效通知（payload 为 `null`），浏览器自己回来取 |

**一律带数据。** 两张列表曾经只发失效通知，理由是「整份太大」——实测 4.4 KB 和 2.8 KB，而发通知之后浏览器照样把整份取回来，字节一点没省，反倒多出一次请求头、一次往返、一个函数调用和一次 Redis 读，**而且是按在线人头乘的**。（那时的天花板是 Pusher 单条 10 KB，只有两倍余量；现在是 Cloudflare 单条 WebSocket 消息 1 MiB。）

只有 `presence` 仍是失效通知：它翻的是「上报器还在不在」。亲口离线是布尔值，浏览器要重取 `declaredOffline`；超时那条拿 payload 里的 `lastSeenAt` 和 `heartbeatWindowMs` 自己就能翻，源站不再算 `stale`。窗口默认 5 分钟（约三倍心跳），可用 `HEARTBEAT_WINDOW_MS` 改。

充电头那条带状态但**不带历史点**，是另一回事：曲线是增量同步的，服务端不知道各客户端的游标，只能要么整份重发要么发空增量。列表是整份替换，没有游标这回事。

两张列表的轮询兜底因此放到了 5 分钟一轮 —— 即时性由推送负责，轮询只兜「推送整体停用」这一种情况。

### 最近在看 — Emby

**本站不向 Emby 发任何请求。** 站点将来要部署到 Vercel，那时它够不着局域网里的 Emby（`http://emby.local:8096`），所以续播列表、播放位置和海报全部由 NAS 上的推送代理送进来：

```text
POST /api/ingest/emby
Authorization: Bearer <TELEMETRY_INGEST_SECRET>
```

代理的代码、配置和部署方式在 `reporters/emby-reporter/`。请求体的三部分都可省略、各推各的：`resume`（续播列表，60 秒一轮、有变化才推）、`playing`（播放位置，缺席表示这次不谈、显式 `null` 表示确认没人在看了）、`images`（`{ imageKey, objectKey }`，代理直传 R2 之后回报的对象键，只带站点还没有的那些）。

**Emby 的播放通知也先发给代理，再由它转发过来。** Emby 后台那个 webhook 配置项加不了自定义请求头，直发站点就只能开一个不鉴权的入口 —— 这个路径从前就是那样直收 webhook 的，那条路已经删了，现在站点只剩 `TELEMETRY_INGEST_SECRET` 一种鉴权方式。Emby 侧该怎么填见代理的 README。

推送只在开始/暂停/继续/停止、以及代理发现**拖了进度条**时才来，中间没有消息。但每条都带着当时的播放位置和总时长，所以未暂停时按真实时间往前推算即可 —— 进度条不轮询也能走。这同时兼作兜底：推算位置超过总时长说明播完了而「停止」没收到（客户端崩了、网络断了），此时按已结束处理，不会一直挂着。

Emby 对拖动进度条不发任何通知，那部分只能查会话。查的人是代理不是站点：它在播时每 2 秒问一次 `/Sessions`，但只在位置偏离站点的推算值超过 1.5 秒时才推 —— 站点算得准的时候推它等于白花一次函数调用。

状态存在 Redis（`lib/emby-store.ts` 的 mirrorKey，Redis 为主、进程内存为辅），站点不再向 Emby 拉任何东西。读路径上 `/api/status/watching` 和 `/api/status/watching/now` 走 `'use cache'`，和别的状态接口同一套。前端契约没变，两条仍是分开的：前者跟着 60 秒的推送走，后者跟着播放事件走，合在一起的话慢的那半只能跟着快的那半一起被重取。

剧集自身的 `Primary` 图是剧照而不是海报，所以竖版海报优先取所属剧的 `SeriesPrimaryImageTag`。这个选择在代理那侧做 —— 字节是它下载的，挑哪张的逻辑跟着走才不会分家。

#### 图片

海报由 Emby 上报器一次压成 WebP，以 `<sha256>.webp` 直传 R2；站点只接收对象键，响应时再用当前部署的 `R2_PUBLIC_BASE_URL` 拼公开地址。所以同一次上报传播到两份部署之后，Vercel 可以直连 R2，EdgeOne 可以改走以 R2 为源站的 COS CDN。上报器传之前先 HEAD 问一次桶里有没有，所以桶被清空、换机器、重启都能自己发现要补传，不必等站点回执。地址即内容指纹，所以对象带 `max-age=31536000, immutable`，浏览器直连交付域取图，站点没有图片读写或转码路径。

- **条目里存的是「图片键」而不是地址**（`imageKey`，由代理按 `itemId:kind:tag:height` 拼，图换了 ImageTag 键就换），读取时才换成地址。图片和列表是分两次推来的：列表先到、图片可能还在路上，或者 Redis 被清空后只需补图。晚到的那批图能把已经存着的列表一起点亮，不用整份重推。
- **响应里回 `missingImages`**：站点引用了却没有的键。代理据此补传，Redis 清空、容器换机器之后不需要人工干预。
- **上报器直传图片**：Emby 海报在代理侧用 sharp 压成 `<sha256>.webp`、Mac 图标用系统原生编码器压成 `<sha256>.png`，都由上报器直传 R2。站点只 HEAD 校验并保存对象键，公开 URL 在读取时按部署环境组装；Redis 里不存完整 URL 或任何图片二进制。HEAD 结果只缓存 5 分钟——桶被清空后站点要能重新发现对象没了，否则会一直发指向已删对象的 URL。

> 卡片的「在 Emby 里打开」跳转链接指向 `EMBY_PUBLIC_URL`，源站地址会出现在页面 HTML 里 —— 这是有意为之，不用改：Emby 前面有认证网关，跳过去的人会撞到认证。没配这个变量就不给链接，没有内网地址可退，退了也是个点不开的链接。

Apple Music 的封面没有代理，仍走 `mzstatic.com` 直链 —— 那本来就是公开 CDN，套一层反而多一跳。

### 最近在听 — Apple Music

列表由 [reporters/apple-music-reporter](reporters/apple-music-reporter) 推来，站点这侧命中数据缓存就不打 Redis，不再向 Apple 拉列表。它自己也不签凭据：`GET /api/ingest/apple-music` 取一份 Mac 推上来的 token，`POST` 同一个地址交算好的列表——同一把锁，同一个门。

**为什么要一个常驻进程。** 省下站点那十几趟 Redis 只是顺带；真正的原因是「此刻在不在听」这个推断需要**连续观测**。Apple 没有可查的当前播放接口，只能看最近播放列表里排第一的那项什么时候变成第一的——这个状态从前存在站点的进程内存里，serverless 上每个实例各有一份、活不到下一次切换，等于永远推断不出来。搬到上报器之后它按固定节奏一直看着，重启才会重新进入「冷启动不算在听」那一档。

需要 **Developer Token** 和 **Music-User-Token** 两条凭据，**全部由 Mac 上报器推来**：Mac Telemetry Hub 用本机 MusicKit 现签一对，作为 `appleMusicCredentials` 模块随 `/api/ingest/mac` 的信封送上来。`.p8` 私钥留在那台机器的钥匙串里由系统保管，服务器上一份都没有，本站也不含任何 JWT 签名代码。

MusicKit 签出来的 developer token 实测寿命 **30 天**，上报器从它自己的 JWT 解出 `exp`，过了「上报时刻 → 到期时刻」的中点（即 15 天）就重签重发。取相对中点而不是写死提前量，是因为 Apple 没承诺这个寿命，写死在两个方向上都可能错。实践中上报器重启比 15 天频繁得多，所以多数情况是每次启动重传一份新的。

凭据存 Redis，和 `telemetryState` 严格分开 —— 后者会经 `/api/status/*` 发到浏览器。那个 ingest 路由也不打印请求体。

**没有服务端自签的回落。** 有回落就意味着私钥仍得躺在服务器上，这套东西就白做了。代价是上报器长期离线且 Redis 也丢了凭据时「最近在听」直接失败，这是明摆着的取舍。

上报器拉 `/v1/me/recent/played?limit=10`，60 秒一轮。注意这个端点返回的是**专辑、歌单、电台这类容器**，不是单曲：专辑给 `artistName`、歌单给 `curatorName`，没有 `durationInMillis`，`limit` 上限是 10。时长要顺着容器的 `href` 再查一次曲目加起来，封面对自建歌单还要去资料库副本取——这些查询的缓存全在上报器进程里，站点的 Redis 不再存它们。

只在内容真的变了时才推给站点，另外每 10 分钟兜底整推一次（防 Redis 被清空）。站点收到后也自己比对一遍，变了才往浏览器发失效通知——所以兜底那次不会变成定时广播。

**站点这侧唯一还会打 Apple 的地方**是「此刻在播的那首曲子」的跳转链接：Music.app 和 HomePod 都给不出可分享的链接，只能拿曲名 + 艺人现查目录，而这件事跟着当前播放走，交不给按固定节奏轮询的上报器。命中缓存 7 天，绝大多数请求不会真的出网。要连它也搬走，该搬去 Mac 上报器——那边有 MusicKit，换歌那一刻就能把链接一起算好。

### 充电头 — Anker Prime 160W

数据来自 a2687-telemetry，它通过 BLE 读充电器、以 HTTP 暴露快照。`GET /status` 一次拿到整机功率 + 三个 USB-C 口的电压/电流/功率/协议/线缆/设备识别。

**本站不轮询充电头，只接收统一遥测推送。** Mac Telemetry Hub 从本机 a2687 服务读取 `/status`，把精简后的状态放进 v4 envelope，只 POST 到 `/api/ingest/mac`，并使用 `TELEMETRY_INGEST_SECRET` Bearer 鉴权。旧的 `/api/ingest/charger`、`/api/ingest/telemetry` 和 `/api/ingest/presence` 入口都已经删除，没有兼容路径，也没有本地轮询回退。

**总功率历史存在服务端**（`lib/charger-store.ts`，Redis；未配置 Redis 时退回进程内存）。客户端自己累积的话页面一刷新曲线就没了、还要攒很久才有形状。环形缓冲保留 400 点，两点之间至少间隔 `MIN_SAMPLE_GAP_MS`（当前 5 秒），足以覆盖固定 20 分钟图表窗口。

曲线的横坐标**按时间戳映射**而不是按序号等距铺开 —— 漏推一次就会有空档，等距会把那段画得和正常间隔一样宽。

超过 3 倍推送间隔（且至少 90 秒、也至少一个心跳窗口）没收到新数据就标记为断流，此时不再声称充电器在线，否则页面会一直显示旧的瓦数。「也至少一个心跳窗口」是必须的：安静时段没有新读数可发，续这条时间戳的就是那封纯心跳，窗口短于心跳间隔的话卡片会周期性闪回「未连接」。

几个上游的脾气：

- `connected`（BLE 链路）和 `mode`（某个口是否在输出）是两层状态，UI 要分开处理
- 上游把 `"N/A"` 当占位符大量返回，必须过滤，否则界面上会出现一堆 N/A
- `ports` 的 key 顺序不保证，必须按 key 取
- 设备名靠 (VID, PID) 查表，表是逐条实机观察积累的。查不到时显示 `Unknown`（口空着才显示 `—`）
- **没有温度字段，上游也不给历史** —— 曲线是本站自己攒的

### Vibe Coding — CodexBar

Mac Telemetry Hub 通过 CodexBar CLI 的一条 `cost --provider both` 命令聚合本机
Claude Code / Codex 日志，再通过 `usage` 读取两者套餐和限额，以及 Cursor、
OpenCode Go、Antigravity 的总限额用量；另以 ccusage 的两条离线 `session` 命令读取最近活动时间与模型，
只用来判断“正在使用”。网站只接受上报器生成的展示摘要，不在服务端运行采集命令。
会话状态每 60 秒扫描一次；CodexBar 的 Token、费用和限额每 10 分钟刷新一次。

卡片顶部汇总全量 token、API 等值费用和活跃天数，并按 input、output、cache read、
cache write、reasoning 展示占比；下方展示每个 provider 的今日 token、30 日累计、
缓存命中率、历史主力模型、套餐和上游实际返回的限额。Cursor、OpenCode Go 和
Antigravity 只显示一条总限额进度，不显示 Token、费用和模型明细。最近活动时刻由
ccusage 的离线 session 摘要提供，用于真实的“正在使用”状态。CodexBar 的
`auto` 模式会为 Claude 选择 Web、为 Codex 选择 OAuth，后者包含真实的 Spark 周限额；
Codex 没有 5 小时桶时，页面按产品档位显示 `Unlimited`。

趋势图是最近 60 天的日级聚合。费用来自 CodexBar 的公开 API 等值估算，只表示这些
token 如果走 API 的价格，不是 Claude/Codex 订阅账单。上报摘要不含提示词、回复、
session ID、项目名或文件路径。

### 本机实时活动 — Mac Telemetry Hub

`a2687-telemetry/A2687TelemetryMac` 已从单一充电头工具扩展为可插拔的本机遥测中心。充电头、前台应用、本机 Apple Music、Mac 时区和 CodexBar 都能独立开启或关闭。Apple Music 通过 macOS Apple Events 读取 Music.app 的本机播放状态，与上面的 Apple Music API“最近在听”完全独立。

所有采集器统一写入：

```text
POST /api/ingest/mac
```

请求采用唯一的 `version: 4` envelope，顶层带 `heartbeatAt`、`presence`（`online` / `offline`）和 `activeModules`；模块名固定为 `charger`、`desktop`、`appleMusic`、`timezone` 和 `vibeCoding`，`modules` 只携带发生变化的模块。前台应用图标始终带 SHA-256，二进制只在该哈希尚未被服务端保存时上传。

五个模块的指纹一个都没变时，发的是**空 `modules` 的信封**，也就是一次纯心跳：只刷新存活，不动任何模块的时间戳。心跳无变化时每 ≥30 秒一条，有数据要发时不补——那个包本身就证明上报器活着。这个间隔正在往 90 秒放宽（纯心跳是 `/api/ingest/mac` 的主要流量）：**站点这侧先把存活窗口放宽到 5 分钟，上报器再降频**，顺序反了会有一段时间全站断续显示离线。

从前心跳和优雅下线走独立的 `/api/ingest/presence`，于是「上报器还活着」这一件事在服务端有两个写入点。现在只有这一条路：`presence: "offline"` 覆盖退出、睡眠这类优雅离开，崩溃、断网、强制关机时上报器什么都发不出来，那些仍靠「多久没收到」的超时兜底（默认 5 分钟，约三倍心跳，可用 `HEARTBEAT_WINDOW_MS` 改），两者互补。窗口盖在 presence 的 `heartbeatWindowMs` 上，浏览器用这一份。存活本身单独存一个 Redis key（`lib/reporter-liveness`），不再搭遥测状态那份镜像的车——那样多实例部署时，没接过上报的实例手上永远是零，会把卡片全判成离线。

各模块的指纹粒度决定了「无变化」有多容易达成：`charger` 含功率/电压/电流，充电中几乎每轮都变；`desktop` 是应用名 + bundleID + 图标，不切应用就不变；`appleMusic` 的进度**不入签名**，所以播放中也不变，只有 seek 偏离锚点超过容差才算；`timezone` 只有 IANA 标识、当前 UTC 偏移或缩写变化时才重发；`vibeCoding` 看 CodexBar 的刷新时间戳。真正的零 telemetry 场景是充电头没接、不切前台应用、音乐不换曲不 seek、时区不变、CodexBar 未刷新——此时只有每 30 秒一条空 `modules` 的心跳。

前台应用图标由 Mac 一次缩放成 96px PNG（系统原生编码，不依赖任何外部二进制）并直传 R2，网站只接收对象键 `<sha256>.png`、HEAD 确认后组出公开直链。**没有服务端接收图片二进制的回退**：`iconData` 一旦出现在信封里就直接报错。`iconHash` 标识「哪个应用的图标」（应用有图标就非空，编码或上传失败也照样有），对象键标识「哪份字节」，两者分开才能让站点回执区分「这个应用没图标」和「图标还没准备好」——从前它们是同一个哈希，编码一失败就静默丢图、永不重试。状态里只存公开直链，普通状态心跳不会重复携带图片。时区模块只上传 IANA 标识、当前偏移和缩写，不上传地址。时区只进首屏，没有 status 端点。公开读取按用途拆为七条：`/api/status/desktop`、`/api/status/charger`、`/api/status/listening`、`/api/status/listening/now`、`/api/status/watching`、`/api/status/watching/now`、`/api/status/vibecoding`。

### HomePod mini 播放实况

Home Assistant 在 HomePod 换歌、切换 `playing / paused / idle / off`、进度跳变
（`media_position_updated_at`）或切换循环模式时，把媒体状态推到：

```text
POST /api/ingest/homepod
Authorization: Bearer <TELEMETRY_INGEST_SECRET>
```

进度跳变那条触发器不能少：单曲循环时曲名和播放状态都不变，只有进度归零，
少了它服务端就不知道这首又从头开始了。

接收端复用统一遥测密钥，状态写入 Redis（未配置时退回进程内存）。`/api/status/listening/now`
按「MacBook 在播 → MacBook 暂停未满 10 秒 → HomePod 在播 → HomePod 暂停未满 10 秒」
选来源。两个候选冻在源站数据缓存里，选择和 `expiresInMs` 每次请求现算，所以暂停
宽限期到点再问能换到下一首，而不用等 Redis。事件带有进度观测时间，前端据此自己
推算进度。

这个宽限期是全站唯一一条「不靠新上报、光靠时间流逝就会改变结果」的规则，而那个
到期时刻不对应任何一次上报，没有推送会到。**服务端不为它挂定时器** —— 那要求进程
在响应发出之后还活着，serverless 上响应一返回实例就冻结，定时器根本不执行。改成
payload 带一个 `expiresInMs`，由浏览器把下一次取数排在到期那一刻。差值由服务端用
自己的时钟算：`observedAt` 是**设备**的时钟，让浏览器再拿**自己**的时钟去减，偏差
超过宽限期时浏览器会认定「早过期了」而服务端认为没有，退化成热轮询。

请求体的字段名和单位**和 Mac 上报器的 `appleMusic` 模块一致** —— 两个入口产出的
是同一个 `LocalNowPlaying`，同一个概念不该有两套叫法。所以毫秒就是毫秒、时间戳
就是 epoch 毫秒，HA 那边在模板里转好再发：

| 字段 | 类型 | 来源 |
| --- | --- | --- |
| `state` | `playing` / `buffering` / `paused` / 其它 | 实体状态，`buffering` 按播放中处理 |
| `title` / `artist` / `album` | 字符串 | `media_title` / `media_artist` / `media_album_name` |
| `entityId` | 字符串 | 实体 ID，和曲目信息一起哈希出 HomePod 侧的曲目身份 |
| `artworkUrl` | 字符串 | `entity_picture` |
| `positionMs` | 毫秒 | `media_position × 1000` |
| `durationMs` | 毫秒 | `media_duration × 1000` |
| `repeatOne` | 布尔 | `repeat == 'one'` |
| `observedAt` | epoch 毫秒 | `media_position_updated_at`，模板里 `as_timestamp() × 1000` |

判定“这条记录还算不算数”看的是**距上次收到推送多久**，不是推算进度有没有超过曲目
时长 —— Home Assistant 按状态变化推送，曲目放完到下一条推送之间必然超时，拿它当
作废依据会让播放中的曲目凭空消失。

推送的是**两台 HA**，实体和目标地址各不相同，但契约完全一样：家里那台在 home-ha-host
上（`media_player.homepod_home`），宿舍那台在 dorm-ha-host 上（`media_player.homepod_dorm`）。
两处不会同时在线，指向同一个站点端点，互不冲突。

`rest_command.push_homepod_now_playing` 的形状（`<E>` 换成对应实体）：

```yaml
url: "https://lyjw131.com/api/ingest/homepod"
method: post
content_type: "application/json"
headers:
  authorization: !secret telemetry_ingest_authorization
payload: >-
  {{
    {
      "entityId": "<E>",
      "state": states("<E>"),
      "title": state_attr("<E>", "media_title"),
      "artist": state_attr("<E>", "media_artist"),
      "album": state_attr("<E>", "media_album_name"),
      "artworkUrl": state_attr("<E>", "entity_picture"),
      "positionMs": ((state_attr("<E>", "media_position") | float(0)) * 1000) | round | int,
      "durationMs": ((state_attr("<E>", "media_duration") | float(0)) * 1000) | round | int,
      "repeatOne": state_attr("<E>", "repeat") == "one",
      "observedAt": (as_timestamp(state_attr("<E>", "media_position_updated_at"), as_timestamp(now())) * 1000) | round | int
    } | to_json
  }}
```

**先拼 Jinja 字典再整个 `| to_json`，别手写引号。** 手写 `"{{ ... }}"` 的话，曲名里
只要有一个 `"` 就拼出非法 JSON、整条推送 400；属性缺失还会渲染成字符串 `None`
而不是 `null`。`to_json` 两件事一起解决。

`observedAt` 的兜底值取 `now()` 而不是 `0`：HomePod 刚上线时
`media_position_updated_at` 可能还没有，落成 `0` 会被站点当成 1970 年的锚点，
进度条直接推算飞掉。

`secrets.yaml` 只保存完整 header 值，不把密钥写进配置或仓库：

```yaml
telemetry_ingest_authorization: "Bearer <TELEMETRY_INGEST_SECRET>"
```

`artworkUrl` 收的是 Home Assistant 的 `entity_picture`，那是一个带 `cache` 参数的代理地址。
接收端只提取其中公开的 Apple CDN URL，并把 `{w}`、`{h}`、`{f}` 占位符替换成
`600`、`600`、`jpg` 后交给前端；Home Assistant 的局域网地址和代理 token 不会公开。

## 改内容

文案、社交链接、项目、时间线全在 `src/lib/site.ts`，组件里不写死内容。标了 `占位` 的是示例文案。

## 设计约定

- 层次靠 1px 线条和表面色阶，不靠阴影；磨砂只用在吸顶导航
- 分隔线用 `screen-line-top/bottom`：内容居中，线横贯整个视口
- **整站只有实时状态区允许出现彩色**，其余全是灰阶 —— 眼睛会自动被实时数据吸走
- 全站 `tabular-nums slashed-zero`，实时数字跳动时不抖宽度
