---
kind: reference
---

# 页面细节与关键设计

根 README 只留一页能读完的概览；各卡片的细节和几条贯穿全站的设计取舍放在这里。各数据源的接入与协议见 [遥测与实时状态子系统](./telemetry-subsystems.md)，存储分层与首屏缓存见 [Worker 数据后端与首屏缓存](./state-storage.md)。

## 卡片细节

**页头的前台应用**：页头中央显示 Mac 此刻的前台应用，图标和名字由 Mac 上报器上报。几款常用工具换成了品牌标识：Claude Code 是像素吉祥物的取物动画，来自 [mascot-fetch-loop](https://github.com/LYJW131/mascot-fetch-loop)（从屏幕录像逐帧复原的 19 个姿势，站点内联其精灵数据自行播放，[在线预览](https://lyjw131.github.io/mascot-fetch-loop/)）；Ghostty 是[官网首页](https://ghostty.org/)那只 ASCII 幽灵，`scripts/ghostty-frames.mjs` 从首页载荷里取出字符画帧，按字形墨量把单元分成本体和光环各几档，抽帧压成粗网格（`src/lib/ghostty-frames.json`，参数见 `scripts/ghostty-frames.mjs#CROP` 等常量），站内用 SVG 路径循环播放，本体跟随页面文字色、光环保持官网的蓝；Cursor 与 Antigravity 用 [LobeHub 图标集](https://github.com/lobehub/lobe-icons)的字标。

应用名下面那行淡色小字是当前窗口的标题，Cursor 和 Antigravity 两段演示了它出现、变化和消失的样子——但只有通过隐私判断的标题才会出现，见下文「窗口标题在上报之前先过一道判断」。

**AI Coding**：各编码工具的 Token 用量、成本估算、今日用量与账号限额窗口。用量有三处来源：Mac 本机日志、Cursor 账号侧的历史、Claude Code 云端的遥测，来源只报原始事实，合计、排名、今日和年度格子在状态核心一处算（同一 agent 有账号级历史时只算它，否则相加）。哪个 agent 此刻在用看它最近一次用量事件，Mac 合盖时云端和 Cursor 的灯照样亮；某个来源采集失败时，读数旁标出 Partial，不把缺的那部分当成 0。

**Pulse**：最近 24 小时「在做什么」的事实时间线。编码是三色带：前台开着编码应用、只有 agent 在跑、两者同时，下面的 Tokens 道画三处来源相加后的每分钟 token（和站内所有 token 数一样含 cache read）；听、看、玩按状态画出在放 / 暂停 / 空闲（在游戏里 / 在线 / 离线），并带上当时的曲目、影视或游戏名；充电画实测瓦数；身体活动画 HealthKit 闭合五分钟桶的步数，训练叠成带项目名的区间。没有观测的时段留空，和观测到的空闲分开。没有上报器的 Apple Music 播放（iPhone、iPad、网页版等），从「最近播放的歌」列表推出来：一首歌开播几秒后就排到列表最前，结合每首时长把连续播放的一串对齐，画成每首一段的斜线区间，悬停可看开播时刻的理想误差。右侧是这一天的事实摘要（编码时长与其中 agent 的时长、在放时长与曲目数、Token 速率峰值与当前速率、充电峰值与电量、步数）。只存原始值，档位与颜色在展示时现算；Jev 只给编码的十五分钟窗口打强度与模式，出现在悬停里。事实每 5 分钟归档到 D1。悬停、点击或用方向键走到某一段，会显示这一段的时间范围和当时的状态与标题。

**站点自身（LYJWPAGE）**：仓库统计、贡献者与最近提交；下面是状态页式的两行在线状态——`lyjw.me` 看采集 Worker 每分钟的在线探测，`Core` 看 core Worker 定时一轮的心跳，各带 30 天每天一格和可用率；再往下是 PageSpeed 实验室分与真实访客的 Users 分，以及各服务 12 小时的请求、CPU、报错数，落地节点上两个常驻上报器的推送次数、往返延迟与线上版本。

## 关键设计

### 首屏快照与实时更新分开处理

首页生成时按卡并行读取各模块的端点，每条状态读取由 `StatusSnapshot` 入口按 `page:<标签>` 缓存，让首次展示不依赖浏览器逐张卡片请求数据。实时卡读状态核心，可滞后卡读 KV，任何一张都不在请求路径上现拉外部 API。首屏从各视图缓存并行读取数据；整页缓存命中时无需重新取数，冷缓存渲染仍会等待所需视图。

页面加载后，实时卡各自回源校验一次、之后由推送与轮询更新；可滞后卡直接用首屏那份，之后在写入方的下一次预期写入之后几秒去取（节奏登记在 `shared/status-views.ts` 的 `cadenceMs`，排期见 `src/lib/poll-schedule.ts`）。首页缓存只在布局变化时（卡片出现或消失、换形态、行数变化，判据见 `shared/home-layout.ts`）按标签清除，下一次请求重新渲染；读数、标题、进度这类内容变化交给 `StatusSnapshot` 视图快照的缓存期限（`src/lib/site-policy.ts` 的 `STATUS_CACHE_CONTROL`，各视图统一，不随 `cadenceMs`）自然过期，纯心跳不触发重建。

因此，缓存页面负责首次展示，客户端负责追上当前状态；不要求每次设备变化都同步刷新整页 HTML。

### 推送、轮询与本地推算各有分工

切歌、前台应用切换、设备插拔等事件通过 WebSocket 推送。多数事件直接携带新数据并写入 SWR 缓存，避免每个访客收到通知后再发起一次相同查询。

功率曲线、累计用量等连续指标按需轮询，播放进度则根据时间锚点在浏览器本地推算。推送连接正常时，推送覆盖整份的实时卡只保留兜底轮询（`src/lib/poll-schedule.ts` 的 `PUSH_SAFETY_NET_MS`），断开时回到卡片自己的快间隔，重连后回源一次带推送事件的视图（页面在后台时等回到前台再取）；客户端的新鲜度检查防止较旧的轮询结果覆盖已收到的新状态。

### 不同来源共享状态与故障边界

设备协议和第三方接口由各自的采集器适配，页面消费统一的公开状态模型，不直接依赖家庭内网服务。

状态读改写在 Durable Object 内串行合并并持久化。单个数据源不可用时，通过统一的状态响应让对应卡片降级，而不是让整页等待所有设备在线。

上报写入需要鉴权，公开查询只返回明确的展示模型，服务端凭据与公开状态分开处理。

### 站点与 Worker 分头部署，旧页面遇到新数据只降级一张卡

Worker 和站点各自部署，浏览器里又可能放着几小时甚至几天前的旧标签页：旧脚本会读到新形状的数据。每张卡外面各有一层错误边界（`src/components/card-boundary.tsx`），一张卡渲染抛错只有那一格退成 Unavailable，并带着卡片名经 `/relay` 报一条错误（同一张卡同样的错一轮只报一次），别的卡和整页照常。兜底卡片上有 Retry，页面没过期时还会自动重试几次（间隔见 `src/lib/card-recovery.ts` 的 `RECOVERY_DELAYS_MS`，页面在后台就等回到前台）；重试前先主动取一份此刻的数据写进这张卡读的 SWR 缓存（取不到的键退回清掉缓存），否则重新挂载会拿着让它崩的那份数据（连首屏那份也算）在渲染阶段再抛一次，连回源都跑不到。取数途中这个键若被推送或同键别的卡的轮询写进了更新的值（按 `src/lib/status-reads.ts` 的 `writeGeneration` 判，没有时间戳的键也一样），或者这张卡已经卸载，这一份就不再写，慢回来的响应盖不掉更新的值。页面已经知道自己旧了（`/api/version`，以及新版本部署完成后的 `version` 推送），且重取当前页面时 HTML 头部的 `build-commit` 已是新版（边缘缓存还在回旧 HTML 时不算旧，免得刷新后版本提示又弹，判定见 `src/lib/app-version.ts` 的 `resolveVersionStatus`）时，躺在后台的旧标签页会自己刷新成新版；前台只提示（顶部的版本提示卡，兜底卡片上的说明），不自动刷，免得一张卡出错就打断人在别处的操作，只有整页被错误页顶替时才前台刷新。每个目标版本一轮最多试 `AUTO_RELOAD_MAX_TRIES` 次，账按目标分别记而不是只记最后一个（`lyjw131.com` 的首页 HTML 由 ESA 缓存，刷回来可能还是旧的，版本接口在两个版本间来回也刷不成环）；试满的目标要等 `AUTO_RELOAD_RETRY_AFTER_MS` 才清零重来，边缘缓存恢复后还能刷到它；同一个标签页两次自动刷新至少隔 `AUTO_RELOAD_COOLDOWN_MS`（以上常量都在 `src/lib/app-version.ts`，系统时钟被拨回过时冷却从现在重新数），播放器在放音乐时不刷。判定逻辑见 `src/lib/app-version.ts` 的 `autoReloadDecision`。

旧标签页还有一种坏法，连脚本都轮不到跑：iOS Safari 回收了后台标签，切回来时按缓存取回旧 HTML，它引用的带指纹 CSS / JS 在新版本部署后已经不在静态资源里，页面没了样式，首页那些铺满父元素的图片按视口叠满整屏。Workers 静态资源只留当前版本，所以 site 的生产与预览构建把 `build/client/assets` 整份存进 R2（`scripts/archive-site-assets.mjs`），生产上当前版本缺的 `/assets/*` 由 site Worker 从存档读出（`src/lib/asset-archive.ts`；分支 Preview 没有 R2 绑定，不读存档），旧页面照常加载。存档前缀有 30 天过期规则；`site` Worker 全部历史版本与 Vercel 仍保留的生产部署里的带指纹文件另外回填在不过期的 `site-assets-legacy/` 下（`/assets/` 与 `/_next/static/` 按原路径存放），缓存了很久的旧 HTML 也取得到。更早的 Vercel 部署已被删除，构建时间又写进了 JS 文件名，重建对不上，所以 `/_next/static/` 下缺档的脚本由 Worker 换成一段刷新脚本（`src/lib/asset-archive.ts#STALE_NEXT_SCRIPT`），旧页面自己换成新版本。存档也没有时，`<head>` 里在样式表之前的内联脚本（`src/lib/asset-recovery-boot.ts`）兜底：站内样式表、modulepreload 或模块脚本加载失败时，先强制重取当前页面把 HTTP 缓存里的旧 HTML 换掉，再刷新一次；同一版本冷却期内只救一次，刷回来还坏就停手。

### 窗口标题在上报之前先过一道判断

窗口标题是页面上唯一一项窗口内容，也是唯一一项不能靠规则穷举的内容：应用名就那么多个，标题却是此刻打开的文件、网页或聊天对象。所以它在离开 Mac 之前先过一道隐私判断，由 [TypeSafe](https://www.typesafe.ai/) 的 Jev 参与判断能不能公开，拿不准的留给本人在 Mac 上决定；只有放行的标题才进上报信封。站点这一侧不参与判断，只认信封里有没有标题。

### 根据活动与访问情况调整开销

部分采集器根据设备活动和访客连接情况调整上报频率；浏览器标签页不可见时暂停状态轮询。WebSocket 使用 Hibernation API，让连接在没有业务事件时保持而无需实例持续运行。

实时推送连接与可见访客计数分别维护：前者关注状态同步，后者关注此刻正在查看页面的人数。

### 图片按内容寻址，交付域由访客域名的边缘决定

海报和应用图标由上报器一次压好、以 `<sha256>.<ext>` 直传 R2，状态里只存对象键。Worker 和站点把对象键拼成同源路径 `/img/<对象键>`，页面、状态 API 和推送里都不出现交付域。

`/img/*` 由 `site` Worker 的 R2 绑定直出：整份对象流式返回并带一年不可变缓存头，平台缓存层负责 Range 切片与条件请求。`lyjw131.com` 上由 ESA 按静态后缀缓存同一路径并回源，中国大陆访客不再直连 Cloudflare。对象带一年不可变缓存，地址即内容指纹，所以两层边缘都不需要主动刷新。

### 报错与性能交给 Workers Observability

五个 Worker（`site`、`core`、`ai`、`ingress`、`collector`）都开着 Cloudflare Workers Observability：日志、1% 采样的 Traces、Workers Issues（未捕获异常、5xx 与 `console.error` 自动归组），Worker 包的 source map 随部署上传，线上调用栈能对回源码。浏览器端没有 SDK：[`src/lib/error-report.ts`](../src/lib/error-report.ts) 接住 `error`、`unhandledrejection`、水合回退和两层错误边界，经 `/relay` 发给 site Worker（`lyjw131.com` 的页面和 API 调用一样直连 `lyjw.me`，不经 ESA，限流按的是访客自己的 IP），[`src/lib/error-relay.ts`](../src/lib/error-relay.ts) 校验、去掉页面地址和消息与调用栈里 URL 的查询串后记成 `[browser-error]` 日志，归进 `site` 的 Issues（断网类 fetch 拒绝和 ResizeObserver 循环提示查不出原因，只记 warn，不进 Issues；`/relay` 拒收别的网站发来的报告，再按 IP 限流，绑定 `RELAY_LIMIT` 在 `wrangler.jsonc`）；浏览器包不出 source map，调用栈是压缩后的代码。本地默认不上报，要试就在 `.env.local` 设 `PUBLIC_ERROR_REPORT_DEV=true`。

健康数据回到页面上自己算：采集 Worker 每分钟探测一次 `lyjw.me/api/version`，core Worker 每跑完一轮定时任务记一次心跳，两者都按小时累进 D1 的 `health_buckets`；`site-health` 任务每 5 分钟把它们汇成 30 天每天一格与可用率，再加上 Workers Observability 的报错数（采样估计）与 active issue 数、Web Analytics 的真实访客 Web Vitals，写进可滞后层给站点卡片（`/api/status/health`，计算在 [`shared/health.ts`](../shared/health.ts)）。在线状态分两行：`lyjw.me` 那行只说明前端还在出页面；`Core` 那行看 core Worker 的心跳，每一轮都要经过 Worker 和 Durable Object，补上后端那一截。探测、心跳的驱动和汇总都在采集 Worker 里，它的 cron 一停三者一起停，卡片显示过期而不是失败；探测从 Cloudflare 内部发出，Cloudflare 整体故障时这一行看不出来。排查线上报错时 agent 先经 Cloudflare MCP 查证据再读代码，规矩写在 [`AGENTS.md`](../AGENTS.md)。
