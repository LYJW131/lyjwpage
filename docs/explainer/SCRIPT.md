# lyjw.me 运行原理 · 分镜与旁白（成品版）

讲解：Claude（Opus 5.5），造型按 Claude Code 2.1.281 源码里的官方 Clawd 逐格还原，动作只用官方的
default / look-left / look-right / arms-up / 蹲下 + 烟尘，以及官方入场序列（skip / jump / look / celebrate）。
100 BPM，2.4 秒一小节；章节长度与 music.js 的 PLAN 一致，共 130 小节 ≈ 5 分 13 秒。
配乐四种（music.js 的 STYLES：芯片 / 钢琴独奏 / Lo-fi 电钢琴 / 尤克里里拨弦），和弦、段落、章节提示音都跟同一份 PLAN 走；成片页开场让观众选，播放中底栏可切，切换不丢进度。每种先校到 −17 LUFS 再叠同一条画面音效轨（芯片配方波音色，其余三种配柔和音色）。
事实依据：三份代码阅读报告（workers/api、站点缓存与浏览器、各上报器），以代码为准，文档过时处不采用；2026-09-25 按 main bf6c14b（接入 Sentry、常驻上报器改写、部署后推 version）重核一遍。

| 章 | 小节 | 时长 | 配乐 |
|---|---|---|---|
| 00 序章 | 12 | 28.8s | 前奏 → A1 → A2 → B2 |
| 01 采集端 | 20 | 48.0s | A1(轻) → C1 → A2 → B1 → B2(半拍、柔) → B2 |
| 02 状态中枢 | 20 | 48.0s | D1 铃声律动 ×2 → A1 → C2 → B1 |
| 03 首屏缓存 | 14 | 33.6s | A2 半拍 → C1 → B1 → B2 |
| 04 实时推送 | 16 | 38.4s | A1(16 分琶音) → A2 → C2 → B1 |
| 05 大陆访问 | 8 | 19.2s | 升 D 调：A1 → A2 |
| 06 图片链路 | 8 | 19.2s | B1(轻) → C1 |
| 07 自适应调频 | 10 | 24.0s | D1 → A2 → B2 |
| 08 站点自检 | 8 | 19.2s | C2 → B1 |
| 09 回顾 | 14 | 33.6s | A1 → A2 → B1 → 尾声（落 Dmaj9） |

## 00 序章
- 终端窗口：`$ claude` → 欢迎框里小 Clawd 按官方 skip 蹦进来，旁边 “Claude Code / Opus 5.5 / ~/lyjwpage”。
- 4.8s（旋律进）Clawd 从终端里跳出来，落到舞台上（落地烟尘）。
- 「嗨！我是 Claude（Opus 5.5），\n带你拆开 lyjw.me 看看。」
- 9.0s 标题：像素字 lyjw.me + 「这个主页，是怎么运转的？」，随后缩进顶栏。
- 12.4s 主页窗口（真实布局），设备标签弹出。「卡片上的数据，\n来自主人身边的真实设备。」
- 充电卡片演示：拔掉消失、插上出现。「充电卡片只在充电时出现。」
- 三段总览：采集端 → 状态中枢 → 展示端，主页窗口缩进展示端。「链路分三段：采集、中枢、展示。」

## 01 采集端 —— 七个上报器，守在数据产生的地方
- 七张来源卡：Mac Telemetry Hub（菜单栏 App：前台应用、窗口标题、Apple Music、蓝牙充电设备、编码用量）/ iPhone Telemetry Hub（HealthKit 唤醒：活动圆环、最近训练）/ Home Assistant（HomePod 正在播放、PS5 电源）/ Emby 上报器（NAS 容器）/ 服务器上报器（东京 misaka-jp 容器）/ 限额上报器（同一台，各家编码工具限额）/ PlayStation 上报器（Cloudflare Worker，每分钟醒一次）。
- 旁白：来源各自守一个数据源；有 App、有容器、还有一个本身就是 Worker。
- Mac 信封：`{version:4, presence, heartbeatAt, activeModules, modules:{desktop, appleMusic, chargingDevices…}}`；只放变了的模块；没变化每 90 秒发一个空信封报平安。
- 快车道：切歌、切应用立刻发（切应用先等 400ms 落定）；实测按下播放到网页变化不到半秒（320–490ms）。
- 窗口标题：上报前先过隐私判断（Jev 参与），拿不准的交给主人在 Mac 上决定，只有放行的进信封。不写判据。
- 左下角 Jev 介绍面板（挂在「隐私判断」卡下方）：TypeSafe AI 的 System One 模型，按官方说法「状态进、概率出，几道问题一次答完，不逐字生成」，标「官方 70–500 ms」；每次扫描时几道「问题」一起转条纹，扫完同一刻一起给出概率条（示意数值，和点亮哪条出路无关；不标字母、不标数字，末尾一行「⋯」表示还有）；对照一行「LLM · 示意」每秒十几个字往外冒、一路往左滚，整段结束也没写完。
- 判断和通知走完后多留 2 小节给 Jev：上面的流程压暗、面板描紫边，「Jev 的概率是校准过的：说九成把握，大约九成会对。」（官方 RLCD「calibrated decisions / higher confidence means higher accuracy」的通俗释义，不是原话；只讲模型本身）。同样不写判据。
- 图片：在源头压一次，按内容哈希直传 R2，信封里只带文件名（objectKey）。

