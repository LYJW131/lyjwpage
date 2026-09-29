# lyjw.me 运行原理 · 分镜与旁白（v2）

> 类型：reference

新版 `/explainer`（`v2/`，全篇 2D）的分镜。三样东西以这里为唯一出处：**章节表**（每章小节数，`v2/plan.js` 抄这里）、**每一段的画面要点**、**中英旁白原文**（各章文件顶部的 `I18N.add` 抄这里）。事实出处在 [FACTS.md](FACTS.md)，画法、母题与调色板在 [TREATMENT.md](TREATMENT.md)，写章的契约在 [v2/CONVENTIONS.md](v2/CONVENTIONS.md)。

- **节拍**：108 BPM，4/4，一小节 20/9 秒（约 2.22 秒）。小节从 0 数，章内写「小节:拍」，拍也从 0 数：5:2 是第 5 小节的第三拍；表里「2–5」指第 2 小节开头到第 5 小节开头。
- **主角**：Mac 上的一次换歌（`mac · appleMusic`）。片子跟着这封信封，从 Mac 一路走到访客屏幕上那张「正在听」卡片翻面。
- **旁白**：每句两行，逐字亮起，排在图版里，不是字幕，也不是 Clawd 的气泡。按 60 px、`maxW` 1040 排：中文每行不超过 17 字，英文每行不超过 36 个字符（Geist 60 px 平均约 28 px 一个字符），再长会被缩到 56 px 以下。改旁白先改这里，再改章节文件。
- **Clawd**：只在开场、第 02 章开门、第 03 章心跳、第 08 章收尾、片尾出场（第 07 章可选一次），说的话放在气泡里，不算旁白。
- **不上画面**：见 [v2/CONVENTIONS.md](v2/CONVENTIONS.md)「事实」一节。编码用量只讲到「Mac、云端、容器里的 Cursor 各报原始事实，站点侧合并；Pulse 上有一条 token 速率」，不点存储键和模块名。

## 章节表

小节数已锁定。要改，先改这张表和总长，再由主创改 `v2/plan.js`；两边不一致时 `v2/film.js` 报错并以 plan.js 为准。

| 章 | 图版 | 底 | 小节 | 起止（小节） | 起止（时间） | 交给下一章 |
|---|---|---|---|---|---|---|
| 00 | 这张卡片从哪来 | 暗 → 纸 | 10 | 0–10 | 0:00.0–0:22.2 | 冲进总览图「采集端」那一栏，10:0 硬切暗底 |
| 01 | 野外观测站 | 暗 | 20 | 10–30 | 0:22.2–1:06.7 | 信封火花往右飞出画面；硬切纸面，火花从左边进场 |
| 02 | 门禁与分拣 | 纸 | 16 | 30–46 | 1:06.7–1:42.2 | 冲进「状态核心已提交」那盏灯，整屏橙色后落黑（已做） |
| 03 | 一间屋子的账房 | 暗 + 白卡 | 16 | 46–62 | 1:42.2–2:17.8 | 冲进对照表白卡下方的空白，满屏是纸，不落黑（已做） |
| 04 | 活字印版 | 纸 | 12 | 62–74 | 2:17.8–2:44.4 | 推进「在听」那块印版，12:0 硬切暗底 |
| 05 | 电报线 | 暗 | 18 | 74–92 | 2:44.4–3:24.4 | 示波线拉平成一条直线，硬切纸面，成了地铁图上的一条线 |
| 06 | 两条线路 | 纸 | 14 | 92–106 | 3:24.4–3:55.6 | 线路往右延伸，镜头横移到节拍器那张纸（同为纸面，不切） |
| 07 | 节拍器 | 纸 | 12 | 106–118 | 3:55.6–4:22.2 | 服务器那台的一响变成心电图上的尖峰，硬切暗底 |
| 08 | 心电图与地层 | 暗 | 12 | 118–130 | 4:22.2–4:48.9 | 镜头从地层升回地面，接横向长图版 |
| 09 | 一首歌的旅程 | 长图版，各格用原章的底 | 14 | 130–144 | 4:48.9–5:20.0 | 收回第 00 章第一帧，首尾相接可循环 |

合计 144 小节，5 分 20 秒；配乐另有 2 秒尾音（`Score.tail`）。

交接默认是强拍上硬切；表里写了做法的，由前后两章的作者按它对一次。每章的配乐也要照顾自己的首尾两拍（见 CONVENTIONS「交接」）。

## 00 这张卡片从哪来（10 小节）

