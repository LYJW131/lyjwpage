# lyjw.me 运行原理 · 分镜与旁白（v2）

> 类型：reference

新版 `/explainer`（`v2/`，全篇 2D）的分镜。三样东西以这里为唯一出处：**章节表**（每章小节数，`v2/plan.js` 抄这里）、**每一段的画面要点**、**中英旁白原文**（各章文件顶部的 `I18N.add` 抄这里）。事实出处在 [FACTS.md](FACTS.md)，画法、母题与调色板在 [TREATMENT.md](TREATMENT.md)，写章的契约在 [v2/CONVENTIONS.md](v2/CONVENTIONS.md)。

- **节拍**：108 BPM，4/4，一小节 20/9 秒（约 2.22 秒）。小节从 0 数，章内写「小节:拍」，拍也从 0 数：5:2 是第 5 小节的第三拍；表里「2–5」指第 2 小节开头到第 5 小节开头。
- **主角**：Mac 上的一次换歌（`mac · appleMusic`）。片子跟着这封信封，从 Mac 一路走到访客屏幕上那张「正在听」卡片翻面。
- **旁白**：每句两行，逐字亮起，排在图版里，不是字幕，也不是 Clawd 的气泡。按 60 px、`maxW` 1040 排：中文每行不超过 17 字，英文每行不超过 36 个字符（Geist 60 px 平均约 28 px 一个字符），再长会被缩到 56 px 以下。改旁白先改这里，再改章节文件。
- **Clawd**：只在开场、第 02 章开门、第 03 章心跳、第 08 章收尾、片尾出场（第 07 章可选一次），说的话放在气泡里，不算旁白。
- **不上画面**：见 [v2/CONVENTIONS.md](v2/CONVENTIONS.md)「事实」一节。编码用量只讲到「Mac、云端、容器里的 Cursor 各报原始事实，站点侧合并；Pulse 上有一条 token 处理量（5 分钟平均）」，不点存储键和模块名；不说「生成速度」，也不说它是此刻的精确值（FACTS §1「编码用量」）。

## 章节表

小节数已锁定。要改，先改这张表和总长，再由主创改 `v2/plan.js`；两边不一致时 `v2/film.js` 报错并以 plan.js 为准。

| 章 | 图版 | 底 | 小节 | 起止（小节） | 起止（时间） | 交给下一章 |
|---|---|---|---|---|---|---|
| 00 | 这张卡片从哪来 | 暗 → 纸 | 10 | 0–10 | 0:00.0–0:22.2 | 冲进总览图「采集端」那一栏，10:0 硬切暗底 |
| 01 | 野外观测站 | 暗 | 35 | 10–45 | 0:22.2–1:40.0 | 信封火花往右飞出画面；硬切纸面，火花从左边进场 |
| 02 | 门禁与分拣 | 纸 | 20 | 45–65 | 1:40.0–2:24.4 | 冲进「状态核心已提交」那盏灯，整屏橙色后落黑（已做） |
| 03 | 一间屋子的账房 | 暗 + 白卡 | 16 | 65–81 | 2:24.4–3:00.0 | 冲进对照表白卡下方的空白，满屏是纸，不落黑（已做） |
| 04 | 活字印版 | 纸 | 12 | 81–93 | 3:00.0–3:26.7 | 推进「在听」那块印版，12:0 硬切暗底 |
| 05 | 电报线 | 暗 | 18 | 93–111 | 3:26.7–4:06.7 | 示波线拉平成一条直线，硬切纸面，成了地铁图上的一条线 |
| 06 | 两条线路 | 纸 | 9 | 111–120 | 4:06.7–4:26.7 | 线路往右延伸，镜头横移到节拍器那张纸（同为纸面，不切） |
| 07 | 节拍器 | 纸 | 12 | 120–132 | 4:26.7–4:53.3 | 服务器那台的一响变成心电图上的尖峰，硬切暗底 |
| 08 | 心电图与地层 | 暗 | 12 | 132–144 | 4:53.3–5:20.0 | 镜头从地层升回地面，只剩心电图横线；硬切纸面，横线成了 git 的 main 线，笔尖处是这次的提交 |
| 09 | 发布 | 纸 | 16 | 144–160 | 5:20.0–5:55.6 | 落回主轴，别的都退掉，只剩屏幕 y 540 一条整宽墨线；硬切暗底，成了第 10 章长图版的脊线 |
| 10 | 一首歌的旅程 | 长图版，各格用原章的底 | 14 | 160–174 | 5:55.6–6:26.7 | 收回第 00 章第一帧，首尾相接可循环 |

合计 174 小节，6 分 26.7 秒；配乐另有 2 秒尾音（`Score.tail`）。

交接默认是强拍上硬切；表里写了做法的，由前后两章的作者按它对一次。每章的配乐也要照顾自己的首尾两拍（见 CONVENTIONS「交接」）。

## 00 这张卡片从哪来（10 小节）

