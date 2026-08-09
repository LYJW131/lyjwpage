# lyjwpage

个人主页。信息展示 + 实时状态：**最近在看**（Emby）、**最近在听**（Apple Music）、**充电头**（Anker Prime 160W）、**Vibe Coding**（Claude Code + Codex）。

## 技术栈

|      |                                                               |
| ---- | ------------------------------------------------------------- |
| 框架 | Next.js 16 App Router（Turbopack）                            |
| UI   | React 19 · Tailwind CSS v4（CSS-first，无 `tailwind.config`） |
| 动画 | `motion` · `@number-flow/react`（实时数字滚动）               |
| 数据 | Route Handlers 代理 + SWR 轮询                                |
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

## 状态是怎么接的

所有凭据只存在于服务端，浏览器只看得到 `/api/status/*` 返回的规范化数据。三个路由共用 `src/lib/api.ts` 的信封：上游挂掉时返回 `{ ok: false, error }` 而不是 5xx，让某一路数据源离线不至于把整页 SWR 打成错误态。

`src/lib/cache.ts` 是共用缓存，带 TTL、in-flight 去重和 5 秒负缓存。**核心原则：前端轮询多快，回源频率都不变**，由各自的 TTL 决定。值存 Redis（进程重启和多实例共享），没配 `REDIS_URL` 就整体退回进程内存；in-flight 去重始终在进程内，它挡的是同一进程的并发穿透，Redis 代劳不了。

### 最近在看 — Emby

`GET {EMBY_URL}/emby/Users/{userId}/Items/Resume` 拿续播列表（缓存 60 秒）。

**「播放中」不轮询，靠 Emby 的 webhook 推过来。** 在 Emby 后台「通知 → Webhooks」里指向 `/api/ingest/emby`，勾上播放相关事件即可。收到播放事件时顺便让续播列表缓存失效，列表顺序和进度立刻跟上。

webhook 只在开始/暂停/继续/停止各来一条，中间没有消息。但事件里带着**当时的播放位置和总时长**，所以未暂停时按真实时间往前推算即可 —— 进度条不轮询也能走。这同时兼作兜底：推算位置超过总时长说明播完了而「停止」事件没收到（客户端崩了、网络断了），此时按已结束处理，不会一直挂着。

各版本的事件名写法不一致（`playback.start` / `PlaybackStart` / …），接收端统一压成小写去掉分隔符再按子串判断，不和具体写法绑死；`unpause` 里也含 `pause`，必须先判 `unpause`。

剧集自身的 `Primary` 图是剧照而不是海报，所以竖版海报优先取所属剧的 `SeriesPrimaryImageTag`。

#### 图片代理

前端拿到的不是 Emby 直链，而是本站的 `/api/image/emby/<token>`。这样源站不外泄，页面套上 CDN 后图片能跟着一起被缓存（Emby 自己没套 CDN）。

- **token 是加密的，不是签名的**。参数若明文放在 URL 里（`?id=…&kind=…&tag=…`），任何人都能照着拼出 Emby 直链，代理就白做了 —— 签名只挡得住枚举，挡不住照抄。所以把 `id|kind|tag|height` 用 AES-256-GCM 整体加密成一个不透明 token。GCM 的 auth tag 同时承担完整性校验，不需要另附签名，改一个字节就解不开。密钥由 `IMAGE_PROXY_SECRET`（没配则 `EMBY_API_KEY`）派生，加密和派生 IV 用两把不同的子密钥。
- **必须是确定性加密**：IV 由明文 HMAC 推导而不是随机生成。随机 IV 会让同一张图每次渲染得到不同 URL，CDN 和浏览器缓存全部失效 —— 而缓存正是做这个代理的目的。GCM 的 nonce 复用之所以危险是「同一 nonce 加密不同明文」，这里 nonce 由明文推导，构造上排除了这种情况。
- **不设过期**：token 里带着 Emby 的 image tag，图片换了 tag 就换，所以这个地址天然不可变，可以 `max-age=31536000, immutable`。加过期时间反而会打断 CDN 缓存。
- **统一图片存储**（`lib/image-store.ts`）：Emby 回源图和遥测上传图统一走 `/api/image/<source>/<key>`，共用进程内 LRU、Redis、ETag 和 in-flight 去重。Emby 图缓存 10 分钟后可以重新回源；遥测原图无法回源，额外持久化到 `IMAGE_STORE_DIR`（默认是系统临时目录下的 `lyjwpage-images-v1`），Redis 保留 30 天。
  - 二进制缓存统一限制为 **64 条 / 单张 5MB / 总量 32MB，LRU 淘汰**，避免 image tag 和本机活动变化导致进程内存无限增长。

> 卡片的「在 Emby 里打开」跳转链接仍然指向 `EMBY_PUBLIC_URL`，源站地址会出现在页面 HTML 里 —— 这是有意为之，不用改：Emby 前面有认证网关，跳过去的人会撞到认证。
>
> **只有图片端点是不需要认证的**，这也正是它必须走代理的原因：它是唯一一处不套代理就会被匿名直取的资源。