事实：FACTS「一句话总览」。画面标题「这张卡片从哪来 / Where does this card come from?」。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–2 | 暗底终端，Geist Pixel 字、闪烁光标：`$ claude` 逐字敲出，欢迎框里 Clawd 按官方入场（skip → jump → look → celebrate）蹦进来，气泡「带你拆开 lyjw.me 看看。」。这一帧也是全片最后一帧 | 只有 pad 和打字声 |
| 2–4 | 2:0 硬切纸面：站点主页用发丝线画出来（正视线框，卡片按首屏真实布局的比例排，出处 `src/lib/home-layout.ts` 和首页组件）；镜头推到「正在听」那张卡 | 2:0 主题第一次出场 |
| 4–6 | 4:0 歌名纵向压扁再弹开，换成新歌；一个橙点落在卡上；大字标题「这张卡片，是怎么知道的？」 | 4:0 翻面一记 |
| 6–7.5 | 标题收小到左上，旁白 `n1` | |
| 7.5–10 | 镜头顺着橙点身后那根线往回拉（纯缩放），拉出总览图：采集端 → 中枢 → 展示。中枢分三块：入口 ingress、状态核心 api、采集 Worker collector；下面挂着四个库的符号（`K.glyph`：屋子、格子墙、档案架、带锁的抽屉）。旁白 `n2`。9:2 起冲进「采集端」那一栏 | 律动进来，最后一拍收住 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch00.clawd`（气泡） | 0.5–2 | 带你拆开 lyjw.me 看看。 | Let me open up lyjw.me for you. |
| `ch00.q`（标题） | 4.3–7.5 | 这张卡片，是怎么知道的？ | How does this card know? |
| `ch00.n1a` / `n1b` | 6–7.5 | 跟着一封信走一遍：／Mac 上的一次换歌。 | Let's follow one envelope: / a song change on the Mac. |
| `ch00.n2a` / `n2b` | 8–10 | 链路分三段：／采集、中枢、展示。 | Three stretches: / sources, hub, screen. |

## 01 野外观测站（20 小节）

事实：FACTS §1。画面标题「野外观测站 / Field stations」，副标 `reporters/ · workers/collector`。一长条暗底图纸，镜头只做横移，每件仪器一个机位、强拍上甩；仪器是正视专利图（骨白发丝线、FIG. 编号引线、剖切斜线）。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1.5 | 标题；镜头从图纸左端起步。旁白 `n1` | |
| 1.5–3 | FIG. 1 笔记本（Mac Telemetry Hub，菜单栏 App）：屏幕上的 Apple Music 换了一首歌；旁边白卡详图逐字敲出信封 `{version:4, presence, heartbeatAt, activeModules, modules:{…}}`，modules 里只有 appleMusic 那格亮（橙）。旁白 `n2` | 主题（本章的乐器） |
| 3–4 | 没变化时：一个圆环缩放一次，是空信封的呼吸，标「90 s」 | |
| 4–5 | 切应用：一把平面刻度尺量出 400 ms 才落定，注「切应用先等 400 ms」 | |
| 5–6.5 | 窗口标题过 Jev：几道问题的横条同时走，同一刻一起给出概率条（示意值，不标数，不和出路对应）；放行的进信封，拿不准的弹给主人。旁白 `n3` | |
| 6.5–8 | 图片：一个应用图标的像素压成一串哈希 `sha256….png`，直接落进 R2 的抽屉；信封里只剩文件名（`objectKey`）。旁白 `n4` | |
| 8–9.5 | FIG. 2 手机（iPhone Telemetry Hub）：HealthKit 把它唤醒，报活动圆环、训练、五分钟步数桶 | |
| 9.5–11 | FIG. 3 客厅：HomePod 在放什么、PS5 的电源开关，两样都经 Home Assistant（它那把钥匙在第 02 章开两扇门） | |
| 11–12 | FIG. 4 NAS 机箱：emby-reporter 容器报在看什么，海报先传 R2 | |
| 12–13.5 | FIG. 5 东京的机柜，两台容器：server-reporter（服务器状态，固定每 60 秒）、agents-reporter（各家编码工具的限额、Cursor 账号的用量） | |
| 13.5–14.5 | FIG. 6 云端的一小段遥测：Claude Code 云端自己发 OTLP，是第七个入口，不是我们写的上报器 | |
| 14.5–16 | 编码用量：Mac 本机、Claude Code 云端、容器里的 Cursor 三处各报原始事实，三根线汇到站点那一侧才合并；合并处伸出一小段 Pulse，多一条 token 速率道（三处相加）。旁白 `n5` | |
| 16–19 | FIG. 7 表盘：采集 Worker，每分钟一响；每根指针一个任务，各走各的节奏（最近在听、GitHub、Vercel、Cloudflare、Sentry、PageSpeed、厂商状态；指针数按 `workers/collector/src/registry.ts#JOBS`）。PlayStation 不在这张表盘上。旁白 `n6` | 钟摆每拍滴答 |
| 19–20 | 镜头甩回 Mac：那封换歌的信封亮起，拖着发丝线往右飞出画面 | 收住，给第 02 章 0:0 的主题让路 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch01.n1a` / `n1b` | 0.3–1.5 | 六个上报器守在数据的源头，／外加每分钟一响的采集 Worker。 | Six reporters sit at the source, / plus a minute-by-minute collector. |
| `ch01.n2a` / `n2b` | 2–4 | Mac 只寄变了的那几格；／没变化，每 90 秒寄个空信封。 | The Mac mails only what changed; / no news: an empty one every 90 s. |
| `ch01.n3a` / `n3b` | 5–6.5 | 窗口标题先过 Jev：／拿不准的交给主人，放行的才进信封。 | Jev screens window titles first; / unsure ones go to the owner. |
| `ch01.n4a` / `n4b` | 6.5–8 | 图片按内容起名，直接放进 R2；／信封里只写文件名。 | Images are named by their content / and go straight to R2. |
| `ch01.n5a` / `n5b` | 14.5–16 | 编码用量：三处各报原始数，／合并在站点这边做。 | Coding usage: three raw reports; / the site does the merging. |
| `ch01.n6a` / `n6b` | 16.3–18.5 | 采集 Worker 每分钟醒一次，／每个任务按自己的节奏去取。 | The collector wakes every minute; / each job keeps its own beat. |

英文 `n3` 少了「放行的才进信封」：画面上 Jev 放行的那条线进信封，标注「放行的才进信封 / only cleared titles go in」。

## 02 门禁与分拣（16 小节）

事实：FACTS §2。已做，是全片标杆；下表按 `ch02.js` 和 `v2/music/ch02.js` 的现状写。一张 3840×2160 的纸面图纸分四格，镜头在强拍上甩到下一格。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1.6 | 标题「02 门禁与分拣」、`ingest.homepage.lyjw.llc · workers/ingress`、`POST /api/ingest/…`；一墙八扇门画出来；Clawd 跳上标题线说一句；信封火花从左边走向 /mac | 0:0 拨弦唱主题，前奏只有 pad 和零星打字声 |
| 1–3 | 权限表 ACCESS_CLIENTS 八行（mac … github-actions）；mac 的钥匙从自己那行滑到 /mac，2:0 转开门、2:3 关上。旁白 `n1` | 2:0 钥匙 |
| 3–5 | emby 的钥匙去开 /mac，3:2 盖 403；4:0 Home Assistant 的钥匙同时开 /homepod、/playstation，标「Home Assistant 的钥匙开两扇门」 | 3:2 印章，4:0 两把钥匙 |
| 5–8 | 甩到检查单：六项在 5:0、5:2、6:0、6:2、7:0、7:2 逐项打勾（方法是 POST · 认识这个来源 · Access 凭证 RS256 / aud / iss / exp · 不超过 4 MiB，按实际读到的字节 · 是 JSON · prepare），右栏拒收码 405 / 404 / 401·403·503 / 400 / 400 / 400·503；右边那封信跟着亮出 POST、路径、JWT、称重、花括号，7:2 拆开。旁白 `n2` | 每项一声「叮」，音高 A C D E G A |
| 7.6–8.3 | 反例：一封 `<html>` 飞进来，8:0 盖「400 不是 JSON」 | 8:0 大章，全场一顿 |
| 8.8–11.6 | 甩到分拣台：四根管子（凭据 KV CREDENTIALS · 归档 D1 HISTORY · 可滞后 KV LAG · 实时 CORE.commitIngest），管底是四个库的符号；9:0 mac 的 desktop / appleMusic / chargingDevices 进实时，9:2 timezone 进可滞后，10:0 iphone 的 workouts 可滞后、归档各一份，10:2 musicUserToken 进凭据；服务器那封整封一分为二，11:0 进可滞后和归档。旁白 `n3` | 9:0、9:2、10:0、10:2 气动管，11:0 分叉 |
| 12.8–15 | 甩到三盏灯：13:0 状态核心已提交、13:2 LAG 已写、14:0 凭据已写；14:3 D1 那盏在远处软软亮起（后台 · 不等），线不接上；15:0 盖「202 Accepted」；脚注「改这张单子只需重新发布入口：状态核心不重启，连接不断。」。旁白 `n4` | 灯音 A5 D6 F6，D1 唱 E6；15:0 大章 |
| 15–16 | 拉远看整张图纸（PLATE 02 · INGRESS），冲进「状态核心已提交」那盏灯：整屏化成橙色，落黑 | 15:2 下坠，被吸进第 03 章 0:0 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch02.clawd`（气泡） | 0.95–2.45 | 上报都从这面墙进来。 | Every report comes in / through this wall. |
| `ch02.n1a` / `n1b` | 1.4–3.2 | 每个来源一把钥匙，／只开权限表上写着的门。 | Each source gets one key; / it opens only its own doors. |
| `ch02.n2a` / `n2b` | 4.9–6.4 | 进了门，／按这张单子逐项检查。 | Once through the door, / checked item by item. |
| `ch02.n3a` / `n3b` | 8.95–10.4 | 查完拆开，／按数据层分进四根管子。 | Then it is opened / and sorted into four tubes. |
| `ch02.n4a` / `n4b` | 12.95–15 | 三盏灯都亮了，／才盖 202。 | Only when three lamps are lit / does it stamp 202. |