事实：FACTS「一句话总览」。下表按 `ch00.js` 和 `v2/music/ch00.js` 的现状写。画面标题「这张卡片从哪来 / Where does this card come from?」（7.55 起在页眉上，由大字问题翻过去）。终端和「正在听」那一段挂在本章登记对象的 `share` 上，第 10 章在它的 10:0 前后和收尾借它画同一个画面。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–2 | 暗底终端，Geist Pixel 字：`$ claude` 从 0:0.5 起一格十六分一个字敲出，0:2 回车；欢迎框里 Clawd 按官方入场（skip → jump → look → celebrate，一帧 60 ms，各段从拍上起），0.95 起气泡。第 0 帧（只有提示符和常亮的光标）也是全片最后一帧 | 只有 pad 和打字声（一个字一声，回车重一下） |
| 2–4 | 2:0 硬切纸面：浏览器窗口里的主页线框一笔笔画出来（卡片框取第 04 章 P 表的实测比例，出处 `src/app/page.tsx`；这一刻没在充电，「最近播放」占满那一行，下面是整行的对话卡，被窗口下沿切掉）；3:0 起镜头推到「正在听」那张卡；3.55 起火花顺着一根线从画面左边进来 | 2:0 低低一声落地，主题第一次出场（拨弦唱，高八度的铃叠一层）；3:3 吸一口气 |
| 4–6 | 4:0 火花落到封面上（橙点留在卡上），歌名纵向压扁再弹开：夜に駆ける → アイドル；4.25 大字问题，别的卡退淡 | 4:0 翻面一记 |
| 6–7.5 | 6:0 问题收小到左上成页眉（`00`、问题、`lyjw.me · /api/status/listening/now`：这张卡读的端点），旁白 `n1` | |
| 7.5–10 | 顺着那根线往回拉，拉出总览图：采集端（上报器和云端遥测的小样，一个漏斗收进入口）→ 中枢（上报入口 ingress、状态核心 api、采集 Worker collector，左上另有「对话与构建」ai，一根细线接到状态核心；下面一根横梁挂四个库的符号，`K.glyph`）→ 展示（浏览器窗口）；那根线从 Mac 一路水平穿过入口和状态核心，落在封面上。页眉翻成本章标题；8:2、8:3、9:0 三栏各亮一下；旁白 `n2`；9:2 起冲进采集端里 Mac 那一格，10:0 硬切第 01 章 | 7:2 往回拉；8 律动全开，三栏各一声灯音（A5 D6 F6）；9:2 下坠两拍，母线低通在第 01 章 0:0 最闷、0:1 打开；最后一小节没有旋律，收在 A7sus4 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch00.clawd`（气泡） | 0.95–2 | 带你拆开 lyjw.me 看看。 | Let me open up / lyjw.me for you. |
| `ch00.q`（标题） | 4.25–7.55 | 这张卡片，是怎么知道的？ | How does this card know? |
| `ch00.title`（页眉） | 7.55–9.5 | 这张卡片从哪来 | Where does this card come from? |
| `ch00.n1a` / `n1b` | 6.1–7.5 | 全片跟踪一封上报信封：／Mac 上 Apple Music 换了一首歌。 | We trace one report end to end: / a song change on the Mac. |
| `ch00.n2a` / `n2b` | 8.1–9.5 | 上报器发 POST，Workers 记状态，／Vercel 出首屏，浏览器收推送。 | Reporters post; Workers hold state; / Vercel renders; the browser listens. |

## 01 野外观测站（35 小节）

事实：FACTS §1。下表按 `ch01.js` 和 `v2/music/ch01.js` 的现状写。画面标题「野外观测站 / Field stations」，副标 `reporters · collector Worker`。一长条暗底图纸，镜头只做横移，每件仪器一个机位：前一拍（x:3）起甩 0.25 小节，下一小节 0:0 落定，停住时慢推；每个机位动作做完后至少停一小节，旁白第二行写完到淡出至少 0.3 小节。仪器是正视专利图（骨白发丝线、FIG. 图号、剖切斜线），要读的字放进白卡详图。每次往右甩镜头都配一口轻风（`whoosh` 的 `tube: "whip"`，x:2.95 起，中点对着镜头最快那一刻，从右往左扫）。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–2 | 硬切进暗底：标题；右边一条图纸索引，七个图号的小样：前五个是外部上报器（第 3 号是 Home Assistant 和 n100 上的容器，第 5 号是东京那台主机上的容器），括线只标「上报器」；第 6 号是云端那一小段遥测（虚线），号下注「独立入口」；第 7 号是表盘，标「采集 Worker」。上报器和采集任务的个数只画不说。旁白 `n1`，1:3 起甩向 Mac | 0:0 低「咚」，pad 和翻图纸声 |
| 2–3 | FIG. 1 笔记本（Mac Telemetry Hub，菜单栏 App）在甩镜头时画出来，屏幕上 Apple Music 还在放夜に駆ける；右边白卡逐字敲出信封的格式 `{version:4, presence, heartbeatAt, activeModules, modules:{…}}`，modules 一行四格都是虚线 | 打字机敲信封 |
| 3–4.5 | 3:0 歌名压扁再弹开（夜に駆ける → アイドル）；3:2 四格里只有 appleMusic 那格亮（橙），注「没变的模块不寄」；3:3 信封从菜单栏的 Hub 图标出来，4:0 停在笔记本旁边。旁白 `n2a` | 3:0 读数灯（本章专用的玻璃 FM，旋律乐器 glass）唱主题，低八度闷拨弦垫一层；4:0 往下答一句 |
| 4.5–5 | 没变化时：4:2 一个空信封呼吸一次（圆环缩放），标「90 s」「空信封 = 心跳」。旁白 `n2b` | 4:1 吸一口气，4:2 远处一声 |
| 5–7 | 切应用：菜单栏的前台应用 5:0 换一次、5:1 又换一次，平面刻度尺的指针回零重新量，5:3 量满 400 ms 落定，注「切应用默认先等 400 ms 落定」（Hub 设置里能调）「落定前又切：重新计时」。旁白 `n2c` | 5:3「叮」 |
| 7–9 | FIG. 1A 窗口标题（画成几块遮住的字）过 Jev：7:1 起几道问题的横条同时走，8:0 同一刻一起给出概率条（示意值，不标数，不和出路对应）；两条出路，8:1 这一次的标题走放行那条进信封，8:2 拿不准那条弹给主人。旁白 `n3` | 十六分的钟摆（问题在走），8:0 翻转一记，8:1 纸滑进信封，8:2「叮」 |
| 9–11 | FIG. 1B 图片：9:0 起应用图标的像素压成一串哈希 `sha256….png`，9:2 落进 R2 的抽屉、同一刻信封卡上写出 `iconObjectKey`，9:3 抽屉关上；注「同一内容，同一个键」。旁白 `n4` | 打字机敲哈希，9:3 抽屉锁舌 |
| 11–13 | FIG. 2 手机（lyjwpage iOS App）：11:1 HealthKit 把它唤醒，11:2 起依次报活动圆环、训练、五分钟步数桶。旁白 `n5` | 每到一个图号一声「叮」（11:0、13:0、17:0、19:0、22:0、27:0，A C D E G A 往上爬）；11:1 远处一声 |
| 13–14.5 | FIG. 3 家里：HomePod 在放什么经 Home Assistant，13:3 它的钥匙落下，14:0 只开 /homepod（注「Home Assistant 的钥匙」）。PS5 和 Home Assistant 之间没有线。旁白 `n6` | 14:0 钥匙 |
| 14.5–17 | 右边 n100 上的 playstation-reporter 容器，跟 PS5 在同一个局域网里：14:2 一条虚线画向 PS5、标 UDP，线下档位牌「没醒 · 闲档」；从这一拍起每拍一个探测点飞向 PS5，主机没醒时点在机身前淡掉；15:0 主机开机，机身灯条亮；15:1 那一探有了回音（回音点飞回容器），档位牌压扁弹开翻成「醒着 · 快档」；15:2 当场问一轮 Sony：容器上方「PSN · Sony」框，一个点沿虚线上去再回来，注「PSN 登录态留在本机，只拿来问 Sony」；16:0 容器自己的钥匙开 /playstation（注「容器自己的钥匙」）；探测线下注「探测主机醒没醒，只定自己的节奏，不上报」。容器的两条路分开画：往上问 Sony 用 PSN 登录态（不是钥匙，不进站点），往下寄到上报入口用自己的钥匙（从 n100 下面挂出来）；和 Home Assistant 的钥匙是三样凭据。站点不显示 PS 电源，片中不画也不说（FACTS §1）；间隔不出数。旁白 `n7` | 15:0 翻转一记（主机开机），15:1 远处一声（第一探有回音；档位牌翻面、问 PSN 都不另配声），16:0 容器的钥匙 |
| 17–19 | FIG. 4 NAS 机箱：emby-reporter 容器，17:2 ① 海报先传 R2，18:0 ② 报在看什么的信封寄出去。旁白 `n8` | 17:2 气动管，18:0 纸滑 |
| 19–22 | FIG. 5 东京的机柜（misaka-jp），一台主机上的几个容器依次亮起，各自引出标注和上报端点：19:1 server-reporter（服务器状态，固定每 60 秒）、19:3 agents-reporter（各家编码工具的限额、Cursor 账号的用量）、20:1 discord-reporter（Quest 在玩什么，读 Discord 在线状态）。旁白 `n9` | 三个容器各一盏远处的灯（A5、C6、D6） |
| 22–24 | FIG. 6 云端的一小段遥测（虚线框，不画云朵）：Claude Code 云端自己发 OTLP，22:2、22:3 两个包顺着线走到 `/api/ingest/agents/otlp`，标「独立入口」「Claude Code 自己发，不是我们写的上报器」。旁白 `n10` | |
| 24–27 | 编码用量：Mac 本机、Claude Code 云端、容器里的 Cursor 三根线，24:2 起各送出一张原始数的小单子，25:0 汇到站点这边合并；合并处伸出一小段 Pulse，多一条 Tokens 道，注「token 处理量 · 5 分钟平均」「三处相加」（不说生成速度，不给此刻的数）。旁白 `n11` | 24:2、24:2.5、24:3 三盏灯（A5 D6 F6），25:0 合并补上 E6，拼出主题 |
| 27–30 | FIG. 7 表盘：采集 Worker，cron 每分钟一响（一拍当一分钟，从整点起走 12 分钟）；每根指针一个任务，到它跑的那一分钟往前弹一格；右边白卡是逐分钟的时序图（指针数和节奏按 `workers/collector/src/registry.ts#JOBS`；apple-recent 每分钟登记、自己分闲 / 活跃两档，表盘让它在 :05 看到列表变了：:00、:05 各一次，之后每分钟）；注「不走上报入口：直接交给状态核心，或写 LAG」。PlayStation 不在这张表盘上。旁白 `n12`；29.7 起往右甩到 FIG. 7A | 钟摆每拍滴答 |
| 30–34 | FIG. 7A「没人上报的播放」（接着表盘一拍一分钟）：左边一部 iPhone（副标题「别的设备上的 Apple Music：从最近播放推断」），注「放的歌没人上报」；中间白卡「Apple · 最近播放的歌」（`/v1/me/recent/played/tracks`），采集 Worker 的虚线从左边进来，注「列表一变：每 15 秒拉」，每拍一个大拉取点、拍间三个小点；右边白卡「站点这边推断」（角标 `inferredPlays`），一条分钟轴，轴上每次拉取一个点。30.215 手机开始放 Ref:rain（Aimer），30:1 那次拉取看到它排到最前（列表下移一行，注「↑ 开播几秒就排到最前」），右边 Ref:rain 那行亮出 15 秒宽的窗口（两次拉取各减去上榜滞后），注「开播在这一格里」；31.424 手机换成残響散歌，31:2 那次拉取看到它，残響散歌那行亮出窗口；31:3 这个窗口减去 Ref:rain 的时长、挪到 Ref:rain 那行（注「减去前一首的时长」），32:0 两格求交，交集那一窄条亮起，注「两格求交：开播 ± 误差」；32.1 起两首按时长接成一串（注「按时长接成一串」）；32:2 下面翻出「页面上」：LIKELY PLAYING · 残響散歌、虚线框「±3s」，旁边 Listening 道上两段斜线、图例「Played elsewhere, estimated」。第 19 分钟之后不再拉，时间定格在 19.5 分钟（再走下去残響散歌就放完了）。旁白 `n13`、`n14` | 钟摆接着表盘每拍一响；30:1、31:2 纸滑（新歌排到最前），31:3 一声叮，32:0 一盏灯，32:2 翻面一记；32 小节一句往下走的闷拨弦（F E D A，信封主题的倒影：这里没有信封） |
| 34–35 | 33.7 起镜头一路甩回 Mac：34:0 那封换歌的信封亮起，一条虚线指向 `ingest.homepage.lyjw.llc`；34:1 起信封拖着发丝线往右飞出画面（屏幕 y 540，约 34.97 出右缘，最后几帧只剩拖尾贴着右边），第 02 章 0:0 的火花从左边同一高度进场 | 33:2.85 起甩回来的风声（从左往右，最响的一口），34:0 灯亮，34:1 气动管，34:3 吸气；收在 A7sus4 上，给第 02 章 0:0 的主题让路 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch01.n1a` / `n1b` | 0.3–1.8 | 上报器在数据源头主动推送；／第三方接口由采集 Worker 定时拉取。 | Reporters push from the source; / a cron Worker polls external APIs. |
| `ch01.n2a` / `n2b` | 3.05–4.97 | Mac 只寄这一次变了的模块；／没变化时，每 90 秒寄一封空信封。 | The Mac sends only changed modules; / idle: an empty envelope every 90 s. |
| `ch01.n2c` / `n2d` | 5.05–6.74 | 前台应用的切换先防抖：／连切几次，只报最后停住的那个。 | App switches are debounced: / a burst reports only the final app. |
| `ch01.n3a` / `n3b` | 7.05–8.97 | 窗口标题先经 Jev 做隐私判断；／拿不准的交给主人，放行的才进信封。 | Jev screens window titles first; / unsure ones go to the owner. |
| `ch01.n4a` / `n4b` | 9.05–10.74 | 图片按内容哈希命名，直传 R2；／信封里只带对象键。 | Images go to R2, named by hash; / the envelope carries only the key. |
| `ch01.n5a` / `n5b` | 11.05–12.74 | iPhone 由 HealthKit 后台唤醒：／圆环按小时报，训练一有新记录就报。 | HealthKit wakes the iPhone app: / rings hourly, workouts at once. |
| `ch01.n6a` / `n6b` | 13.05–14.48 | HomePod 由 Home Assistant 代报，／它那把钥匙只开 /homepod。 | Home Assistant relays the HomePod; / its key opens /homepod only. |
| `ch01.n7a` / `n7b` | 14.55–16.74 | PlayStation 由 n100 上的容器负责：／探测醒没醒，醒了就问 Sony 再上报。 | An n100 container covers the PS5: / it probes, asks Sony, then reports. |
| `ch01.n8a` / `n8b` | 17.05–18.74 | 海报先传 R2，再寄在看的信封；／入口核对 R2，缺哪张写进回执。 | Posters reach R2 before the report; / the receipt lists any still missing. |
| `ch01.n9a` / `n9b` | 19.05–21.74 | 同一台主机上的几个容器，／各用各的钥匙，各报各的来源。 | Containers on the same host / each hold their own key and source. |
| `ch01.n10a` / `n10b` | 22.05–23.74 | 云端的 Claude Code 自己发 OTLP，／只收累计值，差值在状态核心里算。 | Cloud Claude Code emits OTLP itself; / cumulative only; the core diffs it. |
| `ch01.n11a` / `n11b` | 24.05–26.74 | 编码用量：三处各报原始数，／合计与去重都在站点这边算。 | Coding usage: three raw feeds; / totals and dedup happen site-side. |
| `ch01.n12a` / `n12b` | 27.3–29.74 | cron 每分钟触发一次采集 Worker，／每个任务按自己的节奏去取。 | A cron trigger fires every minute; / each job keeps its own pace. |
| `ch01.n13a` / `n13b` | 30.05–32.0 | 别的设备放 Apple Music，没人上报；／采集 Worker 去拉 Apple 最近播放。 | No one reports songs elsewhere; / the collector polls Apple's recents. |
| `ch01.n14a` / `n14b` | 32.05–33.74 | 新歌开播几秒，就排到列表最前；／按时长接成一串，推出起止和误差。 | A song tops the list seconds in; / lengths chain them: start ± margin. |

英文 `n3` 少了「放行的才进信封」：画面上放行那条线进信封，标注「放行 → 进信封 / cleared → envelope」。

## 02 门禁与分拣（20 小节）

事实：FACTS §2。下表按 `ch02.js` 和 `v2/music/ch02.js` 的现状写，是全片标杆。一张 3840×3240 的纸面图纸，两列三行：A 门墙、B 检查单、C 分拣台、D 跨 Worker 的一跳、E 回 202 之前的三盏灯，左下那格 F 是图签，只在拉远时看得到；镜头在强拍上甩到下一格。这一章讲到「经 Service Binding 交给 StateCore.commitIngest，回执回来」为止：屋里排队、唯一的状态 DO、「要做的事」是第 03 章的。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1.6 | 硬切进来那一帧火花就贴着左缘（屏幕 y ≈ 540，接第 01 章），墙线从 0:0 起画；标题「02 门禁与分拣」、`ingest.homepage.lyjw.llc · ingress Worker`、`POST /api/ingest/…`；一墙九扇门画出来（来源按 `shared/ingest/prepare.ts#INGEST_SOURCES`，最后一扇是 `/agents/otlp`）；Clawd 跳上标题线说一句；火花走向 /mac | 0:0 拨弦唱主题，前奏只有 pad 和零星打字声 |
| 1–3.2 | 权限表 ACCESS_CLIENTS 分两列逐行列出（mac … github-actions，按 `workers/ingress/wrangler.toml#ACCESS_CLIENTS`，只写上报方名）：钥匙按上报方发，home-assistant 那行只开 /homepod，/playstation 只有 playstation 那行（n100 容器自己的钥匙），quest 那行只开 /quest；mac 的钥匙从自己那行滑到 /mac，2:0 转开门、2:3 关上。旁白 `n1`（1.6 机位落定才出底字） | 2:0 钥匙 |
| 3–5 | emby 的钥匙去开 /mac，3:2 盖 403；4:0 Home Assistant 的钥匙开 /homepod、4:0.5 playstation 的钥匙开 /playstation，两张卡各贴着自己那扇门往外伸，标「两把钥匙，各开一扇」 | 3:2 印章，4:0、4:0.5 两把钥匙 |
| 5–7.6 | 甩到检查单（角标 `ingress Worker · handleIngest`）：六项在 5:0、5:2、6:0、6:2、7:0、7:2 逐项打勾（方法是 POST · 认识这个来源 · Access 凭证 RS256 / aud / iss / exp · 不超过 4 MiB，按实际读到的字节 · 是 JSON · prepare：校验并整理成命令，产物 `PreparedIngest`），右栏拒收码 405 / 404 / 401·403·503 / 400 / 400 / 400·503；右边那封信跟着亮出 POST、路径、JWT、称重、花括号，7:2 拆开。旁白 `n2` | 每项一声「叮」，音高 A C D E G A |
| 7.6–8.75 | 反例：一封 `<html>` 飞进来，8:0 盖「400 不是 JSON」 | 8:0 大章，全场一顿 |
| 9–12 | 甩到分拣台：台上两封已拆开（mac、iphone），角标 `prepare → PreparedIngest`；四根管子（凭据 KV CREDENTIALS · 归档 D1 HISTORY · 可滞后 KV LAG · 实时 CORE.commitIngest），每根下面写谁来写：前三根「入口直接写」，实时那根「交给状态核心」；管底是四个库的符号。9:0 mac 的 desktop / appleMusic / chargingDevices 进实时，9:2 timezone 进可滞后，10:0 iphone 的 workouts 可滞后、归档各一份，10:2 musicUserToken 进凭据；服务器那封从右上角进来，11:0 整封一分为二，进可滞后和归档，注「服务器那封整封不进状态核心：只进可滞后和归档」。实时那根管子从右下角出去。旁白 `n3` | 9:0、9:2、10:0、10:2 气动管，11:0 分叉 |
| 12–16 | 甩到跨 Worker 的一跳：中间一堵剖切墙，左边 `ingress Worker`「无状态，只在边界鉴权」，右边 `api Worker`「状态核心」；实时那根管子从墙上的口穿过去，口上标 `Service Binding · CORE`，入口这一侧标 `await CORE.commitIngest(cmd)`。火花顺着管子 12:2 过墙、12:3 进 StateCore（RPC 入口），13:0 进 StateHub（Durable Object，画成四个库里「实时」那间屋子），13:1 屋里的灯亮；13:2 回执从 StateCore 顺原路回来，14:0 停在墙边，写出 `{ ready: true, ok: true, data }`。墙那一侧注「内部调用：不走公网，不带凭据」「只有绑定了 CORE 的 Worker 调得到」，脚注「改校验只需重新发布入口：api Worker 只引用类型，Durable Object 不重启，连接不断。」。15.75 起回执往下落，16:0 落到 E 的第一盏灯。旁白 `n4`、`n5` | 12:2 气动管（到站那一下落在 StateCore），等回执时十六分的钟摆，13:0 门锁，13:1 远处一盏灯，13:2 纸滑，14:0「叮」，15:3 吸一口气 |
| 16–19.25 | 甩到三盏灯，注「回 202 之前，入口依次等：」：16:0 回执点亮「状态核心已提交」，16:2「LAG 已写」，17:0「凭据已写」，每盏下面标 `await`；16.25 起 D1 那一路从汇流线上分出去（虚线，「D1 归档 · waitUntil · 不等」），17:3 在 202 之后才远远亮起；汇流线亮一盏走一段，17:2 盖「202 Accepted」；17:3 起右边列出失败时：`ready: false → 503`「状态核心未就绪：稍后重发」，`throw → 400`「上报器整封重发」。旁白 `n6`、`n7` | 灯音 A5 D6 F6，17:2 大章，17:3 D1 远远唱 E6 |
| 19.25–20 | 拉远看整张图纸（左下格正中是图签「门禁与分拣 · PLATE 02 · INGRESS」），19.74 起冲进「状态核心已提交」那盏灯：整屏化成橙色，19.97 前落满黑（20:0 那一帧归第 03 章，从黑里起） | 19:2 下坠，被吸进第 03 章 0:0 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch02.clawd`（气泡） | 0.95–2.45 | 上报都从这面墙进来。 | Every report comes in / through this wall. |
| `ch02.n1a` / `n1b` | 1.4–3.2 | 每个上报方一把 Access 钥匙，／权限表决定它能开哪几扇门。 | One Access token per reporter; / the table decides which doors open. |
| `ch02.n2a` / `n2b` | 4.9–6.4 | 按判定顺序逐项校验，／一项不过，当场拒收。 | Checks run in order; / any miss is rejected. |
| `ch02.n3a` / `n3b` | 9.05–11.74 | prepare 把信封整理成命令，／按数据层拆成四路。 | prepare turns it into a command, / split four ways by data layer. |
| `ch02.n4a` / `n4b` | 12.05–13.82 | 实时那一半经 Service Binding，／交给 api Worker 里的 StateCore。 | Realtime rides a Service Binding / to StateCore in the api Worker. |
| `ch02.n5a` / `n5b` | 13.87–15.74 | 鉴权已在边界做过一次，／这一跳只认绑定，不再验钥匙。 | Auth already happened at the edge; / this hop trusts the binding alone. |
| `ch02.n6a` / `n6b` | 16.05–17.72 | 三层都写完，才回 202；／归档、推送与失效在后台继续。 | 202 only after three layers commit; / archive and push continue after. |
| `ch02.n7a` / `n7b` | 17.8–20 | 中途出错回 400，整封重发；／每一路按自然键写，重发不重复。 | On error: 400, and a full resend; / keyed writes make resends harmless. |

检查单右边那一栏只有 650 宽，`n2` 中文一行不超过 10 字、英文不超过 23 个字符。

## 03 一间屋子的账房（16 小节）

事实：FACTS §3。已做；下表按 `ch03.js` 和 `v2/music/ch03.js` 的现状写。一张暗底平面图，三个机位（A 屋里、B 门外、C 拉远），空间用平面图交代，含义交给白卡详图。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–2 | 黑里先亮一盏桌灯（接第 02 章冲进去的那盏灯），平面图一笔一笔画出来：左边一路进口（上报入口）排成一条队，栏杆只围出一条（采集 Worker 写实时层不排这条队，这里不画）；进口那条线上注 `Service Binding` `→ StateCore`：入口调的是 StateCore，由它串进 StateHub 这条队；中间一间屋子（墙体剖切斜线、门洞、一张桌、一把椅子、一盏灯、一本摊开的账本），右墙一道缝；标题「03 一间屋子的账房」、`workers/api · StateCore → StateHub`；引线标注 `StateHub · idFromName("global")`「全站只有这一个实例」。旁白 `n1` | 0:0 落地一声低「咚」，FM 铃唱主题 |
| 2–5 | 每拍一封进门落账，右栏「StateHub 账本」详图每拍写一行打勾（mac · desktop、homepod · nowPlaying、emby · watching……；playstation 那几封是 n100 容器 POST 的原始信封，和别的一样从上报入口来）；屋里标 `ingestTail`；主角 mac · appleMusic 带着橙色火花在队里等。旁白 `n2` | 底鼓每拍，十六分钟摆 |
| 5–6 | 5:0 主角落账；托盘上出一张小纸条，右栏「要做的事」（角标 `IngestEffect`）固定三行 event / listening / tags：listening 写「广播 listening-now · 用落账前补好的封面和链接」（查 Apple 目录在 StateCore 交给 StateHub 之前做完，随状态落库），tags 空着「换歌不失效；开始或停止放歌才有」，方框不勾。旁白 `n3` | |
| 6–8 | 6:0 纸条从墙缝递出，镜头甩到门外岗亭 StateCore「RPC 入口 · 照单去办」；6:2 盖 waitUntil 章、listening 打勾；同一拍两条虚线出发：去天线 LivePushRoom（另一个单例 DO），橙环荡开，所有开着的页面依次翻面、标 listening-now；回执 `ok · data` 飞回入口，标「回执 → 入口」「入口接着写 LAG 和凭据，都写完才盖 202」，两条路中间「‖ 并行 ‖」。旁白 `n4` | 6:0 纸滑出，6:2 广播 + 印章 |
| 8–10.5 | 甩回屋里：又进两封（playstation、emby），9:0 一封纯心跳（信封上一颗心跟着底鼓跳）：账本记「♥ 存活 + pulse 观测」，「要做的事（空）」注「不推送」「不失效首屏」；Clawd 在桌角冒出来说一句。旁白 `n5` | 心跳段半速，底鼓变成扑通扑通 |
| 10.5–12 | 一封在线 → 离线（mac · presence）落账：「要做的事」写 event「广播 presence」、tags「失效页头、在听、充电头 → Vercel，5 秒超时」；11:0 两项打勾，纸条递出，橙环从右边扫进来。旁白 `n6` | 11:0 翻转一记，11:3 吸一口气 |
| 12–15 | 拉远：屋子、岗亭、天线缩成「实时 · StateHub」一组；可滞后墙（带时间签的格子）、凭据抽屉、D1 档案架按拍从地平线升起（KV LAG、KV CREDENTIALS、D1 · lyjwpage-history）；右边白卡「四个库」逐行写上（实时 · 会推送 · StateHub（DO，SQLite）；可滞后 · 不推送 · KV LAG · 带 updatedAt；历史 · 长期保存 · D1 · lyjwpage-history；凭据 · 不公开 · KV CREDENTIALS）；14:2 脚注「pulse 时间线在屋里只放 7 天，每 5 分钟归档进 D1」。旁白 `n7` | 12:0 律动全开，主题带和声完整唱一遍 |
| 15–16 | 15:0 图版外框「PLATE 03 · STATE CORE」；15:2 起镜头对准对照表白卡下方的空白，冲进去，满屏是纸 | 15:0 终和弦 Dm9 和一声低「咚」 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch03.n1a` / `n1b` | 0.6–2.15 | StateHub 是唯一的状态 DO，／实时层全在它的 SQLite 里。 | StateHub is the single state DO; / all realtime state sits in SQLite. |
| `ch03.n2a` / `n2b` | 2.2–5 | 经 Service Binding 调 StateCore，／再串进 StateHub，逐封落账。 | Ingress calls StateCore via binding; / StateHub commits them one by one. |
| `ch03.n3a` / `n3b` | 5–6.04 | StateHub 自己不发网络请求，／只交回一张效果单：要做的事。 | StateHub makes no network calls; / it hands back a list of effects. |
| `ch03.n4a` / `n4b` | 6.3–8 | StateCore 用 waitUntil 照单办，／网络请求不占 StateHub 的时间。 | StateCore runs them in waitUntil: / network I/O never blocks StateHub. |
| `ch03.n5a` / `n5b` | 9–10.5 | 心跳只续存活、记 pulse 观测，／效果单为空，下游什么都不做。 | A heartbeat logs liveness and pulse; / its effect list stays empty. |
| `ch03.clawd`（气泡） | 9.6–10.2 | 记一笔就好，／别吵醒大家。 | Just jot it down, / don't wake anyone. |
| `ch03.n6a` / `n6b` | 10.55–11.75 | 只有上线、下线才广播 presence，／并通知 Vercel 让首屏标签过期。 | Presence is pushed only on flips, / and Vercel is asked to expire tags. |
| `ch03.n7a` / `n7b` | 12.3–16 | 只有实时层放在 DO 里，变了就推送；／其余几层在 KV 和 D1，不推送、按需读取。 | Only the realtime layer lives in a DO and pushes; / the rest sit in KV and D1 and wait to be read. |