Apple Music 的封面没有代理，仍走 `mzstatic.com` 直链 —— 那本来就是公开 CDN，套一层反而多一跳。

### 最近在听 — Apple Music

需要 **Developer Token** 和 **Music-User-Token** 两条凭据，**全部由 Mac 上报器推来**：Mac Telemetry Hub 用本机 MusicKit 现签一对，POST 到 `/api/ingest/apple-music/credentials`。`.p8` 私钥留在那台机器的钥匙串里由系统保管，服务器上一份都没有，本站也不含任何 JWT 签名代码。

MusicKit 签出来的 developer token 实测寿命 **30 天**，上报器从它自己的 JWT 解出 `exp`，过了「上报时刻 → 到期时刻」的中点（即 15 天）就重签重发。取相对中点而不是写死提前量，是因为 Apple 没承诺这个寿命，写死在两个方向上都可能错。实践中上报器重启比 15 天频繁得多，所以多数情况是每次启动重传一份新的。

凭据存 Redis，和 `telemetryState` 严格分开 —— 后者会经 `/api/status/*` 发到浏览器。那个 ingest 路由也不打印请求体。

**没有服务端自签的回落。** 有回落就意味着私钥仍得躺在服务器上，这套东西就白做了。代价是上报器长期离线且 Redis 也丢了凭据时「最近在听」直接失败，这是明摆着的取舍。

拉 `/v1/me/recent/played?limit=10`。注意这个端点返回的是**专辑、歌单、电台这类容器**，不是单曲：专辑给 `artistName`、歌单给 `curatorName`，没有 `durationInMillis`，`limit` 上限是 10。列表缓存 30 秒。

「播放中」是推断出来的，Apple 没有服务端可查的当前播放接口，也不返回播放时间戳：观测排第一的容器何时「变成第一」，再顺着它的 `href` 查一次曲目把时长加起来（缓存 24 小时），在总时长内就认为还在听。冷启动时看到的第一项无从分辨是刚开始还是早就播完，一律不算在听。

### 充电头 — Anker Prime 160W

数据来自 a2687-telemetry，它通过 BLE 读充电器、以 HTTP 暴露快照。`GET /status` 一次拿到整机功率 + 三个 USB-C 口的电压/电流/功率/协议/线缆/设备识别。

**本站不轮询充电头，只接收统一遥测推送。** Mac Telemetry Hub 从本机 a2687 服务读取 `/status`，把精简后的状态放进 v2 envelope，只 POST 到 `/api/ingest/telemetry`，并使用 `TELEMETRY_INGEST_SECRET` Bearer 鉴权。旧的 `/api/ingest/charger` 入口已经删除，也没有本地轮询回退。

**总功率历史存在服务端**（`lib/charger-store.ts`，Redis；未配置 Redis 时退回进程内存）。客户端自己累积的话页面一刷新曲线就没了、还要攒很久才有形状。环形缓冲保留 400 点，两点之间至少间隔 `MIN_SAMPLE_GAP_MS`（当前 5 秒），足以覆盖固定 20 分钟图表窗口。

曲线的横坐标**按时间戳映射**而不是按序号等距铺开 —— 漏推一次就会有空档，等距会把那段画得和正常间隔一样宽。

超过 3 倍推送间隔（且至少 90 秒）没收到新数据就标记为断流，此时不再声称充电器在线，否则页面会一直显示旧的瓦数。

几个上游的脾气：

- `connected`（BLE 链路）和 `mode`（某个口是否在输出）是两层状态，UI 要分开处理
- 上游把 `"N/A"` 当占位符大量返回，必须过滤，否则界面上会出现一堆 N/A
- `ports` 的 key 顺序不保证，必须按 key 取
- 设备名靠 (VID, PID) 查表，表是逐条实机观察积累的。查不到时显示 `Unknown`（口空着才显示 `—`）
- **没有温度字段，上游也不给历史** —— 曲线是本站自己攒的

### Vibe Coding — ccusage

`ccusage` 只读取本机 `~/.claude` 和 `~/.codex` 会话日志，页面展示 Claude Code / Codex
卡片顶部汇总两者的全量 token、API 等值费用、活跃天数和 session 数，并按 input、output、
cache read、cache write、reasoning 画堆叠占比。下方展示各自的今日 token、7 日趋势、
API 等值费用、缓存命中率和模型。最近 5 分钟内只要
`ccusage session` 仍记录到活动，就会显示呼吸绿点和“正在使用”。费用来自 `ccusage` 的
公开价格表，只是“如果这些 token 走 API”的估值，并不是 Claude/Codex 订阅账单。
不会上传提示词、回复、项目名或文件路径。

趋势图使用最近 30 天、12 小时粒度（60 个点）。`ccusage` 没有 hourly report，因此按
session 的 `lastActivity` 把该 session 的 token 归入对应 12 小时桶；长 session 会归到
最后活动所在的桶。图表右侧的 `30D TOTAL` 是同一 30 天窗口的准确每日累计。

采集时优先让 `ccusage` 在线读取 LiteLLM 价格表，网络失败才回退它自带的缓存。
目前价格表还不认识 Claude Code 日志里的 `claude-opus-5` 简写；只有在上游返回 0、且当天仅有这个型号时，
本站才按当前公开 Opus 标准价兜底。一旦 `ccusage` 能返回价格，兜底会自动失效。

