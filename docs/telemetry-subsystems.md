# 遥测与实时状态子系统架构指南

> 类型：reference

本文档汇集 `lyjwpage` 全站各实时状态模块的接入架构、数据流向、硬件/第三方 API 适配细节、协议决策与运维备忘。供开发者与 Agent 深入维护、排错与扩展时参考。

---

## 目录

1. [统一数据后端与通信模型](#1-统一数据后端与通信模型)
2. [最近在看 — Emby 流媒体](#2-最近在看--emby-流媒体)
3. [最近在听 — Apple Music 深度集成](#3-最近在听--apple-music-深度集成)
4. [歌词与动态封面 — amp-api](#4-歌词与动态封面--amp-api)
5. [Web 播放器与「一起听」 — MusicKit](#5-web-播放器与一起听--musickit)
6. [充电设备 — Anker Prime 160W 与 A110G](#6-充电设备--anker-prime-160w-与-a110g)
7. [AI Coding — 多来源 token 用量与年度热力图](#7-ai-coding--多来源-token-用量与年度热力图)
8. [AI Coding Agent 账号限额](#8-ai-coding-agent-账号限额)
9. [本机活动与前台应用 — Mac Telemetry Hub](#9-本机活动与前台应用--mac-telemetry-hub)
10. [HomePod mini 播放实况 — Home Assistant](#10-homepod-mini-播放实况--home-assistant)
11. [活动圆环 — iPhone Telemetry Hub](#11-活动圆环--iphone-telemetry-hub)
12. [落地节点监控与三档自适应调频](#12-落地节点监控与三档自适应调频)
13. [PWA 与边缘缓存规则](#13-pwa-与边缘缓存规则)
14. [跨域活动脉搏（Pulse）](#14-跨域活动脉搏pulse)

---

## 1. 统一数据后端与通信模型

### 架构边界
- **唯一数据后端**：Cloudflare Workers 承担接收上报、持久化（Durable Objects SQLite）、提供状态 API、缓存外部数据、WebSocket 广播以及在线人数统计。上报由无状态的上报入口 Worker（`workers/ingress`）鉴权、校验并按数据层拆开，实时那一半经 Service Binding 交给持有 Durable Object 的状态核心（`workers/api`）。
- **无状态渲染**：Vercel 仅负责首屏 HTML 生成、Next.js 页面缓存、静态资源分发和图片优化。Vercel 内部没有状态 API 代理或数据库直连端点。
- **客户端直连**：浏览器端配置 `NEXT_PUBLIC_BACKEND_URL` 直接与 Worker 通信，SWR 统一管理数据缓存与实时更新。

### 通信端点规范

| 方法 | 路径 | 鉴权 | 作用 |
| --- | --- | --- | --- |
| `POST` | `ingest.homepage.lyjw.llc/api/ingest/<来源>` | Cloudflare Access service token（每来源一把，上报入口 Worker 再验 JWT 并按来源限权） | 上报入口校验、拆分；状态核心落库、触发广播与首页缓存失效 |
| `GET` | `/ws?visible=1\|0` | 来源校验（`ALLOWED_ORIGINS`） | 浏览器直连的实时事件推送长连接，也是在线人数的来源：页面切到后台不断开，只发 `visible` / `hidden` |
| `GET` | `/count` | 公开 | `{ connections, online }`：开着的页面（含后台）与此刻可见的页面 |
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
  - **连续滚动指标不推送**：功率曲线采样、token 用量这类累计读数由卡片按自己的间隔轮询，避免推送沦为无谓的频繁轮询。
  - **事件负载设计**：
    - 带数据的事件（登记表 `src/lib/status-views.ts` 里带 `event` 的视图）：**一律携带那条端点的整份数据**（充电头不带历史点，由浏览器接上已有曲线），浏览器收到后直接更新 SWR 缓存，避免回源请求打满并发。
    - `presence`：**仅发送失效通知**（payload 为 `null`），浏览器根据本地保存的 `lastSeenAt` 和 `heartbeatWindowMs` 自行判定是否真正超时断流。
- **5 分钟兜底轮询**：推送覆盖整份的实时视图（登记表 `pushCovers`）在 WebSocket 连着时只保留 5 分钟轮询兜底；断开时回到卡片自己的快间隔，重连后立即回源一次补上漏掉的推送。带心跳判活（`lastSeenAt`）或滚动读数的卡不退，照常轮询。

---

## 2. 最近在看 — Emby 流媒体

### 架构设计
- **完全不向 Emby 发起直连请求**：站点部署在云端公网，无法直达家庭内网 Emby 实例（`http://emby.local:8096`）。
- **NAS 推送代理**：由 NAS 上的 `reporters/emby-reporter` 负责观测 Emby，并通过 `POST /api/ingest/emby` 将规范化数据推送到 Worker。

### 数据流与触发条件
1. **播放通知转发**：Emby 原生 Webhook 缺乏自定义 Header 支持，由 NAS 代理接收 Webhook，带上 Emby 那把 Access service token 后转发。
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
- `GET /api/lyrics?song=<ID>`：按曲目 ID 查询，`song` 必填，卡片 hero 与网页播放器都走这条；结果按 URL 进行 `public, s-maxage` 长效缓存（有词存 7 天，无词存 1 小时）。
- 首屏那首的歌词由站点在拿到「此刻在听」之后按曲目读 `/api/lyrics`；`/api/lyrics` 与 `/api/motion-artwork` 只做按键查询，不回答「此刻」，所以不归 `/api/status/*`。

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

## 7. AI Coding — 多来源 token 用量与年度热力图

### 来源与事实
coding agent 的 token 用量有三个来源。来源只报自己观测到的原始事实，合计、排名、「今天」、年度格子都在状态核心一处算；事实类型与校验在 `shared/coding-usage.ts`，来源登记与合并规则在 `shared/coding-usage-sources.ts`。

| 来源 | 入口里的位置 | 看得到什么 |
| --- | --- | --- |
| `mac` | `/api/ingest/mac` 的 `modules.codingUsage` / `codingActivity` / `codingTokenBuckets` | 这台 Mac 本地日志里的会话 |
| `agents` | `/api/ingest/agents` 顶层同名三键 | 账号侧的完整历史（Cursor） |
| `agents-otlp` | `/api/ingest/agents/otlp`（Claude Code 内置遥测） | 云端环境里的会话；状态核心把累计值做差后整理成同形的三种事实 |

三种事实：`(来源, agent, 站点日)` 的日行（token 分列、API 等值费用、当天按模型拆分）、`(来源, agent, 模型)` 的 5 分钟 token 桶、`(来源, agent)` 的最近一条用量事件。坏的 coding 模块只丢它自己，回执写 `rejected`（见 [上报入口](../workers/ingress/README.md)）。各来源的采集节奏见各自上报器的 README。

### 合并规则与出口
- 同一 agent 有账号级来源时只算它，其余来源的同 agent 账本标 `superseded`、不相加；只有设备级 / 环境级来源时相加（claude 的本机与云端，前提是云端遥测变量只配在云端）。规则在 `shared/coding-usage-sources.ts#resolveCodingUsageSources`。
- 日子或会话数变了才重算视图与年度（`shared/coding-usage-view.ts#buildCodingUsageView`）：合计、全部历史的前三模型、各 agent 最近一个有行的站点日、各来源状态，以及年度视图每天的合计与前几名模型；只有状态变了只换状态。采集时刻比存着的旧的账本不收。存储键与归档见 [coding agent 的 token 用量](../workers/api/README.md#coding-agent-的-token-用量)。
- 三条读出口都在实时层（`src/lib/coding-usage.ts`）：
  - `/api/status/coding`：视图原样给，不推送，卡片自己轮询。
  - `/api/status/coding/now`：各 agent 各来源最近一条事件，带 Mac 的存活；变了推 `coding-now`，带整份。
  - `/api/status/coding/year`：按站点今天切出 53 周（`src/lib/coding-year.ts#encodeCodingYear`），任一来源有日行就出图；不推送、没有首屏失效，年度图自己长间隔轮询、切回标签页时再取；首屏那份放得比轮询间隔还久时挂载补取一次（`src/lib/poll-schedule.ts#fallbackOutlived`）。

### 卡片怎么判
- 展示名、品牌图标、占哪种行（全量面板、紧凑行、只进合计与年度不单独占行）只在站点登记表 `src/lib/coding-agents.ts#CODING_AGENTS`；来源只报 agent id，登记表里没有的 id 用 id 当名字、占一行紧凑行。
- 「今天」：视图给的是各 agent 最近一个有行的站点日，浏览器按自己的站点日判是不是今天，不是今天就写明是哪一天。来源在当天有采集就有行（没用是一行 0），所以最近一天停在昨天表示今天还没报到。
- 活动灯：任一来源的最近事件在 `src/lib/coding-agents.ts#CODING_ACTIVE_WINDOW_MS` 内就亮；Mac 亲口离线时只作废来自 `mac` 的时刻（`liveCodingActivity`），账号与云端的灯不受 Mac 存活影响。
- 来源状态：参与合计的来源这一轮采集失败（`error`）时，读数旁标 Partial（有读数）或 Unavailable（没有读数），悬停写出每个来源的状况（含被账号级来源覆盖的 `superseded`）；没有行的地方一律画「—」，不当成 0。
- 限额另走可滞后层（见下一节），按 id 贴到同一行上。

### 数据契约与分桶规范
- **日期分桶**：日行按 `Asia/Shanghai` 站点日划分；时刻一律 epoch 毫秒。
- **`activeDays` 判定**：全部历史、全部 agent 里当天合计大于 0 的站点日**并集**，而非各来源天数相加。
- **费用估算**：来源侧按公开 API 定价折算（云端用 Claude Code 自报的费用），站点只相加；`costComplete` 按天判，来源采集失败只体现在来源状态里。仅作为 token 量级参考，不代表实际账单。
- **模型名**：按来源给的字符串原样分组，不做跨来源别名合并；占位名（`shared/coding-models.ts#HIDDEN_CODING_MODELS`）不进排名、不当模型名展示。

### 本地测试与校验脚本
- 执行 `node scripts/verify-api-worker.mjs`：启动内存隔离的 SQLite Worker，验证协议校验、并发合并与持久化，其中 `scripts/verify-coding-usage.mjs` 往三个入口推事实、断言三条出口。
- 浏览器里看此刻没发生的状态：`workers/api/dev-fixtures/` 下的 `coding-*.json` 夹具，注入方法见 [本地开发](../workers/api/README.md#本地开发)。

---

## 8. AI Coding Agent 账号限额

### 容器化上报架构
- **独立容器运行**：`reporters/agents-reporter` 运行在独立 Linux 容器中，每轮通过 `POST /api/ingest/agents` 统一上报限额。同一封可以另带 Cursor 账号的三种 coding 事实（`codingUsage` / `codingActivity` / `codingTokenBuckets`，见上一节），Mac 不在线时 Cursor 的用量与活动灯照样更新。
- **凭据完全隔离**：容器内部独立维护各家 CLI（Claude Code、Codex 等）登录 Session，严禁复制宿主机凭据，防止 refresh token 竞态失效。
- **心跳与超时**：
  - 即使数据无变化，每轮上报依然执行（作为存活心跳）。
  - 限额在可滞后层，过没过时由浏览器按 `AGENT_LIMITS_STALE_MS` 判断，超过就呈现 Unavailable（源：`src/lib/freshness.ts#AGENT_LIMITS_STALE_MS`）。

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
- **iOS 后台节流容忍**：iOS 系统对 HealthKit 数据的后台推送存在约每小时一次的系统级节流，因此该模块不建立 WebSocket 推送，前端按上报节奏（每小时）在下一次预期上报后取，逾期后退避到最多 5 分钟一次。
- **读数与训练在可滞后层**：圆环读数（KV `activity:v1`）与最近训练（KV `workouts:v1`）由上报入口在状态核心那一半成功之后写入，状态核心只留 Pulse 用的五分钟统计桶和训练区间。圆环超过 12 小时（一夜加余量）没有新读数时卡片写 Unavailable；训练是历史事实，不设过期。

---

## 12. 落地节点监控与三档自适应调频

### 节点监控
- `reporters/server-reporter` 部署于云端 Linux 节点（TypeScript / Node，和 agents-reporter 同一套结构），采集 `/proc/stat` 与 `/proc/net/dev`，上报 CPU、内存及网络吞吐，每分钟一推；前端在下一次预期上报后几秒去取。

### 三档自适应调频算法
为节省外部 API 配额，采集 Worker 的 PlayStation 任务（`workers/collector`）和 `agents-reporter` 遵循三档自适应调频（`server-reporter` 固定每分钟一推、不参与调频，理由见它的 README「节奏」）：

| 触发条件 | 说明 | PlayStation 间隔 | agent limits 间隔 |
| --- | --- | --- | --- |
| `online > 0` | 存在处于**前台可见**状态的访问者页面 | 60 秒 | 5 分钟 |
| `connections > 0` | 无前台可见页面，但存在**后台打开**的标签页 | 2 分钟 | 10 分钟 |
| 两个指标均为 0 | 全网无任何活跃页面连接（无人值守） | 30 分钟 | 60 分钟 |

- **单向降级安全**：若查询在线人数接口超时或失败，默认计数降为 0，调频节奏仅会变慢而不会雪崩加速。
- **分段休眠响应**：常驻上报器将长间隔休眠拆分为短周期轮询，一旦有新用户进入页面，能够迅速在下一个短周期内提升采样频率。PlayStation 那边是 cron 每分钟看一眼门，效果相同。
- **PlayStation 另外两条**：主机电源（Home Assistant 上报）翻面时立刻跑一轮、关机时只走最慢一档；PSN 前面的 CDN 回拒绝页或网关错误时按 5 → 10 → 20 → 30 分钟退避，成功一轮清零。细节见 `workers/collector/README.md`。

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

## 14. 跨域活动脉搏（Pulse）

首页 Pulse 是最近 24 小时「在做什么」的事实时间线：只存原始值，档位、颜色、摘要在卡片里现算。
契约与存储见 [跨域活动脉搏（Pulse）](../workers/api/README.md#跨域活动脉搏pulse)。

- 听、看、玩是状态区间：每条道一个开着的区间加一串已关闭区间（`pulse:v2:<道>`），同一状态只续
  最后确认时刻、每分钟最多写一次，状态或标题变了才换段；超过有效期没有观测就是未知，不是空闲。
  曲名、艺人、专辑、片名、集数、游戏名分字段存，不再压成 48 字 hint。
- 「最近在听」列表的变动没有时刻，只知道落在两次刷新之间，存成不确定区间
  （`pulse:v2:listening-traces`），图上用斜线画出来，不当成此刻在放。
- Coding 的三色带（前台 coding 应用 / agent / 两者同时）读时从原始观测
  （`pulse:coding-observations` 与 Cursor 账号观测）现算。Jev 只给 Coding 打十五分钟强度与模式，
  只在悬停里出现；别的道不再有模型分。
- Tokens 道画三个来源的 5 分钟 token 桶相加后的速率（不含 cache read），不带模型名和来源；
  取桶规则见 `src/lib/pulse.ts#tokensLaneView`。
- 充电存实测瓦数，身体活动存 HealthKit 五分钟桶的原始计数与已完成训练的区间。
- 这些事实由状态核心按水位每分钟归档到 D1 的事实表（迁移 `0007_history_pulse.sql`）。