`n7` 中英都超过行宽：它排在缩放 0.66 的拉远机位上，世界坐标写 91 px、`maxW` 2600，屏幕上仍是 60 px、不缩字（`v2/tools/check.mjs` 核过）。其余各句中文每行不超过 17 字，英文不超过 36 个字符。

## 04 活字印版（12 小节）

事实：FACTS §4。画面标题「活字印版 / The type case」，副标 `Vercel · Next.js` 和 `'use cache' · cacheTag`。纸面，俯视一整页首屏：每条 `firstScreen` 缓存一块印版（一张卡读几个视图就切成几块，`src/app/page.tsx#READS`），按首屏桌面宽度的真实比例排成一条长版，块上写它的 `page:` 标签名，没挂标签的写端点末段（屏幕上不小于 28 px）；挂标签的块右上角吊一枚小标签。块数、带标签和不带标签的各几块，写章时按代码现数（`src/app/page.tsx` 里 `firstScreen` 的调用、`src/lib/status-views.ts#STATUS_VIEWS` 的 tag），旁白里不说数。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 接第 03 章的满屏纸往后拉：一整页印版现出来；标题 | 印刷机的重拍进来 |
| 1–3 | 出纸口递出一张印好的页：访客拿到的是缓存好的 HTML。旁白 `n1` | |
| 3–5 | 镜头顺着长版往下走，每块印版一根细线接到左右两条轨（实时 → DO，可滞后 → KV LAG），轨通到页底的库符号；脚注「`'use cache'` · stale 300 / revalidate 600 / expire 7 天」 | |
| 5–8 | 接第 03 章那次在线 → 离线：页头、在听、充电头三块的标签失效（注「在线 → 离线：这几块的标签失效」，不写个数），三块被夹起（往上平移、投影变深），在强拍上按 stamp 模式重印、放回；同时出纸口照旧递出旧页，新页在后台印。旁白 `n2` | 每块重印落在一个重拍上 |
| 8–9.5 | 没挂标签的那几块，角上各亮一个 600 秒的圆形计时环。旁白 `n3` | |
| 9.5–11 | pulse 那块的计时走到头、回源碰上 503：那块印版不动，盖一枚「503 · 沿用上一份」章。旁白 `n4` | 印章 |
| 11–12 | 信封火花落到「在听」那块上，块亮一下但标签不亮、不夹起，注「换歌不重印：交给推送」（第 03 章：换歌不失效首屏）；镜头推进这一块 | 主题，11:3 吸一口气；12:0 硬切第 05 章 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch04.n1a` / `n1b` | 1.55–3 | 访客拿到的是缓存好的 HTML，／请求路径上不现拉任何外部 API。 | Visitors get cached HTML; / no external API sits on that path. |
| `ch04.n2a` / `n2b` | 5.2–7.85 | 失效通知只带标签名，不带数据；／下一次访问先给旧页，后台重印。 | Only tag names travel, never data; / stale first, rebuilt in the background. |
| `ch04.n3a` / `n3b` | 8.15–9.48 | 标签只为布局变化而发；／内容变化等 600 秒定时重建。 | Tags fire only on layout changes; / content waits for the 600 s rebuild. |
| `ch04.n4a` / `n4b` | 9.55–10.86 | 回源碰上 5xx 或断网就抛错，／缓存不被覆盖，照给上一份。 | A 5xx or network error throws, / the last good copy keeps serving. |

## 05 电报线（18 小节）

事实：FACTS §5。画面标题「电报线 / The live wire」，副标 `wss://…/ws`。暗底，一整条横向示波图，横轴是时间：时间轴只画先后，不标毫秒（没重测过），机位之间的「≈」是省掉的一段。signal 色的示波线就是这一页的 /ws 电报线（发光层）：进来的电报是往下的脉冲，掉出一张白纸条；页面发出去的（hidden）是往上的脉冲。线上面是源站那一边，线下面是浏览器这一边。六个机位（A 解析、B 到站、C 进度、D 两只钟、E 数人头、F 到货表），强拍上甩。live 绿第一次出现在这一章，只给在线人数。画面和配乐共用 `v2/ch05.js` 顶部的时间表 `AT`。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 一个亮点沿时间轴扫过去，身后一段余辉；标题 | 0:0 硬切进来一声低「咚」；踩镲敲摩尔斯 CQ |
| 1–3.5 | 一长条 HTML 一格一格解析（光点走过一格才亮一格）；2:0 `<script>` 那一格跑完，接上电报线 `new WebSocket("…/ws?visible=1")`；2:1、2:3、3:1 三封电报（online、desktop、playing-now）从脉冲尖上掉进托盘（`queue`）。旁白 `n1` | 2:0 接线一声灯；三封各一声电键的「嘟」；踩镲拼 WS、LIVE |
| 3.5–5 | 3:2 一道竖刻线 hydrate，`useLiveEvents` 接过这根线；3:3、4:0、4:1 托盘里的按到达顺序一封一封飞进去（1 2 3）。旁白 `n2` | 3:1 吸一口气到 3:2；重放一封一声叮 |
| 5–7 | 线上面的 LivePushRoom 广播下来：5:0 主角 listening-now 到站，写进 SWR 的 `/api/status/listening/now`（receivedAt 换成新的，Mono 注 `mutate(path, data, {revalidate:false})`）；5:2「Now Playing」卡片纵向压扁再弹开：夜に駆ける → アイドル。旁白 `n3` | 5:0 主题（闷音拨弦，长音拆成三下点）；5:2 翻面一记 |
| 7–8.5 | 一只慢回来的旧轮询（receivedAt 更早）顺着虚线爬回来，8:0 撞上时间戳闸门 `guardPolled` 被弹开。旁白 `n4` | 8:0 撞上闸门、弹开一声（金属闸杆一响，弹回去一口风） |
| 8.5–10.5 | 线上没有消息。放大的「Now Playing」：进度条自己往前走，旁边竖写 `positionMs + (now − observedAt)`，now 标浏览器的钟、observedAt 标 Mac 的钟，注「只在播放时往前走」；歌词占位两行横条逐块亮。旁白 `n5` | 踩镲停下，只剩浏览器的钟一拍一响；铃跟着歌词块轻轻唱 |
| 10.5–12.5 | 两只正视钟面：线上面源站的钟停在 servedAt（只管首帧），10:3 挂载，虚线箭头穿过电报线交给线下面访客的钟；访客的钟一拍走一格，12:0 走到截止 `lastSeenAt + heartbeatWindowMs`，卡片上的在线点自己熄灭、换成 Offline，源站什么也没说。在线点画成 signal，不用 live 绿。旁白 `n6` | 12:0 在线点熄灭：一声很轻的、往下滑一个八度的玻璃音 |
| 12.5–15 | 同一根线数两种人：这一页的窗口（页脚 Online now 用 live 绿）、线上面的房间和一张「数人头」白卡（角标 `/count`；connections：开着的，含后台；online：正在看的）；13:2 切到另一个标签页，只发一声 `hidden`（往上的脉冲），线不断；14:0 online 03 → 02（live 绿），connections 不变。旁白 `n7` | 13:2 电键一声（往外发，比进来的高、短）；14:0 叮；踩镲敲 ON |
| 15–17.3 | 白卡「预期到货表」（角标 `nextLagDelay`）：可滞后卡在 `due = updatedAt + cadenceMs + LAG_GRACE_MS` 才去取（服务器、GitHub 贡献图、活动圆环三行，节奏按 `src/lib/status-views.ts#STATUS_VIEWS`），过了 due 从 15 秒起退避；右栏：推送连着时，在听列表、在看、在玩、奖杯的轮询取 `max(cardMs, PUSH_SAFETY_NET_MS)`，16:2 盖「≥ 5 min」章。旁白 `n8` | 15:1、15:2、15:3、16:0 一行一声叮；16:2 印章；踩镲敲 ETA |
| 17.3–18 | 拉远看整条示波线（几次到站的脉冲都在上面），17.72 起脉冲拉平成一条直线，往两头伸出画面。最后一帧：屏幕 y = 540 一条全宽水平直线（signalD，4 px） | 踩镲敲 SK（收报）；17:3 吸一口气，收在 A7sus4，18:0 交给第 06 章 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch05.n1a` / `n1b` | 1–3.5 | head 里的内联脚本先连 /ws，／不等 hydrate，消息先排进队列。 | A <head> script opens /ws early; / messages queue until hydration. |
| `ch05.n2a` / `n2b` | 3.5–5 | 连接还开着就直接接管，不再握手；／队列按到达顺序重放。 | Hydration adopts the same socket; / the queue replays in arrival order. |
| `ch05.n3a` / `n3b` | 5–7 | 推送自带数据，直接写进 SWR，／不再回源，卡片当场翻面。 | The push carries the data itself; / SWR updates with no refetch. |
| `ch05.n4a` / `n4b` | 7–8.5 | 闸门比的是数据自带的时间戳，／不是到达顺序：旧的盖不掉新的。 | The gate compares timestamps, / not arrival order, so stale loses. |
| `ch05.n5a` / `n5b` | 8.5–10.5 | 进度按观测时刻在本地外推，／整首歌都不用再发消息。 | Progress is extrapolated locally, / so playback costs no messages. |
| `ch05.n6a` / `n6b` | 10.5–12.5 | 源站只给原始时间戳，／在不在线，由浏览器按截止时刻判。 | The origin sends only timestamps; / the browser decides online/offline. |
| `ch05.n7a` / `n7b` | 12.5–15 | 切后台只发一条 hidden，／可见人数变了，房间才广播 online。 | Backgrounding sends one “hidden”; / online is broadcast only on change. |
| `ch05.n8a` / `n8b` | 15–17.3 | 可滞后卡不按定时器轮询，／按上次写入加节奏，算准再取。 | Lag cards don't poll on a timer; / they fetch when a write is due. |

## 06 两条线路（9 小节）

事实：FACTS §6。画面标题「两条线路 / Two lines」。纸面地铁图，线路只用两种颜色：lyjw.me 墨色、lyjw131.com signal；站点是圆点加站名。本章只讲请求时的分发与缓存；部署那一刻刷新 ESA、通知页面归第 09 章「发布」，它落地时借这张图的几何。

交接：0:0 只有一条墨线横穿整屏，在屏幕 y 540（第 05 章 17.5–18 把示波线拉平在同一高度），半小节内从 4 px 变粗成地铁线。9:0 镜头停在世界坐标 `[6400, 690]`、缩放 0.85，画面上只有两条横穿的线：墨色 lyjw.me 在屏幕 y 412、橙色 lyjw131.com 在 y 668（世界 y 540 / 840，线宽 14）；第 07 章从这一帧接着横移。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 第 05 章那条直线成了 lyjw.me 线，lyjw131.com 线从旁边画出来，两条都通到 Vercel 源站；标题 | 转调，声场铺开 |
| 1–4 | lyjw131.com 那条经过「阿里云 ESA」站，站旁挂一个 5 分钟钟面，标「过期先给旧页，后台回源 / Expired: old page first, refetch later」。旁白 `n1` | |
| 4–7 | 图片是索书号：一张借书卡写 `/img/<哈希>.webp`（Emby 海报；在听的封面来自 Apple 目录，不走这条路）；lyjw.me 由边缘 rewrite 代理到 R2，lyjw131.com 由 ESA 缓存同一路径。旁白 `n2` | |
| 7–9 | 借书卡收掉，两条线往右延伸，镜头跟着横移到节拍器那张纸，9:0 停住 | 收住，拨弦往下答一句（本章不唱信封主题）；收在 A7sus4，交给第 07 章 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch06.n1a` / `n1b` | 1.3–3.95 | ESA 可能回一份旧 HTML，／数据在挂载后直连 Worker 取新。 | ESA may serve a stale shell; / live data comes from the Worker. |
| `ch06.n2a` / `n2b` | 4.15–6.95 | 文件名就是内容的 sha256：／地址即版本，缓存一年也不会错。 | Files are named by SHA-256, / so caching them for a year is safe. |