本地开发时 `/api/status/vibecoding` 会直接运行随项目安装的 `ccusage`，结果缓存 60 秒。
部署后只接受 Mac Telemetry Hub v2 的聚合摘要，不接受 ccusage 原始输出。

### 本机实时活动 — Mac Telemetry Hub

`a2687-telemetry/A2687TelemetryMac` 已从单一充电头工具扩展为可插拔的本机遥测中心。充电头、前台应用、本机 Apple Music、Mac 时区和 ccusage 都能独立开启或关闭。Apple Music 通过 macOS Apple Events 读取 Music.app 的本机播放状态，与上面的 Apple Music API“最近在听”完全独立。

所有采集器统一写入：

```text
POST /api/ingest/telemetry
```

请求采用唯一的 `version: 2` envelope，模块名固定为 `charger`、`desktop`、`apple_music`、`timezone` 和 `vibe_coding`，`modules` 只携带发生变化的模块。

五个模块的指纹一个都没变时，整个 POST 直接跳过——**不发空 `modules` 的信封**，这个端点上只跑真正的变化。存活改走另一条路：

```text
POST /api/ingest/presence
```

无变化时每 ≥30 秒一条，只带 `state` 和 `active_modules`。有数据要发时不走这条——那个包本身就证明上报器活着。崩溃、断网、强制关机时上报器什么都发不出来，那些靠服务端「多久没收到心跳」的超时兜底。

各模块的指纹粒度决定了「无变化」有多容易达成：`charger` 含功率/电压/电流，充电中几乎每轮都变；`desktop` 是应用名 + bundleID + 图标，不切应用就不变；`apple_music` 的进度**不入签名**，所以播放中也不变，只有 seek 偏离锚点超过容差才算；`timezone` 只有 IANA 标识、当前 UTC 偏移或缩写变化时才重发；`vibe_coding` 看 `ccusage` 的刷新时间戳。真正的零 telemetry 场景是充电头没接、不切前台应用、音乐不换曲不 seek、时区不变、ccusage 未刷新——此时只有每 30 秒一条 presence。

Music.app 封面和前台应用图标由 Mac 直接读取，只在内容变化时上传一次；服务端按内容哈希生成 `/api/image/asset/:id` 地址，普通状态心跳不会重复携带图片。时区模块只上传 IANA 标识、当前偏移和缩写，不上传地址。公开读取按用途拆分为 `/api/status/charger`、`/api/status/desktop`、`/api/status/timezone`、`/api/status/music` 和 `/api/status/vibecoding`。

### HomePod mini 播放实况

Home Assistant 在 HomePod 换歌、切换 `playing / paused / idle / off`、进度跳变
（`media_position_updated_at`）或切换循环模式时，把媒体状态推到：

```text
POST /api/ingest/homepod
Authorization: Bearer <TELEMETRY_INGEST_SECRET>
```

进度跳变那条触发器不能少：单曲循环时曲名和播放状态都不变，只有进度归零，
少了它服务端就不知道这首又从头开始了。

接收端复用统一遥测密钥，状态写入 Redis（未配置时退回进程内存）。`/api/status/music`
按「MacBook 在播 → MacBook 暂停未满 30 秒 → HomePod 在播 → HomePod 暂停未满 30 秒」
选来源。事件带有进度观测时间，前端据此自己推算进度。

判定“这条记录还算不算数”看的是**距上次收到推送多久**，不是推算进度有没有超过曲目
时长 —— Home Assistant 按状态变化推送，曲目放完到下一条推送之间必然超时，拿它当
作废依据会让播放中的曲目凭空消失。

Home Assistant 的 `rest_command.push_homepod_now_playing` 使用以下目标与鉴权头：

```yaml
url: "https://lyjw131.com/api/ingest/homepod"
method: post
content_type: "application/json"
headers:
  authorization: !secret telemetry_ingest_authorization
```

`secrets.yaml` 只保存完整 header 值，不把密钥写进配置或仓库：

```yaml
telemetry_ingest_authorization: "Bearer <TELEMETRY_INGEST_SECRET>"
```

Home Assistant 的 `entity_picture` 是一个带 `cache` 参数的代理地址。接收端只提取其中公开的
Apple CDN URL，并把 `{w}`、`{h}`、`{f}` 占位符替换成 `600`、`600`、`jpg` 后交给前端；
Home Assistant 的局域网地址和代理 token 不会公开。

## 改内容

文案、社交链接、项目、时间线全在 `src/lib/site.ts`，组件里不写死内容。标了 `占位` 的是示例文案。

## 设计约定

- 层次靠 1px 线条和表面色阶，不靠阴影；磨砂只用在吸顶导航
- 分隔线用 `screen-line-top/bottom`：内容居中，线横贯整个视口
- **整站只有实时状态区允许出现彩色**，其余全是灰阶 —— 眼睛会自动被实时数据吸走
- 全站 `tabular-nums slashed-zero`，实时数字跳动时不抖宽度