## 03 一间屋子的账房（16 小节）

事实：FACTS §3。已做；下表按 `ch03.js` 和 `v2/music/ch03.js` 的现状写。一张暗底平面图，三个机位（A 屋里、B 门外、C 拉远），空间用平面图交代，含义交给白卡详图。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–2 | 黑里先亮一盏桌灯（接第 02 章冲进去的那盏灯），平面图一笔一笔画出来：左边两路进口（上报入口、采集 Worker）汇成一条队，栏杆只围出一条；中间一间屋子（墙体剖切斜线、门洞、一张桌、一把椅子、一盏灯、一本摊开的账本），右墙一道缝；标题「03 一间屋子的账房」、`workers/api · StateCore → StateHub`；引线标注 `StateHub · idFromName("global")`「全站只有这一个实例」。旁白 `n1` | 0:0 落地一声低「咚」，FM 铃唱主题 |
| 2–5 | 每拍一封进门落账，右栏「StateHub 账本」详图每拍写一行打勾（mac · desktop、homepod · nowPlaying、emby · watching……；playstation 那几封从上报入口那一路来，容器 POST 的原始信封）；屋里标 `state-hub.ts · ingestTail`；主角 mac · appleMusic 带着橙色火花在队里等。旁白 `n2` | 底鼓每拍，十六分钟摆 |
| 5–6 | 5:0 主角落账；托盘上出一张小纸条，右栏「要做的事」固定三行 event / listening / tags：listening 写「广播 listening-now · 先查 Apple 目录补封面和链接」，tags 空着「换歌不失效；开始或停止放歌才有」，方框不勾。旁白 `n3` | |
| 6–8 | 6:0 纸条从墙缝递出，镜头甩到门外岗亭 StateCore「照单去办」；6:2 盖 waitUntil 章、listening 打勾；同一拍两条虚线出发：去天线 LivePushRoom（另一个单例 DO），橙环荡开，所有开着的页面依次翻面、标 listening-now；回执 `ok · data` 飞回入口，标「回执 → 入口」「入口接着写 LAG 和凭据，都写完才盖 202」，两条路中间「‖ 并行 ‖」。旁白 `n4` | 6:0 纸滑出，6:2 广播 + 印章 |
| 8–10.5 | 甩回屋里：又进两封（playstation、emby），9:0 一封纯心跳（信封上一颗心跟着底鼓跳）：账本记「♥ 存活 + pulse 观测」，「要做的事（空）」注「不推送」「不失效首屏」；Clawd 在桌角冒出来说一句。旁白 `n5` | 心跳段半速，底鼓变成扑通扑通 |
| 10.5–12 | 一封在线 → 离线（mac · presence）落账：「要做的事」写 event「广播 presence」、tags「失效 3 个标签 → Vercel，5 秒超时」；11:0 两项打勾，纸条递出，橙环从右边扫进来。旁白 `n6` | 11:0 翻转一记，11:3 吸一口气 |
| 12–15 | 拉远：屋子、岗亭、天线缩成「实时 · StateHub」一组；可滞后墙（带时间签的格子）、凭据抽屉、D1 档案架按拍从地平线升起（KV LAG、KV CREDENTIALS、D1 · lyjwpage-history）；右边白卡「四个库」逐行写上（实时 · 会推送 · StateHub（DO，SQLite）；可滞后 · 不推送 · KV LAG · 带 updatedAt；历史 · 长期保存 · D1 · lyjwpage-history；凭据 · 不公开 · KV CREDENTIALS）；14:2 脚注「pulse 时间线在屋里只放 7 天，每分钟归档进 D1」。旁白 `n7` | 12:0 律动全开，主题带和声完整唱一遍 |
| 15–16 | 15:0 图版外框「PLATE 03 · STATE CORE」；15:2 起镜头对准对照表白卡下方的空白，冲进去，满屏是纸 | 15:0 终和弦 Dm9 和一声低「咚」 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch03.n1a` / `n1b` | 0.6–2.15 | 全站只有这一间屋子，／唯一的状态 DO。 | The whole site has one room like this: / the one and only state DO. |
| `ch03.n2a` / `n2b` | 2.2–5 | 实时数据排成一队，／一次只记一封。 | Realtime data waits in one line / and is written one at a time. |
| `ch03.n3a` / `n3b` | 5–6.04 | 屋子自己不发请求，／只写一张「要做的事」。 | The room never makes a request; / it writes a to-do slip. |
| `ch03.n4a` / `n4b` | 6.3–8 | 门外照单去办：／广播和回执同时出发。 | Outside, the slip is carried out: / push and receipt leave together. |
| `ch03.n5a` / `n5b` | 9–10.5 | 纯心跳也记一行，／但不推送、不失效。 | A bare heartbeat still gets a line, / but pushes and invalidates nothing. |
| `ch03.clawd`（气泡） | 9.6–10.2 | 记一笔就好，／别吵醒大家。 | Just jot it down, / don't wake anyone. |
| `ch03.n6a` / `n6b` | 10.55–11.75 | 只有在线状态翻转，／才广播 presence、失效 3 个标签。 | Only an online/offline flip / pushes presence, invalidates 3 tags. |
| `ch03.n7a` / `n7b` | 12.3–16 | 实时在屋里，可滞后在墙上，／历史在架上，凭据在抽屉里。 | Realtime lives in the room, lag on the wall, / history on the shelves, credentials in the drawer. |

`n1`、`n7` 的英文超过 36 个字符：`n1a` 在 60 px 下缩到约 58 px；`n7` 排在缩放 0.66 的拉远机位上，世界坐标写 91 px、`maxW` 2600。屏幕上都不小于 56 px（`v2/tools/check.mjs` 核过）。

## 04 活字印版（12 小节）

事实：FACTS §4。画面标题「活字印版 / The type case」，副标 `Vercel · Next.js · first-screen.ts`。纸面，俯视一整页首屏：每条 `firstScreen` 缓存一块印版（一张卡读几个视图就切成几块，`src/app/page.tsx#READS`），按首屏桌面宽度的真实比例排成一条长版，块上写它的 `page:` 标签名，没挂标签的写端点末段（屏幕上不小于 28 px）；挂标签的块右上角吊一枚小标签。块数、带标签和不带标签的各几块，写章时按代码现数（`src/app/page.tsx` 里 `firstScreen` 的调用、`src/lib/status-views.ts#STATUS_VIEWS` 的 tag），旁白里不说数。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 接第 03 章的满屏纸往后拉：一整页印版现出来；标题 | 印刷机的重拍进来 |
| 1–3 | 出纸口递出一张印好的页：访客拿到的是缓存好的 HTML。旁白 `n1` | |
| 3–5 | 镜头顺着长版往下走，每块印版一根细线接到左右两条轨（实时 → DO，可滞后 → KV LAG），轨通到页底的库符号；脚注「`'use cache'` · stale 300 / revalidate 600 / expire 7 天」 | |
| 5–8 | 接第 03 章那次在线 → 离线：失效的 3 个标签对应页头、在听、充电头三块，被夹起（往上平移、投影变深），在强拍上按 stamp 模式重印、放回；同时出纸口照旧递出旧页，新页在后台印。旁白 `n2` | 每块重印落在一个重拍上 |
| 8–9.5 | 没挂标签的那几块，角上各亮一个 600 秒的圆形计时环。旁白 `n3` | |
| 9.5–11 | pulse 那块的计时走到头、回源碰上 503：那块印版不动，盖一枚「503 · 沿用上一份」章。旁白 `n4` | 印章 |
| 11–12 | 信封火花落到「在听」那块上，块亮一下但标签不亮、不夹起，注「换歌不重印：交给推送」（第 03 章：换歌不失效首屏）；镜头推进这一块 | 主题，11:3 吸一口气；12:0 硬切第 05 章 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch04.n1a` / `n1b` | 1–3 | 访客来了，递出一张印好的页；／每块印版各自缓存。 | A visitor gets a printed page; / every plate is cached on its own. |
| `ch04.n2a` / `n2b` | 5.2–8 | 一个标签失效，只重铸那一块；／旧页照发，新页在后台印。 | Invalidate a tag: recast one plate; / old pages ship while new ones print. |
| `ch04.n3a` / `n3b` | 8–9.5 | 没挂标签的几块，／只看 600 秒的定时器。 | The untagged plates / just wait out a 600-second timer. |
| `ch04.n4a` / `n4b` | 9.5–11 | 来源出错，那块印版不动，／继续用上一份。 | If a source fails, its plate stays, / and the last copy keeps going out. |

## 05 电报线（18 小节）

事实：FACTS §5。画面标题「电报线 / The live wire」，副标 `wss://…/ws`。暗底，一整条横向示波图，横轴是时间：时间轴只画先后，不标毫秒（没重测过），机位之间的「≈」是省掉的一段。signal 色的示波线就是这一页的 /ws 电报线（发光层）：进来的电报是往下的脉冲，掉出一张白纸条；页面发出去的（hidden）是往上的脉冲。线上面是源站那一边，线下面是浏览器这一边。六个机位（A 解析、B 到站、C 进度、D 两只钟、E 数人头、F 到货表），强拍上甩。live 绿第一次出现在这一章，只给在线人数。画面和配乐共用 `v2/ch05.js` 顶部的时间表 `AT`。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 一个亮点沿时间轴扫过去，身后一段余辉；标题 | 0:0 硬切进来一声低「咚」；踩镲敲摩尔斯 CQ |
| 1–3.5 | 一长条 HTML 一格一格解析（光点走过一格才亮一格）；2:0 `<script>` 那一格跑完，接上电报线 `new WebSocket("…/ws?visible=1")`；2:1、2:3、3:1 三封电报（online、desktop、playing-now）从脉冲尖上掉进托盘（`queue`）。旁白 `n1` | 2:0 接线一声灯；三封各一声电键；踩镲拼 WS、LIVE |
| 3.5–5 | 3:2 一道竖刻线 hydrate，`useLiveEvents` 接过这根线；3:3、4:0、4:1 托盘里的按到达顺序一封一封飞进去（1 2 3）。旁白 `n2` | 3:1 吸一口气到 3:2；重放一封一声叮 |
| 5–7 | 线上面的 LivePushRoom 广播下来：5:0 主角 listening-now 到站，写进 SWR 的 `/api/status/listening/now`（receivedAt 换成新的，Mono 注 `mutate(path, data, {revalidate:false})`）；5:2「Now Playing」卡片纵向压扁再弹开：夜に駆ける → アイドル。旁白 `n3` | 5:0 主题（闷音拨弦，长音拆成三下点）；5:2 翻面一记 |
| 7–8.5 | 一只慢回来的旧轮询（receivedAt 更早）顺着虚线爬回来，8:0 撞上时间戳闸门 `guardPolled` 被弹开。旁白 `n4` | 8:0 印章一记 |
| 8.5–10.5 | 线上没有消息。放大的「Now Playing」：进度条自己往前走，旁边竖写 `positionMs + (now − observedAt)`，now 标浏览器的钟、observedAt 标 Mac 的钟，注「只在播放时往前走」；歌词占位两行横条逐块亮。旁白 `n5` | 踩镲停下，只剩浏览器的钟一拍一响；铃跟着歌词块轻轻唱 |
| 10.5–12.5 | 两只正视钟面：线上面源站的钟停在 servedAt（只管首帧），10:3 挂载，虚线箭头穿过电报线交给线下面访客的钟；访客的钟一拍走一格，12:0 走到截止 `lastSeenAt + heartbeatWindowMs`，卡片上的在线点自己熄灭、换成 Offline，源站什么也没说。在线点画成 signal，不用 live 绿。旁白 `n6` | 12:0 远处很轻的一声 |
| 12.5–15 | 同一根线数两种人：这一页的窗口（页脚 Online now 用 live 绿）、线上面的房间和一张「数人头」白卡（connections：开着的，含后台；online：正在看的）；13:2 切到另一个标签页，只发一声 `hidden`（往上的脉冲），线不断；14:0 online 03 → 02（live 绿），connections 不变。旁白 `n7` | 13:2 电键一声；14:0 叮；踩镲敲 ON |
| 15–17.3 | 白卡「预期到货表」：可滞后卡在 `due = updatedAt + cadenceMs + LAG_GRACE_MS` 才去取（服务器、GitHub 贡献图、活动圆环三行，节奏按 `src/lib/status-views.ts#STATUS_VIEWS`），过了 due 从 15 秒起退避；右栏：推送连着时，在听列表、在看、在玩、奖杯的轮询取 `max(cardMs, PUSH_SAFETY_NET_MS)`，16:2 盖「≥ 5 min」章。旁白 `n8` | 15:1、15:2、15:3、16:0 一行一声叮；16:2 印章；踩镲敲 ETA |
| 17.3–18 | 拉远看整条示波线（几次到站的脉冲都在上面），17.72 起脉冲拉平成一条直线，往两头伸出画面。最后一帧：屏幕 y = 540 一条全宽水平直线（signalD，4 px） | 踩镲敲 SK（收报）；17:3 吸一口气，收在 A7sus4，18:0 交给第 06 章 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch05.n1a` / `n1b` | 1–3.5 | 页面还在解析，电报线已经接上；／先到的电报放进托盘。 | The wire is up before parsing ends; / early telegrams wait in a tray. |
| `ch05.n2a` / `n2b` | 3.5–5 | 页面活过来，／托盘里的按顺序重放。 | Once the page comes alive, / the tray replays in order. |
| `ch05.n3a` / `n3b` | 5–7 | 推送一到，写进缓存，／卡片当场翻面。 | A push lands in the cache / and the card flips on the spot. |
| `ch05.n4a` / `n4b` | 7–8.5 | 慢回来的旧数据，／盖不掉新的。 | Late, older data / can't overwrite newer data. |
| `ch05.n5a` / `n5b` | 8.5–10.5 | 进度条自己往前走：／浏览器按自己的钟算。 | The progress bar runs by itself, / on the browser's own clock. |
| `ch05.n6a` / `n6b` | 10.5–12.5 | 在线点到时自己熄灭，／不用等源站开口。 | The online dot goes out on time, / without waiting for the server. |
| `ch05.n7a` / `n7b` | 12.5–15 | 同一根线数两种人：／开着的，和正在看的。 | One wire counts two crowds: / pages open, and pages watched. |
| `ch05.n8a` / `n8b` | 15–17.3 | 可滞后的卡，／算好下一次到货再去取。 | Lag-tolerant cards fetch / when the next delivery is due. |

## 06 两条线路（14 小节）

事实：FACTS §6。画面标题「两条线路 / Two lines」。纸面地铁图，线路只用两种颜色：lyjw.me 墨色、lyjw131.com signal；站点是圆点加站名。

交接：0:0 只有一条墨线横穿整屏，在屏幕 y 540（第 05 章 17.5–18 把示波线拉平在同一高度），半小节内从 4 px 变粗成地铁线。14:0 镜头停在世界坐标 `[6400, 690]`、缩放 0.85，画面上只有两条横穿的线：墨色 lyjw.me 在屏幕 y 412、橙色 lyjw131.com 在 y 668（世界 y 540 / 840，线宽 14）；第 07 章从这一帧接着横移。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 第 05 章那条直线成了 lyjw.me 线，lyjw131.com 线从旁边画出来，两条都通到 Vercel 源站；标题 | 转调，声场铺开 |
| 1–4 | lyjw131.com 那条经过「阿里云 ESA」站，站旁挂一个 5 分钟钟面，标「过期先给旧页，后台回源」。旁白 `n1` | |
| 4–7 | 图片是索书号：一张借书卡写 `/img/<哈希>.webp`（Emby 海报；在听的封面来自 Apple 目录，不走这条路）；lyjw.me 由边缘 rewrite 代理到 R2，lyjw131.com 由 ESA 缓存同一路径。旁白 `n2` | |
| 7–12 | 发版接力，一站一站在强拍上亮（和第 02 章三盏灯同一种画法）：① Vercel 部署成功 ② Actions 刷新 ESA 并预热 ③ 两个域名的 `/api/version` 都答出新版（图上两个终点站先后打勾，9:0、9:2）④ 入口收到 site-deployed ⑤ 广播 version ⑥ 开着的页面顶上弹出 UPDATE 卡。旁白 `n3` | 每站一记，主题从 ⑤ 起唱、在第 ⑥ 站唱完 |
| 12–14 | UPDATE 卡纵向弹出；脚注「页面另有兜底：每 30 分钟问一次，切回焦点也问一次」；线路往右延伸，镜头跟着横移 | 收住，交给第 07 章 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch06.n1a` / `n1b` | 1–4 | 大陆访客走 lyjw131.com：／ESA 缓存 5 分钟，过期先给旧页。 | Mainland visitors ride lyjw131.com; / ESA caches it for five minutes. |
| `ch06.n2a` / `n2b` | 4–7 | 图片像索书号：／内容变了名字就变，永远不用刷新。 | Images work like call numbers: / new content, new name, never purged. |
| `ch06.n3a` / `n3b` | 7.5–11 | 发版是一场接力：／两个域名都换好，才喊一声 version。 | A release is a relay: / both domains first, then “version”. |