## 07 节拍器（12 小节）

事实：FACTS §7。画面标题「节拍器 / Metronomes」，副标「固定、看 agent、看主机」。纸面上三台正视节拍器（梯形机身、摆杆绕底部支点转、摆锤越高档越慢）。一拍 = 一分钟，摆到一端「响」一下 = 这个上报器跑一轮；各台的响点和 `v2/music/ch07.js` 的底鼓、灯音是同一张表（`v2/ch07.js` 的 `PS_SEGS` / `LIM_SEGS`）。从左到右：服务器（server-reporter，固定，什么都不问）、编码账号限额（agents-reporter，看 agent 在不在用）、PlayStation（家里 n100 上的 playstation-reporter 容器，看主机醒没醒）。右上是一张「取限额的几家 agent」白卡：「最近一次使用」（此刻 / N 分钟前）和一排 15 格「15 分钟内算在用」，停手后一拍漏掉一格；只有限额那台连过去（`GET /api/status/coding/now`）。右下是家里的 PS5：容器和它在同一个局域网里，一直发发现包（小点一路走过去，一拍四个），回 `200` 是醒着、`620` 是休息、没应答是关机；PS 那台不看 agent，也不连那张卡。PS 的两档只写「快档 / 闲档」，不写间隔的数（FACTS §1）；限额和服务器那两台写分钟、秒。

