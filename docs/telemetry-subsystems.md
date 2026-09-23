# 遥测与实时状态子系统架构指南

本文档汇集 `lyjwpage` 全站各实时状态模块的接入架构、数据流向、硬件/第三方 API 适配细节、协议决策与运维备忘。供开发者与 Agent 深入维护、排错与扩展时参考。

---

## 目录

1. [统一数据后端与通信模型](#1-统一数据后端与通信模型)
2. [最近在看 — Emby 流媒体](#2-最近在看--emby-流媒体)
3. [最近在听 — Apple Music 深度集成](#3-最近在听--apple-music-深度集成)
4. [歌词与动态封面 — amp-api](#4-歌词与动态封面--amp-api)
5. [Web 播放器与「一起听」 — MusicKit](#5-web-播放器与一起听--musickit)
6. [充电设备 — Anker Prime 160W 与 A110G](#6-充电设备--anker-prime-160w-与-a110g)
7. [Vibe Coding — 日志采集与年度热力图](#7-vibe-coding--日志采集与年度热力图)
8. [AI Coding Agent 账号限额](#8-ai-coding-agent-账号限额)
9. [本机活动与前台应用 — Mac Telemetry Hub](#9-本机活动与前台应用--mac-telemetry-hub)
10. [HomePod mini 播放实况 — Home Assistant](#10-homepod-mini-播放实况--home-assistant)
11. [活动圆环 — iPhone Telemetry Hub](#11-活动圆环--iphone-telemetry-hub)
12. [落地节点监控与三档自适应调频](#12-落地节点监控与三档自适应调频)
13. [PWA 与边缘缓存规则](#13-pwa-与边缘缓存规则)
14. [跨域活动脉搏与活动分（Pulse）](#14-跨域活动脉搏与活动分pulse)

---

## 1. 统一数据后端与通信模型

### 架构边界
- **唯一数据后端**：Cloudflare Workers 承担接收上报、持久化（Durable Objects SQLite）、提供状态 API、缓存外部数据、WebSocket 广播以及在线人数统计。
- **无状态渲染**：Vercel 仅负责首屏 HTML 生成、Next.js 页面缓存、静态资源分发和图片优化。Vercel 内部没有状态 API 代理或数据库直连端点。
- **客户端直连**：浏览器端配置 `NEXT_PUBLIC_BACKEND_URL` 直接与 Worker 通信，SWR 统一管理数据缓存与实时更新。

### 通信端点规范

| 方法 | 路径 | 鉴权 | 作用 |
| --- | --- | --- | --- |
| `POST` | `/api/ingest/<来源>` | `Bearer <TELEMETRY_INGEST_SECRET>` | 接收上报数据、落库、触发广播与首页缓存失效 |
| `GET` | `/ws` | 来源校验（`ALLOWED_ORIGINS`） | 浏览器直连的实时事件推送长连接 |
| `GET` | `online.homepage.lyjw.llc/ws` | 来源校验 | 「此刻在线」人数统计长连接（页面可见时开启，切走关闭） |
| `GET` | `/count` | 公开 | API Worker 返回 `{ connections }`；在线人数 Worker 返回 `{ online }` |
| `GET` | `/api/status/<模块>` | 公开 | 状态列表或历史数据查询 |
| `GET` | `/api/status/<模块>/now` | 公开 | 状态即时快照查询 |

### 信封与容错设计
- 所有 `/api/status/*` 端点共用统一信封格式：`{ ok: true, data: ... }` 或 `{ ok: false, error: ... }`。
- 上游故障或源离线时返回 200 HTTP 状态码并在信封内标记 `{ ok: false }`，避免 5xx 错误导致前端 SWR 全局打崩。

### 推送通信机制（Cloudflare WebSocket Hibernation）
- **选型演进**：放弃第三方托管推送（如 Pusher）与自建常驻服务器，采用 Cloudflare Durable Object 的 WebSocket Hibernation（休眠）API。
- **资源利用**：客户端连接走 `ctx.acceptWebSocket()`，心跳由运行时 `setWebSocketAutoResponse` 自动回复。无事件时实例完全休眠，支持挂载大量并发而不耗费运行时间。
- **事件划分**：
  - **状态翻面即时推**：前台应用切换、切歌、插拔充电头、上报器上下线、列表变动等事件通过 WebSocket 广播。
  - **连续滚动指标不推送**：功率曲线采样、token 用量滚动等保持 30 秒轮询，避免推送沦为无谓的频繁轮询。
  - **事件负载设计**：
    - `desktop`、`listening-now`、`watching-now`、`playing-now`、`charger`、`listening`、`watching`、`playing`：**一律携带最新数据**，浏览器收到后直接更新 SWR 缓存，避免回源请求打满并发。
    - `presence`：**仅发送失效通知**（payload 为 `null`），浏览器根据本地保存的 `lastSeenAt` 和 `heartbeatWindowMs` 自行判定是否真正超时断流。
- **5 分钟兜底轮询**：WebSocket 推送保障秒级响应，SWR 依然保留 5 分钟轮询兜底，以应对极端网络断线或推送不可用场景。

---

## 2. 最近在看 — Emby 流媒体

### 架构设计
- **完全不向 Emby 发起直连请求**：站点部署在云端公网，无法直达家庭内网 Emby 实例（`http://emby.local:8096`）。
- **NAS 推送代理**：由 NAS 上的 `reporters/emby-reporter` 负责观测 Emby，并通过 `POST /api/ingest/emby` 将规范化数据推送到 Worker。

### 数据流与触发条件
1. **播放通知转发**：Emby 原生 Webhook 缺乏自定义 Header 支持，由 NAS 代理接收 Webhook 并添加 `TELEMETRY_INGEST_SECRET` 后转发。
2. **播放位置与偏离推算**：
   - 代理仅在播放状态切换（开始/暂停/继续/停止）及用户**拖动进度条**时推送事件。
   - Emby 不对进度拖动发 Webhook，因此 NAS 代理在播放时每 2 秒轮询一次 `/Sessions`；但仅在真实进度与站点推算值偏差超过 1.5 秒时才触发网络推送。
   - 浏览器端利用播放锚点（`positionMs`、`durationMs`、`observedAt`）在未暂停时由本地时间自动推算进度条，无需轮询。
3. **媒体元数据提取**：
   - 代理从 `/Sessions` 提取原始音视频信息，将动态范围标准化为 `hdr10` / `hdr10plus` / `dolby-vision` / `hlg` / `sdr`。
   - 浏览器端纯函数组装规格标签（如 `1080p · H.264 · DD+ 5.1`），过滤服务端复杂的本地化显示名及 NAS 内网 SMB 路径。

### 图片处理与 R2 缓存
- **剧照 vs 海报**：剧集本身的 Primary 图通常是剧照，竖版海报由代理优先提取剧集的 `SeriesPrimaryImageTag` 并用 sharp 压缩为 `<sha256>.webp` 直传 Cloudflare R2。
- **`missingImages` 补传机制**：条目中仅存 `imageKey`（`itemId:kind:tag:height`），读取时映射为对象键并拼成 `/img/<对象键>` 同源路径，由访客域名的边缘（Vercel rewrite / ESA）回源 R2。若 Worker 发现缺少对应对象，会在上报回执中返回 `missingImages`，代理据此异步补传。
- **HEAD 缓存 5 分钟**：Worker 对 R2 对象的 HEAD 校验缓存 5 分钟，以便桶清空或对象重建后能自动重新请求补传。

---

## 3. 最近在听 — Apple Music 深度集成

### 数据抓取与无常驻架构
- **API Worker 驱动**：弃用常驻进程，由 API Worker 直接请求 Apple 接口 `/v1/me/recent/played?limit=10`，写入 SQLite 并广播。
- **触发与闸门**：
  - WebSocket 建立时检查，Cron 每分钟在存在活跃连接时巡检。
  - 全站 2 分钟 TTL 防穿透，上游报错时同样写入负缓存，防止雪崩。
  - 无访客连接时完全停止向 Apple 请求。
- **容器与单曲解算**：Apple 返回的是容器（专辑/歌单/电台），时长通过容器的 `href` 深入查询曲目累计（缓存 24 小时），自建歌单封面缓存 12 小时。

### 凭据与安全模型
- **私钥不落服务端**：Apple Music 开发者私钥（`.p8`）保存在主人的本地 Mac 钥匙串中，服务端与代码库不包含任何私钥或离线签名代码。
- **Mac Telemetry Hub 动态签发**：Mac 端利用本机 MusicKit 实时签发一对 `Developer Token` 和 `Music-User-Token`，通过 `/api/ingest/mac` 上报。
- **半衰期自动续期**：Developer Token 有效期约 30 天，Mac 端在上报时刻超过有效区间中点（半衰期）时自动重签并上报。
- **凭据隔离**：收到的 Token 仅存入 Worker 的独立 SQLite 凭据表，严格与公开遥测数据隔离，且不提供任何外部 GET 端点。

---

## 4. 歌词与动态封面 — amp-api

### 双凭据调用机制
- **未公开接口**：歌词与动态封面通过 Apple Web 播放器使用的内部端点 `amp-api.music.apple.com` 获取。
- **鉴权要求**：
  - `Authorization`：从 `music.apple.com` 网页 bundle 动态提取的 Web Token（由 Worker 定期抓取并缓存在 SQLite 中）。
  - `Media-User-Token`：Mac Telemetry Hub 上报的主人个人 Music-User-Token。若缺少此 Token，amp-api 返回 404（表现与无歌词相同）。

### 歌词解析与逐字点亮
- **优先级降级**：优先请求字级歌词（`/syllable-lyrics`，带每个字词的时间戳），404 时降级为行级歌词（`/lyrics`）。
- **TTML 解析规范**：
  - 剔除 `<head>` 中的非歌词元数据与和声（`x-bg`）。
  - 将字词间空格吸附至前一个字词，确保拼接后排版连续。
- **rAF 高性能渲染**：
  - 动态歌词进度在 Hero 卡片展示，播放时由 `requestAnimationFrame` 直接计算 CSS 变量 `--sung` 裁剪文字渐变，绕过 React 渲染循环。
  - 换句动作由边界精确定时器驱动，与当前音轨算法一致。

### 接口缓存与公开查询策略
- `GET /api/lyrics?song=<ID>`：支持传入曲目 ID，供网页播放器点播历史曲目歌词使用，结果按 URL 进行 `public, s-maxage` 长效缓存（有词存 7 天，无词存 1 小时）。
- `GET /api/lyrics`（无参数）：直接读取当前正在播放的曲目歌词，响应标为 `no-store`，防内容跨歌混淆。

---

## 5. Web 播放器与「一起听」 — MusicKit

### 访客跟听机制
- **架构隔离**：访客在前端播放器使用自己的 Apple Music 订阅。站点不中转音频，播放发生在访客浏览器与 Apple CDN 之间。
- **独立访客 Token 签发**：
  - 由 API Worker 的 `GET /api/musickit/token` 动态生成访客 Developer Token。
  - 有效期设为 7 天（默认），超过半衰期（3.5 天）自动换新。
- **双重域名安全闸**：
  1. 第一道：Worker 检查请求 `Origin` 是否在 `ALLOWED_ORIGINS` 白名单中。
  2. 第二道：签发 JWT 时将当前具体 Origin 写入 Token 的 `origin` 声明中，由 Apple 端负责最终校验，防止 Token 被盗用至非授权站点。

### 同步与防抖算法
- **四项跟随驱动**：切歌重排队列并按当前偏移起播；主机暂停则跟随暂停；主机续播则对齐播放；主机拖拽进度即刻对齐。
- **5 秒防抖窗口**：常规播放中运行 20 秒周期性慢巡检；若访客播放进度与主机偏差在 5 秒以内，不执行 `seek`（避免反复触发音频缓冲造成断续体验）。

---

## 6. 充电设备 — Anker Prime 160W 与 A110G

### 数据链路
```text
Anker 硬件 (BLE) ──> a2687-telemetry ──> Mac Telemetry Hub ──> POST /api/ingest/mac ──> Worker SQLite
```

### 本地高速 SSE 切换
- 当在内网 Mac 访问 `/local/charging` 时，会在浏览器 `localStorage` 写入标记并跳转首页。
- 此时页面跳过远端 Worker，直接连接本机 `http://127.0.0.1:8787/sse/charger` 和 `/sse/powerbank`，享受约 1 Hz 的秒级高刷功率流。连接断开则平滑降级回远端推送。

### 功率曲线与历史回放
- **服务端 400 点环形缓冲**：Worker SQLite 为充电头保留最近 400 个采样点（最小间隔 5 秒，覆盖约 20 分钟历史），新进网页可直接绘制完整历史曲线。
- **真实时间映射**：图表横坐标必须按时间戳间距绘制，禁止按采样序号等宽平铺，以真实还原丢包或断流空档。
- **断流检测**：超过 3 倍推送间隔且至少 90 秒（同时不小于心跳窗口 300 秒）未收到新读数，状态判定为断流，卡片置灰。

### A110G 充电宝差异
- 充电宝电量变化缓慢，因此服务端**不记录历史曲线**，仅保存当前快照。
- 即时推送仅在插拔线缆、充放电切换、温控翻转或整数电量跳格时触发。

---

## 7. Vibe Coding — 日志采集与年度热力图

### 数据源与模块拆解
Mac Telemetry Hub 采集三大模块并通过 `/api/ingest/mac` 上报：
1. `vibeCodingNow`（60 秒）：当前是否处于活跃编码状态、正在使用的模型、最近活动时间戳。Codex、Claude 由每分钟的增量日志扫描判断；其余来源要跑 `ccusage session`（每次重读全部历史），最多 5 分钟一次。
2. `vibeCodingUsage`（10 分钟）：各来源（Claude Code、Codex、Grok 等）今日 Token 用量、缓存命中率、会话数及 API 等值费用。Cursor 的云端历史不在这封里。
3. `vibeCodingYear`（1 小时）：过去 53 周（371 天）日总量及每日 Top 5 模型分布，不含 Cursor。Cursor 的日子由读出口并上容器上报的日桶。

### 数据契约与分桶规范
- **日期分桶**：全量历史数据严格按 `Asia/Shanghai` 时区划分自然日。
- **`activeDays` 判定**：所有来源中存在非零 Token 用量日期的**并集**，而非各来源天数简单相加。
- **费用估算**：按公开 API 定价折算等值费用，仅作为 token 量级参考，不代表实际账单。
- **年度图全量刷新**：`/api/status/vibecoding/year` 每次请求返回 371 天完整窗口，客户端收到后全量覆盖，方便云端对旧日数据的修正确保落盘。

### 本地测试与校验脚本
- 执行 `node scripts/verify-api-worker.mjs`：启动内存隔离的 SQLite Worker，验证协议校验、并发合并与持久化。
- 执行 `node scripts/verify-coding-usage.mjs`：需指定本机测试实例与专用测试前缀（脚本自带防误操作检查，拒绝生产环境写入）。

---

## 8. AI Coding Agent 账号限额

### 容器化上报架构
- **独立容器运行**：`reporters/agents-reporter` 运行在独立 Linux 容器中，每轮通过 `POST /api/ingest/agents` 统一上报限额。同一封里的 `cursorUsage` 是 Cursor 云端用量日桶；Mac 不在线时站点用它继续更新 Cursor 的合计和年度图。同一封还带 `cursorNow`（最近一条用量事件）；Cursor 在用时容器改为每分钟查一次、变了单独发，停用后间隔逐步拉长再交回限额那一轮。卡片上 Cursor 的活动灯按它在 5 分钟内现算。Cursor 历史平时只增量拉最近两天，每 6 小时整段重拉核对。
- **凭据完全隔离**：容器内部独立维护各家 CLI（Claude Code、Codex 等）登录 Session，严禁复制宿主机凭据，防止 refresh token 竞态失效。
- **心跳与超时**：
  - 即使数据无变化，每轮上报依然执行（作为存活心跳）。
  - 站点在响应中附带 `limitsStaleAfterMs`（默认 185 分钟），由前端计算是否呈现 Stale 虚化状态。

---

## 9. 本机活动与前台应用 — Mac Telemetry Hub

### 信封与心跳机制
- 采用规范化的 `version: 4` 信封，顶层字段包含 `heartbeatAt`、`presence`（`online` / `offline`）与 `activeModules`。
- **模块静默机制**：
  - 仅携带内容发生变更的模块。
  - 若所有模块指纹均无变化，发送空 `modules` 的**纯心跳信封**（至少每 30~90 秒一条），仅用于维持存活时间戳，不写入历史数据表。
- **优雅离线**：Mac 休眠或关机时主动发送 `presence: "offline"`；崩溃或断网由服务端根据 `HEARTBEAT_WINDOW_MS`（默认 5 分钟超时）自动兜底判定。

### 前台应用图标直传 R2
- **系统原生编码**：Mac 端使用 macOS 原生接口将前台应用图标缩放为 96px PNG 并计算 SHA-256，直传 R2。
- **只收对象键**：上报信封仅包含 `<sha256>.png` 对象键，服务端杜绝接收 Base64 或图片二进制文件，避免增加 Worker 内存开销。

---

## 10. HomePod mini 播放实况 — Home Assistant

### 上报触发与配置
Home Assistant 监控 HomePod 实体，在切歌、状态变更、进度跳变或循环模式切换时，触发 `rest_command.push_homepod_now_playing` 上报：

```yaml
# Home Assistant 自动化 payload 规范
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
> **注意**：必须在 Jinja 内部构造完整字典后经 `| to_json` 输出，禁止手动拼接 JSON 字符串，以防歌曲名中的特殊字符引发解析异常。

### 设备优先级抢占与 10 秒宽限期
- `/api/status/listening/now` 动态裁决优先级：
  `MacBook 正在播放` > `MacBook 暂停未满 10 秒` > `HomePod 正在播放` > `HomePod 暂停未满 10 秒`。
- 服务端通过 `observedAt` 动态计算 `expiresInMs` 下发给客户端，由浏览器精确调度下一次查询时间，避免在服务端无状态实例上挂载定时器。

---

## 11. 活动圆环 — iPhone Telemetry Hub

### 数据采集特性
- **原生读取真实目标**：通过原生 Swift 代码从 `HKActivitySummary` 读取用户当天的真实目标卡路里、锻炼时长与站立次数（非预设常量）。
- **设备时区为准**：上报日期取 Apple Watch 当地自然日（`YYYY-MM-DD`）与 `secondsFromGMT`。跨时区旅行过日界线时，按手表本地日推进，服务端不做时区矫正。
- **iOS 后台节流容忍**：iOS 系统对 HealthKit 数据的后台推送存在约每小时一次的系统级节流，因此该模块不建立 WebSocket 推送，前端采用 5 分钟轮询，状态灯以 90 分钟为有效时间窗口。

---

## 12. 落地节点监控与三档自适应调频

### 节点监控
- `reporters/server-reporter` 部署于云端 Linux 节点（TypeScript / Node，和 agents-reporter 同一套结构），采集 `/proc/stat` 与 `/proc/net/dev`，上报 CPU、内存及网络吞吐，前端 30 秒轮询。

### 三档自适应调频算法
为最大化节省服务器资源与外部 API 配额，`server-reporter`、`playstation-reporter` 和 `agents-reporter` 均遵循三档自适应调频：

| 触发条件 | 说明 | server / PlayStation 间隔 | agent limits 间隔 |
| --- | --- | --- | --- |
| `online > 0` | 存在处于**前台可见**状态的访问者页面 | 60 秒 | 5 分钟 |
| `connections > 0` | 无前台可见页面，但存在**后台打开**的标签页 | 2 分钟 | 10 分钟 |
| 两个指标均为 0 | 全网无任何活跃页面连接（无人值守） | 15 分钟 | 60 分钟 |

- **单向降级安全**：若查询在线人数接口超时或失败，默认计数降为 0，调频节奏仅会变慢而不会雪崩加速。
- **分段休眠响应**：常驻上报器将长间隔休眠拆分为短周期轮询，一旦有新用户进入页面，能够迅速在下一个短周期内提升采样频率。

---

## 13. PWA 与边缘缓存规则

### PWA 缓存策略
- 生产环境注册 `/sw.js`，仅持久化缓存离线提示页 `/offline.html`。
- 首页 HTML、RSC 数据、状态 API 及媒体资源均不写入 Service Worker 离线缓存，保证用户时刻获取最新实时流。

### 阿里云 ESA 规则前置
- 针对 `lyjw131.com` 的 ESA 缓存控制台，必须在首位配置「**PWA 核心文件绕过缓存**」规则：
  - 匹配路径：`/sw.js`、`/offline.html`、`/manifest.webmanifest`、`/pwa/icon-192.png`、`/pwa/icon-512.png`。
  - 该规则必须优先于整站长效缓存规则执行，避免客户端安装入口和离线更新被 CDN 强缓存拦截。

---

## 14. 跨域活动脉搏与活动分（Pulse）

首页 Pulse 的六条曲线与右侧摘要统一使用五分钟 Jev 评分，详情见
[统一五分钟评分](../workers/api/README.md#pulse-统一五分钟评分)。

采集原始状态仍存 `pulse:<domain>`，由规则解释正在播放、暂停、充电等观测状态。
这些规则档位不直接绘图。每个领域的变化和五分钟心跳（含空闲）都记录，断流留空。
送去 Jev 之前，每个域把窗口压成算好的命名秒数和次数（`shared/pulse-<domain>.ts`），
模型不拿原始区间、时间戳或数字图例——它不会数数、不会算时长；档位判据写成情境。
Coding 另外保留前台应用与 Agent 的细粒度观测，并接入 MacTelemetryHub 的
`vibeCodingNow.tokenUsage`。用量按本地日志事件时间入桶，不由日汇总差分。
Listening 另外把「最近在听」列表的变动作为播放证据（`pulse:listening-plays`）：
Mac 睡着、HomePod 没动时，iPhone 等设备只在这份列表上留痕迹。它没有时刻，
只知道播放落在两次刷新之间，所以一条最多认领一个评分窗口那么长的已观测时间，
其余不确定性由置信度承担。也因为实测只看得见 Mac 和 HomePod，Listening 这条线
画的是 Jev 评分（`kind:"score"`）而不是实测阶跃，两路证据才都在图上；
Watching / Gaming / Charging 没有这个盲区，仍画实测。
身体活动由 iPhone 回查最近 24 小时已经闭合的 UTC 五分钟 HealthKit statistics 桶。
每次上报的查询范围是权威快照，可修订或删除旧桶；部分指标缺失且其余读数为零时保持未知，
只有三项都明确为零才算静止，也不会把最后一个桶延伸到当前时刻。
已完成训练另从 `workouts:recent` 进入同一套 Jev 判据：项目名和摊到五分钟窗口里的活动秒数与统计桶档位并列，统计桶不混入这笔时长。训练覆盖而统计桶没有样本的窗口也会打分。

`PulseScorer` 每五分钟最多运行一轮，每个领域和时间窗口独立请求官方 Jev，
统一保存 `pulse:assessments`。相同输入哈希不重复评分，迟到用量可触发对应窗口修订。
每个窗口含覆盖区间、强度、连续性、置信度、概率分布、实际模型和评分时间。
右侧 24 小时摘要按同一批分数的已观测时长加权；趋势比较最近三小时与此前三小时。
缺乏任一侧观测时趋势是 unknown，不冒充稳定。没有第二条日总评模型调用链。

公开端点 `GET /api/status/pulse` 与 `/api/home.pulse` 返回
`domains[domain].assessments/score`（按列、时刻为相对 `window.from` 的秒）。评分只公开区间、强度（含置信度）、连续性和模式，
概率分布、输入哈希、模型名和评分时刻不出库。原始应用、曲名、token 和会话信息不公开。
读模型仍为 slow 策略，页面五分钟轮询，发布和浏览器读取可能增加显示延迟。

原始状态按水位归档 D1；Activity 的权威查询范围按 revision 原子替换，保留修订和删除。
模型评分在 StateHub 保留七天，不混入原始状态表。
发布顺序为 Worker、前端契约生效后再安装对应采集器；Activity 历史需安装 iPhone Hub 2.0.3。