## 07 节拍器（12 小节）

事实：FACTS §7。画面标题「节拍器 / Metronomes」。纸面上三台正视节拍器（梯形机身、摆杆绕支点转）：PlayStation（n100 上的容器，看局域网发现包）、编码账号限额（agents-reporter，看人数）、服务器（server-reporter，固定）。旁边一个 `K.glyph` 小屋，里面是人数（Mono 数字），只拨限额那一台（读 `/count`）。PS 那台看的是客厅主机醒着没有，不问人数。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 三台节拍器和小屋；标题 | |
| 1–4 | 主机醒着、也有人在看：PS 按醒着那一档、限额 5 分钟、服务器 60 秒。旁白 `n1` | 全速 |
| 4–6 | 页面都切到后台：只把限额拨到 10 分钟。PS 仍看主机，醒着就还是快档。服务器不变 | 半速 |
| 6–9 | 入夜主机进休息、访客走光：PS 落到闲档，限额那台打 12 个 5 分钟的盹（摆杆停住、头顶一串 z），只有服务器那台照旧 60 秒一下（对照：闲时每分钟问一次人数，本身就不比直接推一次省）。旁白 `n2`。可选：Clawd 在限额那台旁边一起打盹 | 很慢，只剩一台的滴答 |
| 9–11 | 发现包从休息变回醒着：PS 立刻打一轮，不等满闲档。注「休息和关机是同一档，来回切不额外打」「退避没到时不放行」。旁白 `n3` | 回到全速 |
| 11–12 | 脚注式旁白 `n4`（只说限额那台的人数）；服务器那台再敲一下 | 12:0 这一下变成第 08 章的心跳 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch07.n1a` / `n1b` | 1–4 | 主机醒着，就勤打 PSN；／限额看有没有人在看。 | Console awake, PSN ticks fast; / limits follow who's watching. |
| `ch07.n2a` / `n2b` | 6.3–9 | 入夜人走光，只有服务器照旧：／问人数，并不比直接报省。 | At night only the server keeps time: / asking costs as much as reporting. |
| `ch07.n3a` / `n3b` | 9–11 | PS5 一开机，／马上回到快档。 | Power the PS5 on / and the fast tick starts now. |
| `ch07.n4a` / `n4b` | 11–12 | 人数问不到就当 0：／只会变慢，不会变快。 | No head count? Call it zero: / slower, never faster. |

## 08 心电图与地层（12 小节）

事实：FACTS §3「api 的分钟 cron」、§8。画面标题「心电图与地层 / Heartbeat and strata」。暗底；Sentry 那边不出组织名、监控 ID、真实报错标题、可用率数字，令牌只说「只读」。live 绿在这一章第二次、也是最后一次出现。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 一条心电图横线；标题 | 底鼓就是心跳 |
| 1–4 | 同一条线上两种方向相反的信号：向内的尖峰是 Sentry 每分钟来敲门（HEAD `/api/version`，只说明 Vercel 还在出页面）；向外的是 Worker 每 5 分钟去报到（api 分钟 cron 的整 5 分钟那一轮）；冷面脚注「报到只证明 cron 跑完了。」。旁白 `n1` | 敲门一声高、报到一声低 |
| 4–6 | 采集 Worker 每 5 分钟用只读令牌取回结果：LYJWPAGE 卡的白卡上 30 天一天一格，今天那一格亮一下（live 绿）。旁白 `n2` | |
| 6–10 | 镜头纵向下沉进地层（一层层水平色带，墨色深浅）：pulse 每分钟归档进 D1，地层一层层长厚，长期保存；Coding 那一层横向一格一格（`shared/pulse-coding.ts#PULSE_SCORE_WINDOW_MS` 一窗），交给 Jev 打分，全零的格不问 Jev、直接落最低档。旁白 `n3`（6–8）、`n4`（8–10） | |
| 10–12 | Clawd 在地层边冒出来说收尾那句；镜头往上升 | 收住，交给第 09 章 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch08.n1a` / `n1b` | 1–4 | Sentry 每分钟来敲一次门，／Worker 每 5 分钟去报一次到。 | Sentry knocks every minute; / the Worker checks in every five. |
| `ch08.foot` | 2.5–4 | 报到只证明 cron 跑完了。 | A check-in only proves the cron ran. |
| `ch08.n2a` / `n2b` | 4–6 | 结果取回来，／今天那一格亮一下。 | Results come back, / and today's cell lights up. |
| `ch08.n3a` / `n3b` | 6–8 | 往下是地层：pulse 每分钟进 D1，／长期保存。 | Below lie the strata: pulse goes / to D1 every minute, kept long-term. |
| `ch08.n4a` / `n4b` | 8–10 | Coding 每 15 分钟一窗交给 Jev，／全是零的窗不用问。 | Jev scores coding per 15 minutes; / all-zero windows skip the question. |
| `ch08.clawd`（气泡） | 10.2–11.8 | 线上出错时，／我先来这儿查证据。 | When something breaks, / I come here for evidence first. |

## 09 一首歌的旅程（14 小节）

事实：FACTS 全篇。画面标题「一首歌的旅程 / One song's journey」。一张横向长图版，前面各章缩成一格格并排，镜头沿信封的路一路平移、强拍上推近；信封进哪一格，那一格就换回那一章的底（纸面 / 暗底）亮一下。各章画法要能以函数复用（收尾时由主创提成共用件）。延迟不标数（没重测过）。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 长图版现出来；标题 | 全主题 |
| 1–4 | 信封从 Mac 那一格出发（第 01 章的专利图闪回），过门（钥匙、第 02 章纸面）、过秤、分拣进实时管。旁白 `n1` | 闪回哪一章，就用那一章的配器点一下 |
| 4–7.5 | 进屋排队、落账、写「要做的事」（第 03 章平面图闪回）；纸条递出，门外广播和回执同时出发；入口写完 LAG 和凭据，三盏灯亮、盖 202。旁白 `n2` | |
| 7.5–10.5 | 顺着电报线到浏览器（第 05 章示波器闪回），托盘、写进缓存；10:0 首页上那张「正在听」卡片翻面（和第 00 章第 4 小节同一个画面）。旁白 `n3` | 10:0 翻面一记 |
| 10.5–12.5 | 片尾字卡：谢谢观看 · 讲解 Claude Opus 5.5 · lyjw.me；Clawd 按官方 celebrate 庆祝 | 终和弦 |
| 12.5–14 | 画面收回暗底终端，停在和第 00 章第一帧相同的画面 | 尾音淡出 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch09.n1a` / `n1b` | 1–4 | Mac 上换了一首歌：／过门、过秤、分拣， | A song changes on the Mac: / the gate, the scale, the sorter, |
| `ch09.n2a` / `n2b` | 4.3–7.5 | 屋里记一笔，门外去广播；／回执和推送同时出发。 | a ledger line, a push outside; / receipt and push leave together. |
| `ch09.n3a` / `n3b` | 7.8–10.5 | 电报线那头，／卡片翻面。 | At the far end of the wire, / the card flips. |
| `ch09.end1` | 10.5–12.5 | 谢谢观看 | Thanks for watching |
| `ch09.end2` | 10.5–12.5 | 讲解 Claude Opus 5.5 · lyjw.me | Narrated by Claude Opus 5.5 · lyjw.me |