交接：0:0 接第 06 章最后一帧（镜头 `[6400, 690]`、缩放 0.85，两条线横穿），同一张纸不切；0–0.95 往右横移到节拍器那一页，两条线在世界 x 7700 的终点站收住。11.45 起镜头冲进服务器那台，11.97 到位停住（12:0 那一帧属于第 08 章）；它 12:0 正好摆到右端，本章最后一帧摆尖在屏幕 (1100, 300)，第 08 章 0:0 心电图第一个尖峰的尖落在同一处。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 横移到节拍器那一页，三台已经在走；标题 | 回到 D 小调，钟摆和底鼓已经在响 |
| 1–4 | agent 在用、主机醒着：PS 每拍一响（醒着那一档）、限额每 5 拍、服务器每拍；限额每跑完一轮问一次那张卡，卡上「此刻」。2.6 起停手，卡上开始数「N 分钟前」、15 格一拍漏一格。旁白 `n1` | 全速：底鼓每拍（PS）、钟摆每拍（服务器）、灯音每 5 拍（限额） |
| 4–6 | 停手了、还在 15 分钟里：限额 4:0、5:1 两轮问到的仍算在用，照旧 5 分钟；PS 看的是主机，醒着就还是每拍；服务器不变 | 半速：底鼓照旧每拍，踩镲和琶音减半，灯音照旧 5 拍一声 |
| 6–9 | 入夜：6:0 发现包回 `620`（主机进休息），PS 当拍响最后一下，摆锤滑到顶上的闲档（摆杆几乎不动）；7:2 主机断电、发现包没人应答，休息和关机同一档，不额外打；限额 6:2 那一轮问到的已过 15 分钟，换 60 分钟，打盹（摆杆停住、头顶一串 z，右边一排 12 格「60 分钟 = 12 次 5 分钟的盹」，7:3 醒一下看一眼又睡）；只有服务器每拍照旧。旁白 `n2`。Clawd 在限额旁边一起打盹 | 很慢：只剩服务器的滴答 |
| 9–11 | 早上又开始写代码：8:3 Clawd 跳起来，卡上回到「此刻」；9:0 限额那次小睡醒来问到在用，不等 60 分钟，当场跑一轮、回到 5 分钟；PS 不看 agent，主机没醒就还停在闲档（注「PS 不管谁在写代码，只看主机醒没醒」）；9:3 按下主机电源，灯带先亮；10:0 发现包回 `200`，PS 当拍就响、之后每拍（注「醒着和没醒对调，当场打一轮」，小字「退避没到时一律不放行」）。旁白 `n3` | 8:3 Clawd 跳一下；9:0 限额的灯音；9:3 按键一声、吸一口气；10:0 底鼓回来、回到全速，节拍器的小铃唱信封主题 |
| 11–12 | 使用情况读不到：限额那条线上打一个叉；11:2 它照常跑完那一轮，问不到就当没在用，换 60 分钟又去打盹（卡上其实还是「此刻」）；PS 和服务器照旧；脚注式旁白 `n4`；11.45 起镜头冲进服务器那台 | 11:2 最后一声灯音；底鼓（PS）和钟摆照旧；12:0 这一下变成第 08 章的心跳 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch07.n1a` / `n1b` | 1–4 | 限额每轮都要调厂商接口，／跑完看 agent 在不在用，定下一轮。 | Each limits round calls vendor APIs; / agent activity sets the next wait. |
| `ch07.n2a` / `n2b` | 6.3–9 | 服务器每分钟照报：快照即心跳，／先问一句反而比直接报更费。 | Snapshot = heartbeat, each minute; / asking first would cost more. |
| `ch07.n3a` / `n3b` | 9–11 | 开机后第一探读到 200，／紧跟着问一轮 PSN、寄一封。 | Power on: the first probe reads 200, / then a PSN round, then an envelope. |
| `ch07.n4a` / `n4b` | 11–11.75 | 使用情况读不到，一律当没在用：／故障只会让限额变慢。 | Activity unreadable? Treat as idle. / Failures only ever slow it down. |

## 08 心电图与地层（12 小节）

事实：FACTS §3「api 的 cron」「Pulse 事实时间线」、§8。画面标题「心电图与地层 / Heartbeat and strata」。暗底 + 白卡；Sentry 那边不出组织名、监控 ID、真实报错标题、可用率数字；令牌只画成一张卡、标 `GET`（采集 Worker 只拿它发 GET 查询；权限范围未核，不说「只读」，见 FACTS §8）。live 绿在这一章第二次、也是最后一次出现，只给 LYJWPAGE 卡上今天那一格。一拍 = 一分钟（接第 07 章）。一张暗底图纸：地面是一条心电图横线，线上是外面（Sentry），线下是站点（lyjw.me、workers/api），再往下是地层（D1）。心电图是往左卷的监护仪，笔尖固定，右边是还没发生的；尖峰朝信号走的方向：敲门从上往下进来（尖朝下，落在每拍的后半拍），报到从下往上出去（尖朝上，落在整 5 拍上）。拍位和 `v2/music/ch08.js` 是同一张表（`v2/ch08.js` 的 `CHECKS` / `KNOCKS` / `AT`）。

交接：0:0 接第 07 章冲进服务器那台的最后一帧，硬切暗底、不落黑：首帧只有一根报到尖峰，尖在屏幕 (1100, 300)（第 07 章摆尖的位置），左边那条斜边和摆杆一样斜，笔尖停在尖上发亮；0–0.95 往后拉出整条心电图。12:0 镜头已经从地层升回地面，停在 `[960, 540]`、缩放 1：画面上只剩心电图横线（屏幕 y 540，笔尖在屏幕 x 1350），标签、方框、地层都已收掉；第 09 章从这一帧硬切纸面，横线成了 git 的 main 线。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 首帧那根尖峰往后拉开，心电图横线出来；标题 | 底鼓就是心跳（lub-dub）；0:0 报到一声往上挑的低音 |
| 1–4 | 同一条线上两种方向相反的信号：线上的 Sentry 每分钟来敲门（HEAD `/api/version`，尖朝下，进 lyjw.me，注「只说明 Vercel 还在出页面」）；线下 workers/api 的 cron 每 5 分钟一轮，每轮去报到（尖朝上，到 Sentry）；Sentry 的框里 lyjw.me、API 两行记录一格一格往里加；2.5 起冷面脚注「* 报到只证明 cron 跑完了。」。旁白 `n1` | 敲门是后半拍一声指节叩木门，报到是整 5 拍一声往上挑的低音（1:1、2:2、3:3） |
| 4–6 | 往右：采集 Worker 的小钟走到整 5 分钟，5:0 拿令牌去 Sentry 查（卡上标 `GET`），5:1 结果带回来，经可滞后层（KV LAG）上 LYJWPAGE 白卡：lyjw.me、API 两行各 30 天一格，5:2 今天那一格亮（live 绿）；卡上只写 Operational 和 30 days ago / Today，不出可用率。旁白 `n2` | 5:0 令牌一声；5:2 高音灯 |
| 6–8 | 镜头纵向下沉进地层：一层一层是 Pulse 卡上那几条道（道名一栏贴着画面左边，顺序照 Pulse 卡），墨色深浅交替，里面是原始事实的示意（区间、瓦数、桶）；右沿是此刻，workers/api 的 cron 每 5 拍（和报到同一轮）掉下一片压进右沿（注「每 5 分钟压进一薄片」）；右边 D1 档案架「lyjwpage-history · 长期保存」，底下「← 越往左越早，一直留着」；7:0 Listening 那一层里正在放的这首歌亮一下。旁白 `n3` | 低通收窄，敲门隔着地层变闷，压进一片时一声翻纸（和报到同一拍：6:1、7:2、8:3）；7:0 低音马林巴唱信封主题 |
| 8–10 | 推近 Coding 那一层（其余几层的数据和道名淡掉）：一窗一格，格里两道细刻线分出三个 5 分钟桶（注「一窗 = 三个 5 分钟桶」），下面 Tokens 那层是三个来源的桶叠在一起（注「Mac · 云端 · Cursor」）；8:1 全零的窗先落到最低档，标「不问 Clef，直接最低档」；8:2 起 Clef（「打分（示意）」）一窗一窗往右打，每半拍一窗（先后和快慢都是示意），打出来的档是窗里的一根横线（高低是示意）；贴着此刻那一窗还没满，不打；Clef 那一格上方注「打分只在屋里放 7 天，不进 D1」（打分记在 StateHub，不归档）。旁白 `n4` | 8:1 一声闷拨弦；8:2 起每打一窗一声小铃 |
| 10–12 | Clawd 从地层上沿冒出来说收尾那句（气泡）；11:0 起镜头升回地面，标签、方框、地层一起收掉，停在只剩心电图的一帧 | 10:1 冒出来一声；11:3 吸一口气，收在 A7sus4，交给第 09 章 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch08.n1a` / `n1b` | 1–4 | 外部探测从 Sentry 打进来，／cron 从 Worker 里主动报出去。 | Sentry probes in from outside; / the Worker's cron reports out. |
| `ch08.foot` | 2.5–4 | 报到只证明 cron 跑完了。 | A check-in only proves the cron ran. |
| `ch08.n2a` / `n2b` | 4–6 | 查 Sentry 的是采集 Worker，／页面只读可滞后层，不碰 Sentry。 | The collector queries Sentry; / pages only read the lag layer. |
| `ch08.n3a` / `n3b` | 6–8 | cron 每 5 分钟按水位写进 D1，／各路独立，一路坏了不挡别路。 | Rows past the watermark go to D1; / a failed stream blocks no other. |
| `ch08.n4a` / `n4b` | 8–10 | 窗关上两分钟后才交给 Clef，／输入是前台应用、agent 与 token。 | Two minutes after a window closes, / Clef weighs apps, agents and tokens. |
| `ch08.clawd`（气泡） | 10.35–11.45 | 线上出错时，／我先去 Sentry 查证据。 | When something breaks, / I check Sentry first. |