## 02 状态中枢 —— API Worker 和 StateHub
- 关卡：Bearer 密钥（timingSafeEqual）→ 401；≤4 MiB、JSON、信封格式（version 4 / heartbeatAt / activeModules / presence）→ 400；在普通 Worker 里整理，不碰数据库（Emby 还会 HEAD R2 确认海报在）。
- StateHub：全站唯一的 SQLite Durable Object（idFromName("global")），commitIngest 排进同一条队列，七个来源逐个提交；entries / fields / samples 三张表；写进磁盘才回 202。
- 效果清单：DO 不发网络请求，只交回「要做的事」；Worker 回完 202 在 waitUntil 里照单执行：先广播（LivePushRoom），再按需通知 Vercel（POST /api/revalidate，仅布局变化）；空心跳什么都不做。

## 03 首屏缓存 —— Vercel 上的 Next.js
- 访客打开 lyjw.me，Vercel 直接给缓存好的 HTML。
- HTML 由一次 GET /api/home 生成：Worker 24 个读取并行，某个来源挂了只让那张卡显示不可用（ok:false，HTTP 仍 200）。
- `'use cache'` + cacheLife(stale 300 / revalidate 600 / expire 7 天)，整页一条缓存、17 个 page: 标签。
- 过 10 分钟：下一位访客先拿旧页，后台重建（不是定时任务）。
- 布局变化（充电格亮灭、在听主卡出现消失……）才让 Worker 通知失效；revalidateTag(…, "max")：旧页照给，新页后台做。
- 小变化交给浏览器追。

## 04 实时推送 —— 浏览器直连 Worker
- 挂载后直连 Worker，不经 Vercel。
- 前 15 秒，十几张卡片的首次读取合并成一个 /api/home（5 秒超时）。
- WebSocket（wss://…/ws）推送带数据，写进 SWR 缓存（revalidate:false），卡片当场更新。
- 连续数据按节奏轮询（充电 30 秒、服务器 30 秒、编码 2 分钟……），标签页隐藏就暂停。
- 时间戳挡旧：慢回来的旧轮询盖不掉新推送。
- 播放进度：位置 + (现在 − 观测时间)，浏览器自己算；歌词逐字高亮。

## 05 大陆访问 —— lyjw131.com 和阿里云 ESA
- lyjw131.com → ESA 边缘（首页 HTML、带哈希的静态 JS、/img）→ 回源 lyjw.me。
- 首页 Cache-Control: max-age=300, stale-while-revalidate=86400, stale-if-error=86400：5 分钟内命中，过期先给旧页、后台回源。
- 发版：Vercel 生产部署成功 → GitHub Actions 调 PurgeCaches 刷首页 → 预热 → 等两个域名的 /api/version 都答出新版 → POST /api/internal/site-deployed → Worker 不经 StateHub、直接往推送房间广播 version → 页面重问自己域名的 /api/version，顶上弹出 UPDATE 卡。实时数据照样直连 Cloudflare Worker。

## 06 图片链路 —— 按内容寻址
- 文件名 = sha256(内容)，内容变名字就变。Mac 图标 96×96 PNG；Emby 海报 WebP。
- 页面只写同源 /img/<哈希>：lyjw.me 由 Vercel 边缘 rewrite 到 R2 并缓存；lyjw131.com 由 ESA 缓存同一路径。
- immutable，缓存一年，不需要刷新。

## 07 自适应调频 —— 有人在看，才值得勤快
- 两个计数器：API Worker /count（connections：开着的页面，含后台）；在线人数 Worker /count（online：正在看的页面）。
- PlayStation / 限额两个上报器按人数调档：有人在看 → 快档（约 1 分钟 / 5 分钟）；只开在后台 → 中档（约 2 分钟 / 10 分钟）；没人 → 闲档（约 30 分钟 / 60 分钟），期间定时醒来再问（PS 每分钟 cron；限额每 5 分钟），有人来就提速（PS 在后台连接归零后不再跑，清晨第一次 cron 发现有人就跑）。一边查询失败只把那一边当 0，只会变慢不会变快。
- 服务器上报器是对照行：2026-09 起改写成 TypeScript，固定每分钟推一封、不问人数（上报走 api Worker 后，三档每天要问约 2880 次人数，固定推才 1440 次）；夜里只有它的心形还在跳。小睡卡换成限额上报器（12 次 5 分钟小睡）。
- 推送连接用 Hibernation API，ping/pong 由运行时自动应答，不唤醒 DO。

## 08 站点自检 —— 报错和在线，交给 Sentry
- 两个方向相反的信号：Sentry 每分钟来敲门（在线探测 HEAD /api/version，只说明 Vercel 还在出页面）；Worker 每 5 分钟去报到（cron 仍每分钟跑，2026-09-25 起只有整 5 分钟那一轮包上 Sentry.withMonitor，跑完才报；途中叫 StateHub 排队重建读模型，KV 是之后 DO 定时任务才写的，所以心跳证明的是 cron 和 DO，不含 KV——README 与卡片悬停提示写了 KV，以代码为准）。
- Worker 用只读令牌取回报错、在线、性能等结果，进 KV 读模型，经 /api/status/sentry 变成 LYJWPAGE 卡片上的两行在线状态（30 天一天一格、Operational；卡片下的两行中文是讲解标注，真实卡片没有）；之后每次敲门 / 报到，今天那一格亮一下。
- 结尾 Clawd：「线上出错时，我先来这儿查证据。」（AGENTS.md：排查线上报错先经 Sentry 查证据再读代码）
- 不上画面：组织名、探测器 ID、真实报错标题与可用率数字；令牌只说「只读」。

## 09 回顾 —— 一首歌的旅程
- Mac 切歌 → POST /api/ingest/mac → 鉴权、校验 → StateHub 提交 → 202 → LivePushRoom 广播 → 所有开着的页面换歌名（实测不到半秒）。Clawd 骑着数据包走完全程。
- 片尾：谢谢观看 · 讲解 Claude Opus 5.5 · lyjw.me。