## 09 发布（16 小节）

事实：FACTS §9。下表按 `v2/ch09.js` 和 `v2/music/ch09.js` 的现状写。画面标题「发布 / Release」，副标 `main → GitHub Actions · Vercel · Workers Builds · GHCR`。纸面（接第 08 章的暗底，明暗交替）。一张流水线总图，一根主轴贯穿全章，就是屏幕 y 540 那条线：第 08 章的心电图 → git 的 main → Vercel 那条流水线 → 第 06 章的 lyjw.me 线。其余流水线从这次的提交（HEAD）散开，按平台分组：GitHub Actions 在主轴上方，Workers Builds 在下方；三张详图（A 检查、B Worker、C 上报器）排在总图下面，图号和总图右边的分组标记对应；落地时回到主轴，用第 06 章两条线路图的原样几何（整体平移，只画线和站，不讲缓存）。画面和配乐共用 `v2/ch09.js` 顶部的时间表 `AT`。那次推送改到的路径和画面上的短哈希都是示意（FACTS §9）。

交接：0:0 接第 08 章最后一帧（心电图横线，镜头 `[960, 540, 1]`，笔尖在屏幕 (1350, 540)），硬切纸面：同一高度一条墨线（git 的 main），提交的圆点落在第 08 章那几处敲门尖峰的横坐标上，这次的提交在笔尖的位置；首帧只有线和圆点。16:0 镜头停在 `[MX + 1400, 540]`、缩放 1，画面上只剩主轴那一段（第 06 章 lyjw.me 线的 O → L）收成的一根 3 px 墨线，横穿屏幕 y 540；第 10 章从这一帧硬切暗底，同一高度的这条线成了它长图版的脊线（见第 10 章）。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1.5 | 硬切纸面：main 线与提交圆点；0.3 起标题；0.35 起左下一张「这次改到的路径」（四个目录）；0:1 起打字机敲出 `$ git push origin main`（一个十六分两个字），1:0 回车，下一行 `5939ef8..c47d2a1  main -> main`，HEAD 亮一圈、标出短哈希 | 0:0 一声低「咚」落地，空五度的铃垫着；打字声；1:0 纸滑出去（推上 GitHub） |
| 1.5–3.5 | 1.45–1.9 拉远，标题、终端、改动卡退掉；1.5 起八条流水线从 HEAD 散开（GitHub Actions：Hub 发布、上报器镜像、CodeQL、CI；主轴：Vercel；Workers Builds：api、ingress、collector、ai），右边括线分组，图号 A、B、C 对应下面三张详图；2:0 起每条闸门一个十六分：放行的打勾，线上写放行的理由（改到的路径，或「每次推到 main」），ingress、collector、ai 划一道、写「没改到」，闸门后变虚线、灯是空的；放行的几条同时有火花往前走。旁白 `n1` | 1:2 分叉声；2:0 起闸门一条一声：放行的「叮」往上爬（A5 C6 D6 E6 F6 A6），没改到的三条各一声闷拨弦；律动进来 |
| 3.5–5.5 | 甩到详图 A「检查」：CI 四项（lint · typecheck 全部工作区 · test 站点、Worker、上报器、脚本 · docs:check 文档与注释的漂移）每拍勾一项，5:0 亮灯；CodeQL 两项（javascript-typescript · actions 工作流本身）在后半拍勾，5:1 亮灯；注「另有每周一次定时扫描」「不跑 next build：Vercel 每次都会构建」「同一分支连推几次，只留最后一次」。旁白 `n2` | 每勾一项一声叮；两声灯 |
| 5.5–7.5 | 甩到详图 B「Worker」（Cloudflare Workers Builds）：四行，各写监视路径；api 那行另写 `− shared/ingest/*` 和「改上报校验不会重新发布 api：Durable Object 不重启」，放行后 typecheck（6:0）→ wrangler deploy（6:2）→ 7:0 亮灯、标 `api.homepage.lyjw.llc`；ai、ingress、collector「没改到：不构建，线上仍是上一版」，6:1、6:1.5、6:3 各闪一下；脚注「四个都另盯着根目录的依赖与配置」。旁白 `n3` | 6:0 叮，6:2 气动管，7:0 灯；6:1、6:1.5、6:3 闷拨弦 |
| 7.5–10 | 甩到详图 C「上报器」：容器镜像一行（buildx `linux/amd64` → GHCR `latest · sha-c47d2a1` → ssh misaka-jp「受限密钥，只跑部署脚本」→ running `restarts=0`），8:0 起一拍一步，9:0 亮灯 misaka-jp；ssh 那一步往下一根虚线打叉，接 dsm、n100「内网两台：手动更新」；Mac Telemetry Hub 一行（子模块指针）：9:1 Developer ID 签名，公证排队，9:2.5 盖 notarized，9:3 发 Release `hub-build-<运行号>`。旁白 `n4` | 8:0 叮，8:1 气动管，8:2 钥匙，8:3 叮，9:0 灯；9:1 叮，公证时钟摆走，9:2.5 印章，9:3 灯 |
| 10–12.5 | 甩回主轴，落在第 06 章两条线路图上：10:0 Vercel 那条的火花过 next build、到源站，Production 亮；10:1 一根虚线 `deployment_status` 叫起 GitHub Actions 的单子；10:2 ESA 手上的首页划掉、盖 purge，10:3 新的一份从源站沿 lyjw131.com 线预热回来，第一项打勾；11:0、11:1 两个终点站先后打勾（两个域名的 `/api/version` 答出新版），11:2 第二项打勾；第三项「通知上报入口（ingress Worker）」，注「失败重试，最长 10 分钟」。旁白 `n5` | 10:0 落地一声 + 灯；10:1 叮，10:2 印章，10:3 气动管；11:0、11:1、11:2 三声叮 |
| 12.5–15 | 12:0 第三项打勾，火花顺着线往右出画；12.25 镜头跟过去：12:2 上报入口放行（权限 `internal:site-deployed`），经 Service Binding 到 StateCore 的 `broadcastVersion()`，13:0 推送房间 LivePushRoom 广播 `version`（不带数据），橙环荡开扫过两个窗口；13:2 两个窗口各自问 `GET /api/version → c47d2a1`；14:0 前台 lyjw.me 纵向弹出 UPDATE 卡（`5939ef8 → c47d2a1`）；14:2 后台 lyjw131.com 的标签页自己刷新，从上往下换成新的一版；脚注「收不到通知也没关系：每 30 分钟、切回前台时各问一次」。旁白 `n6` | 12:0 钥匙，12:2 叮，12:3 吸一口气；13:0 广播，第二支铃唱信封主题（高八度），拨弦低八度跟着；14:0 翻面一记；14:2 纸滑 |
| 15–16 | 15:0 拉远看整张图纸（PLATE 09 · RELEASE，灯都亮着，开场的标题、终端、改动卡回来）；15.5 起落回主轴，别的一起退掉，主轴收成一根细墨线；最后一帧只剩屏幕 y 540 那条线 | 15:0 呼啸，15:3 吸一口气；收在 Ebmaj7s11 → A9sus4，交给第 10 章 0:0 的 Dm9 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch09.n1a` / `n1b` | 1.95–3.3 | 推到 main，几条流水线同时触发；／设了监视路径的，没改到就不跑。 | A push to main fans out at once; / watch paths decide who sits out. |
| `ch09.n2a` / `n2b` | 3.6–5.25 | CI 和 CodeQL 只检查、不发布；／next build 留给 Vercel 去跑。 | CI and CodeQL check but never ship; / next build is left to Vercel. |
| `ch09.n3a` / `n3b` | 5.6–7.5 | Worker 各自构建、互不等待：／契约只加不改，新接口先发被调用方。 | Each Worker builds on its own; / APIs only grow; ship the callee first. |
| `ch09.n4a` / `n4b` | 7.85–9.75 | 上报器的镜像推到 GHCR；／Mac 的 Hub 签名、公证后发 Release。 | Reporter images go to GHCR; / the Hub is notarized, then released. |
| `ch09.n5a` / `n5b` | 10.1–12.25 | 部署成功才刷新 ESA 首页；／先等两个域名换好，再通知页面。 | ESA is purged only after the deploy; / pages hear after both are polled. |
| `ch09.n6a` / `n6b` | 12.6–14.95 | 页面收到 version，自己去问版本：／前台弹出提示，后台的旧页自己刷新。 | Pages hear “version” and re-check: / visible: a prompt; hidden: a reload. |

## 10 一首歌的旅程（14 小节）

事实：FACTS 全篇。下表按 `ch10.js` 和 `v2/music/ch10.js` 的现状写。画面标题「一首歌的旅程 / One song's journey」。一张横向长图版：第 01–09 章各缩成一格、一格一个机位那么高，暗底的格画在墨色图版上，纸面的格是一张张纸，远看是全片的明暗节奏；信封经过哪一格，镜头就推近那一格、用那一章的画法闪回。第 08 格的心电图照抄第 08 章的几何，第 09 格（发布）在它右边，是第 09 章流水线总图的缩样（主轴、之前的提交、从 HEAD 散开的几条流水线，收尾时灯都亮着），只在全景里看得到；其余往左排。各章的画法抄成本章的局部函数；第 00 章的终端和「正在听」那一段直接调第 00 章登记对象上的 `share`。延迟不标数（没重测过）。旁白一格一行，排在各机位的左下。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 接第 09 章最后一帧（屏幕 y 540 一条整宽墨线）：硬切暗底，同一高度一条整宽的骨白线，就是第 08 格拉平的心电图加上笔尖往右接到格子右沿的那一段；0.05 起心电图的尖峰长出来，0.2 起镜头往后拉出整条长图版，标题；0.8 起冲进第 01 格 | 0:0 落回 Dm9，一声低「咚」，主题全体唱一遍（铃、第二支铃唱三度、拨弦低八度）；0:3 吸一口气 |
| 1–4 | 01（暗底专利图）：1:1 换歌（夜に駆ける → アイドル），1:2 信封从菜单栏的 Hub 出来，1:3 飞出这一格；02（纸面）：2:0 mac 的钥匙开门，2:2 过秤，3:2 拆开、appleMusic 那一格进实时那根管子。旁白 `n1a`（01）、`n1b`（02） | 1:1 读数灯；2:0 钥匙、2:2 一声叮、3:2 气动管，打字机当踩镲 |
| 4–7.5 | 03（暗底平面图）：排队、4:2 落账、5:0 账本换成「要做的事」详图、5:2 纸条递出去；6:0 门外照单去办、盖 waitUntil，回执和推送同一拍出发；6.2 起拉远：回执往左回到第 02 格，6:2、6:3、7:0 三盏灯亮，7:1 盖 202；推送往右经过第 04 格（7:0 在听那块亮一下，注「换歌不重印：交给推送」）。旁白 `n2a`（03）、`n2b`（拉远） | 十六分的钟摆、暖铃唱主题；6:0 广播 + 印章；三盏灯 A5 D6 F6；7:1 大章 |
| 7.5–10.5 | 05（暗底示波器）：8:0 脉冲到站，纸条落进浏览器缓存（8:2 receivedAt 换新），火花奔向迷你页面里「正在听」那一格；9:3 切到第 00 章那张主页，10:0 火花落卡、卡片翻面，和第 00 章第 4 小节同一个画面（同一个函数画）。旁白 `n3a`（05）、`n3b`（主页） | 8:0 电键、闷音拨弦唱主题，8:2 叮；9:3 吸一口气；10:0 翻面，拨弦唱回第 00 章第一次出场的样子 |
| 10.5–12.5 | 10:2 切回第 00 章的终端：欢迎框里 Clawd 按官方 celebrate 庆祝两次，下面是片尾字卡 | 10:2 终和弦 Dmadd9（主题四个音都在里面）和一声低的；Clawd 每次举手跳一下，一下一声往上挑的小「啾」（A5 D6，第二次 E6 A6） |
| 12.5–14 | 拉回整个终端，13:0 起自下往上清屏，13.5 起停在第 00 章第一帧：同一个函数、同一份状态，只差后期颗粒 | 13:0 清屏一声很轻的、从低往高的擦声；尾音淡出；第 00 章从同一个 Dmadd9 起 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch10.n1a` / `n1b` | 1.05–1.8 / 2.05–3.8 | Mac 只寄出 appleMusic 这一格，／入口验过 JWT，分进实时那根管； | The Mac sends just appleMusic; / ingress verifies it, sorts it live; |
| `ch10.n2a` / `n2b` | 4.1–6.0 / 6.02–7.5 | StateHub 串行落账，交回效果单；／回执回入口盖 202，推送同时出发。 | StateHub commits, returns effects; / 202 goes back as the push goes out. |
| `ch10.n3a` / `n3b` | 7.85–9.5 / 10.05–10.5 | WebSocket 到站，写进 SWR 缓存，／卡片当场翻面。 | The WebSocket lands it in SWR, / and the card flips. |
| `ch10.end1` | 10.6–13.2 | 谢谢观看 | Thanks for watching |
| `ch10.end2` | 10.6–13.2 | 讲解 Claude Opus 5.5 · lyjw.me | Narrated by Claude Opus 5.5 · lyjw.me |
