# lyjw.me 运行原理 · 分镜与旁白（v2）

> 类型：reference

新版 `/explainer`（`v2/`，全篇 2D）的分镜。三样东西以这里为唯一出处：**章节表**（每章小节数，`v2/plan.js` 抄这里）、**每一段的画面要点**、**中英旁白原文**（各章文件顶部的 `I18N.add` 抄这里）。事实出处在 [FACTS.md](FACTS.md)，画法、母题与调色板在 [TREATMENT.md](TREATMENT.md)，写章的契约在 [v2/CONVENTIONS.md](v2/CONVENTIONS.md)。

- **节拍**：108 BPM，4/4，一小节 20/9 秒（约 2.22 秒）。小节从 0 数，章内写「小节:拍」，拍也从 0 数：5:2 是第 5 小节的第三拍；表里「2–5」指第 2 小节开头到第 5 小节开头。
- **主角**：Mac 上的一次换歌（`mac · appleMusic`）。片子跟着这封信封，从 Mac 一路走到访客屏幕上那张「正在听」卡片翻面。
- **旁白**：每句两行，逐字亮起，排在图版里，不是字幕，也不是 Clawd 的气泡。按 60 px、`maxW` 1040 排：中文每行不超过 17 字，英文每行不超过 36 个字符（Geist 60 px 平均约 28 px 一个字符），再长会被缩到 56 px 以下。改旁白先改这里，再改章节文件。
- **Clawd**：片子的脸，每章都有戏，说的话放在气泡里，不算旁白：开场的终端和第 00 章主页上的客串、第 01 章结尾骑上信封、第 02 章骑着火花进门、第 03 章账房桌角、第 04 章拽印刷手柄、第 05 章戴耳机的报务员、第 06 章从地层冒出来、第 07 章 Opus 卡上戴安全帽的 Architect、第 08 章整章（一只 Clawd 就是一个 Claude）、第 09 章拿放大镜看两个域名换好的小 Clawd、第 10 章一路追着信封跑，片尾四只戴道具的 Clawd 在终端里谢幕。
- **不上画面**：见 [v2/CONVENTIONS.md](v2/CONVENTIONS.md)「事实」一节。编码用量只讲到「Mac、云端、容器里的 Cursor 各报原始事实，站点侧合并；Pulse 上有一条 token 处理量（5 分钟平均）」，不点存储键和模块名；不说「生成速度」，也不说它是此刻的精确值（FACTS §1「编码用量」）。

## 章节表

小节数已锁定。要改，先改这张表和总长，再由主创改 `v2/plan.js`；两边不一致时 `v2/film.js` 报错并以 plan.js 为准。

| 章 | 图版 | 底 | 小节 | 起止（小节） | 起止（时间） | 交给下一章 |
|---|---|---|---|---|---|---|
| 00 | 这张卡片从哪来 | 暗 → 纸 | 11 | 0–11 | 0:00.0–0:24.4 | 冲进总览图「采集端」那一栏，11:0 硬切暗底 |
| 01 | 野外观测站 | 暗 | 17 | 11–28 | 0:24.4–1:02.2 | Clawd 蹲在信封火花上骑出右缘；硬切纸面，它骑着火花从左边进场 |
| 02 | 门禁与分拣 | 纸 | 20 | 28–48 | 1:02.2–1:46.7 | 冲进「状态核心已提交」那盏灯，整屏橙色后落黑 |
| 03 | 一间屋子的账房 | 暗 + 白卡 | 16 | 48–64 | 1:46.7–2:22.2 | 冲进对照表白卡下方的空白，满屏是纸，不落黑 |
| 04 | 活字印版 | 纸 | 12 | 64–76 | 2:22.2–2:48.9 | 推进「在听」那块印版，12:0 硬切暗底 |
| 05 | 电报线 | 暗 | 18 | 76–94 | 2:48.9–3:28.9 | 示波线拉平成屏幕 y 540 一条直线；切到心电图，这条线就是基线，报到尖峰从上面立起来 |
| 06 | 心电图与地层 | 暗 | 14 | 94–108 | 3:28.9–4:00.0 | 镜头从地层升回地面后停住，问这座邮局是谁建的；硬切纸面，横线收成对话卡的输入框，笔尖成了光标 |
| 07 | 对话 | 纸 | 16 | 108–124 | 4:00.0–4:35.6 | 落回 main 线，只剩提交圆点和 HEAD；硬切暗底，第 08 章首帧是同一条线 |
| 08 | 一句话之后 | 暗 | 20 | 124–144 | 4:35.6–5:20.0 | 落回 main 线，Clawd 举牌「等 lyjw 验收」后跳出画面；硬切纸面，第 09 章首帧是同一条线 |
| 09 | 发布 | 纸 | 10 | 144–154 | 5:20.0–5:42.2 | 拉远看整张图版，落回主轴只剩屏幕 y 540 一根墨线；硬切暗底，这条线是第 10 章长图版的脊线 |
| 10 | 一首歌的旅程 | 暗 → 纸 → 暗 | 16 | 154–170 | 5:42.2–6:17.8 | 15.6 起停在第 00 章第一帧，首尾相接可以循环 |

合计 170 小节，6 分 17.8 秒；配乐另有 2 秒尾音（`Score.tail`），尾音期间第 00 章第一帧的光标按半秒闪。

交接默认是强拍上硬切；表里写了做法的，由前后两章的作者按它对一次。每章的配乐也要照顾自己的首尾两拍（见 CONVENTIONS「交接」）。

## 00 这张卡片从哪来（11 小节）

事实：FACTS「一句话总览」。下表按 `ch00.js` 和 `v2/music/ch00.js` 的现状写。画面标题「这张卡片从哪来 / Where does this card come from?」（7.55 起在页眉上，由大字问题翻过去）。终端和「正在听」那一段挂在本章登记对象的 `share` 上，第 10 章在它的 10:0 前后和收尾借它画同一个画面（借的时候不传 `cameo`，主页上客串的 Clawd 不出现）。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–2 | 暗底终端，Geist Pixel 字：`$ claude` 从 0:0.5 起一格十六分一个字敲出，0:2 回车；欢迎框里 Clawd 按官方入场（skip → jump → look → celebrate，一帧 60 ms，各段从拍上起），0.75 起气泡，三行逐字显出，1.97 收起。第 0 帧（只有提示符和常亮的光标）也是全片最后一帧 | 只有 pad 和打字声（一个字一声，回车重一下） |
| 2–4 | 2:0 硬切纸面：浏览器窗口里的主页线框一笔笔画出来（卡片框取第 04 章 P 表的实测比例，出处 `src/app/page.tsx`；首排右格是 In Brief 卡，画三行摘要条和一个照 `DayDial` 画的表盘，真卡没有可见标题，所以不画标题；这一刻没在充电，「最近播放」占满那一行，下面是整行的对话卡，被窗口下沿切掉）；3:0 起镜头推到「正在听」那张卡；3.55 起火花顺着一根线从画面左边进来，3.62 起 Clawd 跟着火花跳两下进场，站在那根线上（屏幕上约 120 px 宽） | 2:0 低低一声落地，主题第一次出场（拨弦唱，高八度的铃叠一层）；3:3 吸一口气，3:3.2 Clawd 小跳 |
| 4–6 | 4:0 火花落到封面上（橙点留在卡上），歌名纵向压扁再弹开：夜に駆ける → アイドル，Clawd 同一拍跳一下（官方 jump），4.75 左右看；4.25 大字问题，别的卡退淡；5.5–5.66 Clawd 跳出左缘（早于 6.05 的旁白） | 4:0 翻面一记；4:0.22、4:0.86 Clawd 小跳 |
| 6–7.5 | 6:0 问题收小到左上成页眉（`00`、问题、`lyjw.me · /api/status/listening/now`：这张卡读的端点），旁白 `n1` | |
| 7.5–11 | 顺着那根线往回拉，拉出总览图：采集端（上报器和云端遥测的小样，一个漏斗收进入口）→ 中枢（上报入口 ingress、状态核心 api、采集 Worker collector，左上另有「对话与构建」ai，一根细线接到状态核心；下面一根横梁挂四个库的符号，`K.glyph`）→ 展示（浏览器窗口）；那根线从 Mac 一路水平穿过入口和状态核心，落在封面上。页眉翻成本章标题；总览落定后多停一小节；9:0、9:2、10:0 三栏各亮一下；旁白 `n2` 停到 10.5；10:2 起冲进采集端里 Mac 那一格，11:0 硬切第 01 章 | 7:2 往回拉；8–9 律动全开，三栏各一声灯音（9:0 A5、9:2 D6、10:0 F6）；10:2 下坠，母线低通在第 01 章 0:0 最闷、0:1 打开；最后一小节没有旋律，收在 A7sus4 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch00.clawd`（气泡） | 0.75–2 | lyjw 出主意，／我们几个 Claude 动手。／先带你拆开 lyjw.me 看看。 | lyjw has the ideas; / a few of us Claudes build. / First, let me open up lyjw.me. |
| `ch00.q`（标题） | 4.25–7.55 | 这张卡片，是怎么知道的？ | How does this card know? |
| `ch00.title`（页眉） | 7.55–10.5 | 这张卡片从哪来 | Where does this card come from? |
| `ch00.n1a` / `n1b` | 6.1–7.5 | 全片跟踪一封上报信封：／Mac 上 Apple Music 换了一首歌。 | We trace one report end to end: / a song change on the Mac. |
| `ch00.n2a` / `n2b` | 8.1–10.5 | 上报器发 POST，Workers 记状态，／site Worker 出首屏，浏览器收推送。 | Reporters post; Workers hold state; / site Worker renders; browsers listen. |

## 01 野外观测站（17 小节）

事实：FACTS §1。下表按 `ch01.js` 和 `v2/music/ch01.js` 的现状写。画面标题「野外观测站 / Field stations」，副标 `reporters · collector Worker`。一长条暗底图纸，镜头只做横移，每件仪器一个机位：前一拍（x:3）起甩 0.25 小节，下一小节 0:0 落定，停住时慢推；每个机位动作做完后至少停一小节，旁白第二行写完到淡出至少 0.3 小节。仪器是正视专利图（骨白发丝线、FIG. 图号、剖切斜线），要读的字放进白卡详图。每次往右甩镜头都配一口轻风（`whoosh` 的 `tube: "whip"`，x:2.95 起，中点对着镜头最快那一刻，从右往左扫）。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–2 | 硬切进暗底：标题；右边一条图纸索引，七个图号的小样：前五个是外部上报器（第 3 号是 Home Assistant 和 n100 上的容器，第 5 号是东京那台主机上的容器），括线只标「上报器」；第 6 号是云端那一小段遥测（虚线），号下注「独立入口」；第 7 号是表盘，标「采集 Worker」。上报器和采集任务的个数只画不说。旁白 `n1`，1:3 起甩向 Mac | 0:0 低「咚」，pad 和翻图纸声 |
| 2–3 | FIG. 1 笔记本（Mac Telemetry Hub，菜单栏 App）在甩镜头时画出来，屏幕上 Apple Music 还在放夜に駆ける；右边白卡逐字敲出信封的格式 `{version:4, presence, heartbeatAt, activeModules, modules:{…}}`，modules 一行四格都是虚线 | 打字机敲信封 |
| 3–4.5 | 3:0 歌名压扁再弹开（夜に駆ける → アイドル）；3:2 四格里只有 appleMusic 那格亮（橙），注「没变的模块不寄」；3:3 信封从菜单栏的 Hub 图标出来，4:0 停在笔记本旁边。旁白 `n2a` | 3:0 读数灯（本章专用的玻璃 FM，旋律乐器 glass）唱主题，低八度闷拨弦垫一层；4:0 往下答一句 |
| 4.5–5 | 没变化时：4:2 一个空信封呼吸一次（圆环缩放），标「90 s」「空信封 = 心跳」。旁白 `n2b` | 4:1 吸一口气，4:2 远处一声 |
| 5–7 | 切应用：菜单栏的前台应用 5:0 换一次、5:1 又换一次，平面刻度尺的指针回零重新量，5:3 量满 400 ms 落定，注「切应用默认先等 400 ms 落定」（Hub 设置里能调）「落定前又切：重新计时」。旁白 `n2c` | 5:3「叮」 |
| 7–9 | FIG. 1A 窗口标题（画成几块遮住的字）过 Jev：7:1 起几道问题的横条同时走，8:0 同一刻一起给出概率条（示意值，不标数，不和出路对应）；两条出路，8:1 这一次的标题走放行那条进信封，8:2 拿不准那条弹给 lyjw。旁白 `n3` | 十六分的钟摆（问题在走），8:0 翻转一记，8:1 纸滑进信封，8:2「叮」 |
| 9–11 | FIG. 1B 图片：9:0 起应用图标的像素压成一串哈希 `sha256….png`，9:2 落进 R2 的抽屉、同一刻信封卡上写出 `iconObjectKey`，9:3 抽屉关上；注「同一内容，同一个键」。旁白 `n4` | 打字机敲哈希，9:3 抽屉锁舌 |
| 11–14.6 | 其余来源收成一块板，八张卡一次只亮一张，其余压暗当纹理：iPhone（HealthKit 唤醒）、HomePod（钥匙只开 /homepod）、PlayStation（先探醒，再问 Sony）、NAS（海报先于信封）、东京（同机各用各的钥匙）、云端（自己发，核心算差）、用量（三处相加 · 5 分钟均）、采集（每分钟，并推断播放）。不重演推断播放的时钟求交。旁白 `nMa`–`nMd` | 11–13 鼓停，只留 pad；每张卡亮起一声轻叮（A5 C5 D5 E5 G5 A5 D6 E6）；14 鼓轻轻回来 |
| 14.6–17 | 14.8 起镜头甩回 Mac：15:0.8 那封换歌的信封亮起，Clawd 15.2 落到信封旁，气泡「我跟着这一封走。」；15.86 跳上信封，信封收成火花，Clawd 蹲在火花亮核上往右骑出画面（屏幕 y 540，约 16.98 出右缘）。出口姿态：默认姿势蹲下、不翻转，屏幕上 126 px 宽，水平中心对着亮核，底边比亮核高 7 px（`ch01.js#clawdRide`），第 02 章 0:0 照这个从左缘接 | 14:3.2 甩回来的风声；15:0.8 灯，15:1.12 落地，15:1.8 气动管，15:3.44 跳上信封，15:3.8 吸气；收在 A7sus4 上，给第 02 章 0:0 的主题让路 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch01.n1a` / `n1b` | 0.3–1.8 | 上报器在数据源头主动推送；／第三方接口由采集 Worker 定时拉取。 | Reporters push from the source; / a cron Worker polls external APIs. |
| `ch01.n2a` / `n2b` | 3.05–4.97 | Mac 只寄这一次变了的模块；／没变化时，每 90 秒寄一封空信封。 | The Mac sends only changed modules; / idle: an empty envelope every 90 s. |
| `ch01.n2c` / `n2d` | 5.05–6.74 | 前台应用的切换先防抖：／连切几次，只报最后停住的那个。 | App switches are debounced: / a burst reports only the final app. |
| `ch01.n3a` / `n3b` | 7.05–8.97 | 窗口标题先经 Jev 做隐私判断；／拿不准的交给 lyjw，放行的才进信封。 | Jev screens window titles first; / unsure ones go to lyjw. |
| `ch01.n4a` / `n4b` | 9.05–10.74 | 图片按内容哈希命名，直传 R2；／信封里只带对象键。 | Images go to R2, named by hash; / the envelope carries only the key. |
| `ch01.nMa` / `nMb` | 11.2–13.0 | 其余来源一晃而过：／各报各的，钥匙不混用。 | The other sources flash by: / each source keeps its own key. |
| `ch01.nMc` / `nMd` | 13.1–14.6 | 用量三处相加，站点合并；／没人报的歌，靠最近播放推。 | Usage is summed on the site; / unreported songs use recents. |
| `ch01.clawd`（气泡） | 15.29–15.88 | 我跟着这一封走。 | I'll ride along with this one. |

英文 `n3` 少了「放行的才进信封」：画面上放行那条线进信封，标注「放行 → 进信封 / cleared → envelope」。

## 02 门禁与分拣（20 小节）

事实：FACTS §2。下表按 `ch02.js` 和 `v2/music/ch02.js` 的现状写，是全片标杆。一张 3840×3240 的纸面图纸，两列三行：A 门墙、B 检查单、C 分拣台、D 跨 Worker 的一跳、E 回 202 之前的三盏灯，左下那格 F 是图签，只在拉远时看得到；镜头在强拍上甩到下一格。这一章讲到「经 Service Binding 交给 StateCore.commitIngest，回执回来」为止：屋里排队、唯一的状态 DO、「要做的事」是第 03 章的。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1.6 | 硬切进来那一帧火花就贴着左缘（屏幕 y ≈ 540，接第 01 章），Clawd 蹲在火花亮核上一起进来（屏幕上 126 px 宽，底边比亮核高 7 px，与 `ch01.js#clawdRide` 对齐），墙线从 0:0 起画；标题「02 门禁与分拣」、`ingest.homepage.lyjw.llc · ingress Worker`、`POST /api/ingest/…`；一墙九扇门画出来（来源按 `shared/ingest/prepare.ts#INGEST_SOURCES`，最后一扇是 `/agents/otlp`）；0:2 Clawd 起跳，1:0.5 落到标题线上说一句（格子从 5 变到 7，抵掉镜头从 1.4 拉到 1，屏幕上大小不变）；火花走向 /mac | 0:0 拨弦唱主题，前奏只有 pad 和零星打字声；0:2 小跳 |
| 1–3.2 | 权限表 ACCESS_CLIENTS 分两列逐行列出（mac … github-actions，按 `workers/ingress/wrangler.toml#ACCESS_CLIENTS`，只写上报方名）：钥匙按上报方发，home-assistant 那行只开 /homepod，/playstation 只有 playstation 那行（n100 容器自己的钥匙），quest 那行只开 /quest；mac 的钥匙从自己那行滑到 /mac，2:0 转开门、2:3 关上。旁白 `n1`（1.6 机位落定才出底字） | 2:0 钥匙 |
| 3–5 | emby 的钥匙去开 /mac，3:2 盖 403，Clawd 当拍一缩；4:0 Home Assistant 的钥匙开 /homepod、4:0.5 playstation 的钥匙开 /playstation，两张卡各贴着自己那扇门往外伸，标「两把钥匙，各开一扇」；4:2 Clawd 跳出右缘 | 3:2 印章，4:0、4:0.5 两把钥匙，4:2 小跳 |
| 5–7.6 | 甩到检查单（角标 `ingress Worker · handleIngest`）：六项在 5:0、5:2、6:0、6:2、7:0、7:2 逐项打勾（方法是 POST · 认识这个来源 · Access 凭证 RS256 / aud / iss / exp · 不超过 4 MiB，按实际读到的字节 · 是 JSON · prepare：校验并整理成命令，产物 `PreparedIngest`），右栏拒收码 405 / 404 / 401·403·503 / 400 / 400 / 400；右边那封信跟着亮出 POST、路径、JWT、称重、花括号，7:2 拆开。旁白 `n2` | 每项一声「叮」，音高 A C D E G A |
| 7.6–8.75 | 反例：一封 `<html>` 飞进来，8:0 盖「400 不是 JSON」 | 8:0 大章，全场一顿 |
| 9–12 | 甩到分拣台：台上两封已拆开（mac、iphone），角标 `prepare → PreparedIngest`；四根管子（凭据 KV CREDENTIALS · 归档 D1 HISTORY · 可滞后 KV LAG · 实时 CORE.commitIngest），管底是四个库的符号，管名和谁来写标在符号下面：前三根「入口直接写」，实时那根「交给状态核心」；漏斗口上方留空，给落进去的胶囊。信封的名字写在信封正面，胶囊从信封底下滑出来，先落到漏斗口上方那条空带再横移。9:0 mac 的 desktop / appleMusic / chargingDevices 三张排成一列，依次落进实时；9:2 timezone 进可滞后，10:0、10:1 iphone 的 workouts 先后进可滞后、归档各一份，10:2 musicUserToken 进凭据；服务器那封从右上角进来，11:0 整封一分为二，两封高高越过实时的漏斗口，落进可滞后和归档，注「服务器那封整封不进状态核心：只进可滞后和归档」。实时那根管子从右下角出去。旁白 `n3` | 9:0、9:2、10:0、10:1、10:2 气动管，11:0 分叉 |
| 12–16 | 甩到跨 Worker 的一跳：中间一堵剖切墙，左边 `ingress Worker`「无状态，只在边界鉴权」，右边 `core Worker`「状态核心」；实时那根管子从墙上的口穿过去，口上先写「内部专线」，再标 `Service Binding · CORE`，入口这一侧标 `await CORE.commitIngest(cmd)`。火花顺着管子 12:2 过墙、12:3 进 StateCore（RPC 入口），13:0 进 StateHub（先写「唯一账房」，再标 Durable Object，画成四个库里「实时」那间屋子），13:1 屋里的灯亮；13:2 回执从 StateCore 顺原路回来，14:0 停在墙边，写出 `{ ready: true, ok: true, data }`。墙那一侧注「内部调用：不走公网，不带凭据」「只有绑定了 CORE 的 Worker 调得到」，脚注「改校验只需重新发布入口：core Worker 只引用类型，Durable Object 不重启，连接不断。」。15.75 起回执往下落，16:0 落到 E 的第一盏灯。旁白 `n4`、`n5` | 12:2 气动管（到站那一下落在 StateCore），等回执时十六分的钟摆，13:0 门锁，13:1 远处一盏灯，13:2 纸滑，14:0「叮」，15:3 吸一口气 |
| 16–19.25 | 甩到三盏灯，注「回 202 之前，入口依次等：」：16:0 回执点亮「状态核心已提交」，16:2「LAG 已写」，17:0「凭据已写」，每盏下面标 `await`；16.25 起 D1 那一路从汇流线上分出去（虚线，「后台再办 · waitUntil · 不等」），17:3 在 202 之后才远远亮起；汇流线亮一盏走一段，17:2 盖「202 Accepted」；17:3 起右边列出失败时：`retryable → 503`「暂时故障：稍后重发」，`throw → 400`「上报器整封重发」。旁白 `n6`、`n7` | 灯音 A5 D6 F6，17:2 大章，17:3 D1 远远唱 E6 |
| 19.25–20 | 拉远看整张图纸（左下格正中是图签「门禁与分拣 · PLATE 02 · INGRESS」），19.74 起冲进「状态核心已提交」那盏灯：整屏化成橙色，19.97 前落满黑（20:0 那一帧归第 03 章，从黑里起） | 19:2 下坠，被吸进第 03 章 0:0 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch02.clawd`（气泡） | 1.15–2.5 | 上报都从这面墙进来。 | Every report comes in / through this wall. |
| `ch02.n1a` / `n1b` | 1.4–3.2 | 每个上报方一把 Access 钥匙，／权限表决定它能开哪几扇门。 | One Access token per reporter; / the table decides which doors open. |
| `ch02.n2a` / `n2b` | 4.9–6.4 | 按判定顺序逐项校验，／一项不过，当场拒收。 | Checks run in order; / any miss is rejected. |
| `ch02.n3a` / `n3b` | 9.05–11.74 | prepare 把信封整理成命令，／按数据层拆成四路。 | prepare turns it into a command, / split four ways by data layer. |
| `ch02.n4a` / `n4b` | 12.05–13.82 | 实时那一半经 Service Binding，／交给 core Worker 里的 StateCore。 | Realtime rides a Service Binding / to StateCore in the core Worker. |
| `ch02.n5a` / `n5b` | 13.87–15.74 | 鉴权已在边界做过一次，／这一跳只认绑定，不再验钥匙。 | Auth already happened at the edge; / this hop trusts the binding alone. |
| `ch02.n6a` / `n6b` | 16.05–17.72 | 三层都写完，才回 202；／归档、推送与失效在后台继续。 | 202 only after three layers commit; / archive and push continue after. |
| `ch02.n7a` / `n7b` | 17.8–20 | 中途出错回 400，整封重发；／每一路按自然键写，重发不重复。 | On error: 400, and a full resend; / keyed writes make resends harmless. |

检查单右边那一栏只有 650 宽，`n2` 中文一行不超过 10 字、英文不超过 23 个字符。

## 03 一间屋子的账房（16 小节）

事实：FACTS §3。已做；下表按 `ch03.js` 和 `v2/music/ch03.js` 的现状写。一张暗底平面图，三个机位（A 屋里、B 门外、C 拉远），空间用平面图交代，含义交给白卡详图。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–2 | 黑里先亮一盏桌灯（接第 02 章冲进去的那盏灯），平面图一笔一笔画出来：左边一路进口（上报入口）排成一条队，栏杆只围出一条（采集 Worker 写实时层不排这条队，这里不画）；进口那条线上注 `Service Binding` `→ StateCore`：入口调的是 StateCore，由它串进 StateHub 这条队；中间一间屋子（墙体剖切斜线、门洞、一张桌、一把椅子、一盏灯、一本摊开的账本），右墙一道缝；标题「03 一间屋子的账房」、`workers/core · StateCore → StateHub`；引线标注 `StateHub · idFromName("global")`「全站只有这一个实例」。旁白 `n1` | 0:0 落地一声低「咚」，FM 铃唱主题 |
| 2–5 | 每拍一封进门落账，右栏「StateHub 账本」详图每拍写一行打勾（mac · desktop、homepod · nowPlaying、emby · watching……；playstation 那几封是 n100 容器 POST 的原始信封，和别的一样从上报入口来）；屋里标 `ingestTail`；主角 mac · appleMusic 带着橙色火花在队里等。旁白 `n2` | 底鼓每拍，十六分钟摆 |
| 5–6 | 5:0 主角落账；托盘上出一张小纸条，右栏「要做的事」（角标 `IngestEffect`）固定三行 event / listening / tags：listening 写「广播 listening-now · 用落账前补好的封面和链接」（上报入口在交给 StateCore 之前请采集 Worker 查好 Apple 目录，随状态落库），tags 空着「换歌不失效；开始或停止放歌才有」，方框不勾。旁白 `n3` | |
| 6–8 | 6:0 纸条从墙缝递出，镜头甩到门外岗亭 StateCore「RPC 入口 · 照单去办」；6:2 盖 waitUntil 章、listening 打勾；同一拍两条虚线出发：去天线 LivePushRoom（另一个单例 DO），橙环荡开，所有开着的页面依次翻面、标 listening-now；回执 `ok · data` 飞回入口，标「回执 → 入口」「入口接着写 LAG 和凭据，都写完才盖 202」，两条路中间「‖ 并行 ‖」。旁白 `n4` | 6:0 纸滑出，6:2 广播 + 印章 |
| 8–10.5 | 甩回屋里：又进两封（playstation、emby），9:0 一封纯心跳（信封上一颗心跟着底鼓跳）：账本记「♥ 存活 + pulse 观测」，「要做的事（空）」注「不推送」「不失效首屏」；Clawd 在桌角冒出来说一句。旁白 `n5` | 心跳段半速，底鼓变成扑通扑通 |
| 10.5–12 | 一封在线 → 离线（mac · presence）落账：「要做的事」写 event「广播 presence」、tags「失效页头、在听、充电头 → site Worker，5 秒超时」；11:0 两项打勾，纸条递出，橙环从右边扫进来。旁白 `n6` | 11:0 翻转一记，11:3 吸一口气 |
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
| `ch03.n6a` / `n6b` | 10.55–11.75 | 只有上线、下线才广播 presence，／并通知 site Worker 让首屏标签过期。 | Presence is pushed only on flips, / and the site Worker expires its tags. |
| `ch03.n7a` / `n7b` | 12.3–16 | 只有实时层放在 DO 里，变了就推送；／其余几层在 KV 和 D1，不推送、按需读取。 | Only the realtime layer lives in a DO and pushes; / the rest sit in KV and D1 and wait to be read. |

`n7` 中英都超过行宽：它排在缩放 0.66 的拉远机位上，世界坐标写 91 px、`maxW` 2600，屏幕上仍是 60 px、不缩字（`v2/tools/check.mjs` 核过）。其余各句中文每行不超过 17 字，英文不超过 36 个字符。

## 04 活字印版（12 小节）

事实：FACTS §4。画面标题「活字印版 / The type case」，副标 `React Router · SSR`；标题旁先写「按标签作废」，再写 `Cache-Tag`。纸面，俯视一整页首屏：每条 `firstScreen` 缓存一块印版（一张卡读几个视图就切成几块，`src/app/page.tsx#READS`），按首屏桌面宽度的真实比例排成一条长版，块上写它的 `page:` 标签名，没挂标签的写端点末段（屏幕上不小于 28 px）；挂标签的块右上角吊一枚小标签。块数、带标签和不带标签的各几块，写章时按代码现数（`src/app/page.tsx` 里 `firstScreen` 的调用、`shared/status-views.ts#STATUS_VIEWS` 的 tag），旁白里不说数；右上那张是 In Brief，读 digest 与 timezone 两个视图，切成两块（FACTS §4）。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 接第 03 章的满屏纸往后拉：一整页印版现出来；标题 | 印刷机的重拍进来 |
| 1–3 | 出纸口递出一张印好的页：访客拿到的是缓存好的 HTML。旁白 `n1` | |
| 3–5 | 镜头顺着长版往下走，每块印版一根细线接到左右两条轨（实时 → DO，可滞后 → KV LAG），轨通到页底的库符号；脚注「`Cache-Tag` · max-age 600 / stale-if-error 604200」 | |
| 5–8 | 接第 03 章那次在线 → 离线：页头、在听、充电头三块的标签失效（注「在线 → 离线：这几块的标签失效」，不写个数），三块被夹起（往上平移、投影变深），在强拍上按 stamp 模式重印、放回；同时出纸口照旧递出旧页，新页在后台印。可滞后轨和「印好的页」之间 5:2 起画出一根印刷手柄（墨色），5:3 Clawd 从画面上方落到手柄旁；6:0、6:2、7:0 三次，它都在跳到最高时握住球头（球头变橙），落地蹲下正好在重印那一拍把手柄拽到底，松手回弹；7:1 跳出上缘，手柄 7.8 起淡出。旁白 `n2` | 每块重印落在一个重拍上；Clawd 落下、三次起跳、跳出各一声小跳 |
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
| 1–3.5 | 一长条 HTML 一格一格解析（光点走过一格才亮一格）；2:0 `<script>` 那一格跑完，接上电报线 `new WebSocket("…/ws?visible=1")`，同一拍戴耳机的报务员 Clawd 落到线头的电键旁（1.75 从画面左边蹦两下进来）；2:1、2:3、3:1 它各按一下电键（前半拍抬手，正拍按下，触点闪一下），三封电报（online、desktop、playing-now）从脉冲尖上掉进托盘（`queue`）。旁白 `n1` | 2:0 接线一声灯；三封各一声电键的「嘟」；踩镲拼 WS、LIVE |
| 3.5–5 | 3:2 一道竖刻线 hydrate，`useLiveEvents` 接过这根线，Clawd 左右看一眼（4.78 镜头甩走后不再画它）；3:3、4:0、4:1 托盘里的按到达顺序一封一封飞到计数格上方，格子依次亮起（1 2 3）。旁白 `n2` | 3:1 吸一口气到 3:2；重放一封一声叮 |
| 5–7 | 线上面的 LivePushRoom 广播下来：5:0 主角 listening-now 到站，写进 SWR 的 `/api/status/listening/now`（receivedAt 换成新的，Mono 注 `mutate(path, data, {revalidate:false})`）；5:2「Now Playing」卡片纵向压扁再弹开：夜に駆ける → アイドル。旁白 `n3` | 5:0 主题（闷音拨弦，长音拆成三下点）；5:2 翻面一记 |
| 7–8.5 | 一只慢回来的旧轮询（receivedAt 更早）顺着虚线爬回来，8:0 撞上时间戳闸门 `guardPolled` 被弹开。旁白 `n4` | 8:0 撞上闸门、弹开一声（金属闸杆一响，弹回去一口风） |
| 8.5–10.5 | 线上没有消息。放大的「Now Playing」旁边两只钟：Mac 的钟停着，浏览器的钟追上，中间写「补上这段」；公式 `positionMs + now − observedAt` 缩成纹理。注「只在播放时往前走」；歌词占位两行横条逐块亮。不标测过的延迟。旁白 `n5` | 9–10 鼓停，只留 pad 和钟；11 起鼓轻轻回来 |
| 10.5–12.5 | 两只正视钟面：线上面源站的钟停在 servedAt（只管首帧），10:3 挂载，虚线箭头穿过电报线交给线下面访客的钟；访客的钟一拍走一格，12:0 走到截止 `lastSeenAt + heartbeatWindowMs`，卡片上的在线点自己熄灭、换成 Offline，源站什么也没说。在线点画成 signal，不用 live 绿。旁白 `n6` | 12:0 在线点熄灭：一声很轻的、往下滑一个八度的玻璃音 |
| 12.5–15 | 同一根线数两种人：这一页的窗口（页脚 Online now 用 live 绿）、线上面的房间和一张「数人头」白卡（角标 `/count`；connections：开着的，含后台；online：正在看的）；13:2 切到另一个标签页，只发一声 `hidden`（往上的脉冲），线不断；14:0 online 03 → 02（live 绿），connections 不变。旁白 `n7` | 13:2 电键一声（往外发，比进来的高、短）；14:0 叮；踩镲敲 ON |
| 15–17.3 | 白卡「预期到货表」（角标 `nextLagDelay`）：可滞后卡在 `due = updatedAt + cadenceMs + LAG_GRACE_MS` 才去取（服务器、GitHub 贡献图、活动圆环三行，节奏按 `shared/status-views.ts#STATUS_VIEWS`），过了 due 从 15 秒起退避；右栏：推送连着时，在听列表、在看、在玩、奖杯的轮询取 `max(cardMs, PUSH_SAFETY_NET_MS)`，16:2 盖「≥ 5 min」章。旁白 `n8` | 15:1、15:2、15:3、16:0 一行一声叮；16:2 印章；踩镲敲 ETA |
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

## 06 心电图与地层（14 小节）

事实：FACTS §3「core 的 cron」「Pulse 事实时间线」、§8。画面标题「心电图与地层 / Heartbeat and strata」。暗底 + 白卡；站点自检不出 Cloudflare 账号 ID、真实报错标题、可用率数字；不画令牌，采集 Worker 去 D1 那一趟只标 `SELECT`（向 Cloudflare 取数那把令牌的权限范围未核，不说「只读」，见 FACTS §8）。live 绿在这一章第二次、也是最后一次出现，只给 LYJWPAGE 卡上今天那一格。一拍 = 一分钟。一张暗底图纸：地面是一条心电图横线，线上是记账的那张表（D1 `health_buckets`），线下是站点（lyjw.me、workers/core），再往下是地层（D1）。心电图是往左卷的监护仪，笔尖固定，右边是还没发生的；尖峰朝信号走的方向：敲门从上往下进来（尖朝下，落在每拍的后半拍），报到从下往上出去（尖朝上，落在整 5 拍上）。拍位和 `v2/music/ch06.js` 是同一张表（`v2/ch06.js` 的 `CHECKS` / `KNOCKS` / `AT`）。

交接：0:0 接第 05 章最后一帧（屏幕 y 540 一条整宽直线），不落黑：首帧镜头缩放 1.5，那条线就是心电图的基线，只画到笔尖为止；0:0 的报到尖峰在屏幕 x 1100 处立起来，笔尖停在尖上发亮；0–0.95 往后拉出整条心电图。12:0 镜头已经从地层升回地面，停在 `[960, 540]`、缩放 1，并停到 14:0：画面上只剩心电图横线（屏幕 y 540，笔尖在屏幕 x 1350），标签、方框、地层都已收掉；第 07 章从这一帧硬切纸面，横线收成对话卡的输入框。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 拉平的那条线上立起第一根报到尖峰，镜头往后拉开，心电图横线出来；标题 | 底鼓就是心跳（lub-dub）；0:0 报到一声往上挑的低音 |
| 1–4 | 同一条线上两种方向相反的信号：采集 Worker 每分钟来敲门（GET `/api/version`，尖朝下，进 lyjw.me，注「采集 Worker · 每分钟一次」「只说明 site Worker 还在出页面」）；线下 workers/core 的 cron 每 5 分钟一轮，每轮跑完去报到（尖朝上，到 `health_buckets`）；`health_buckets` 的框里 lyjw.me、Core 两行记录一格一格往里加；2.5 起冷面脚注「* 报到只证明 cron 跑完了。」。旁白 `n1` | 敲门是后半拍一声指节叩木门，报到是整 5 拍一声往上挑的低音（1:1、2:2、3:3） |
| 4–6 | 往右：采集 Worker 的小钟走到整 5 分钟，5:0 去 `health_buckets` 读两行（标 `SELECT`），5:1 汇总带回来，经可滞后层（KV LAG）上 LYJWPAGE 白卡：lyjw.me、Core 两行各 30 天一格，5:2 今天那一格亮（live 绿）；卡上只写 Operational 和 30 days ago / Today，不出可用率。旁白 `n2` | 5:0 取数一声；5:2 高音灯 |
| 6–8 | 镜头纵向下沉进地层：一层一层是 Pulse 卡上那几条道（道名一栏贴着画面左边，顺序照 Pulse 卡），墨色深浅交替，里面是原始事实的示意（区间、瓦数、桶）；右沿是此刻，workers/core 的 cron 每 5 拍（和报到同一轮）掉下一片压进右沿（注「每 5 分钟压进一薄片」）；右边 D1 档案架「lyjwpage-history · 长期保存」，底下「← 越往左越早，一直留着」；7:0 Listening 那一层里正在放的这首歌亮一下。旁白 `n3` | 低通收窄，敲门隔着地层变闷，压进一片时一声翻纸（和报到同一拍：6:1、7:2、8:3）；7:0 低音马林巴唱信封主题 |
| 8–10 | 推近 Coding 那一层（其余几层的数据和道名淡掉）：一窗一格，格里两道细刻线分出三个 5 分钟桶（注「一窗 = 三个 5 分钟桶」），下面 Tokens 那层是三个来源的桶叠在一起（注「Mac · 云端 · Cursor」）；8:1 全零的窗先落到最低档，标「不问 Clef，直接最低档」；8:2 起 Clef（「打分（示意）」）一窗一窗往右打，每半拍一窗（先后和快慢都是示意），打出来的档是窗里的一根横线（高低是示意）；贴着此刻那一窗还没满，不打；Clef 那一格上方注「打分只在屋里放 7 天，不进 D1」（打分记在 StateHub，不归档）。旁白 `n4` | 8:1 一声闷拨弦；8:2 起每打一窗一声小铃 |
| 10–12 | Clawd 从地层上沿冒出来说收尾那句（气泡）；11:0 起镜头升回地面，标签、方框、地层一起收掉，12:0 停在只剩心电图的一帧 | 10:1 冒出来一声；11 升回地面，心跳回到每拍 |
| 12–14 | 网格淡掉。12.15「信送到了。」13.15「那这座邮局是谁建的？」镜头停在同一帧，14:0 硬切第 07 章 | 12–13 鼓停，只留 pad；13:2 吸一口气，收在 A7sus4 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch06.n1a` / `n1b` | 1–4 | 探测每分钟从采集 Worker 打进来，／cron 每轮跑完，自己记一笔心跳。 | The collector probes in every minute; / the Worker's cron logs its own beat. |
| `ch06.foot` | 2.5–4 | 报到只证明 cron 跑完了。 | A check-in only proves the cron ran. |
| `ch06.n2a` / `n2b` | 4–6 | 汇总这两行的是采集 Worker，／页面只读可滞后层，不碰 D1。 | The collector sums up both rows; / pages only read the lag layer. |
| `ch06.n3a` / `n3b` | 6–8 | cron 每 5 分钟按水位写进 D1，／各路独立，一路坏了不挡别路。 | Rows past the watermark go to D1; / a failed stream blocks no other. |
| `ch06.n4a` / `n4b` | 8–10 | 窗关上两分钟后才交给 Clef，／输入是前台应用、agent 与 token。 | Two minutes after a window closes, / Clef weighs apps, agents and tokens. |
| `ch06.clawd`（气泡） | 10.35–11.45 | 线上出错时，／我先去 Workers Issues 查证据。 | When something breaks, / I check Workers Issues first. |
| `ch06.actA` / `actB` | 12.15–13.2 / 13.15–14 | 信送到了。／那这座邮局是谁建的？ | The letter has arrived. / Who built this post office? |

## 07 对话（16 小节）

事实：FACTS §9。下表按 `v2/ch07.js` 和 `v2/music/ch07.js` 的现状写。画面标题「对话 / Chat」，副标 `Talk to God · ai Worker · Clef · Claude`。纸面（接第 06 章的暗底）。一张图纸从左往右是一条消息走过的路：首页对话卡 → 过闸（验人、ChatQuota）→ Clef 分拣台 → 工具（`SITE_TOOLS`、`PUBLIC_STATUS`、`/mcp`）；回到卡片之后往下是设计会话的只读沙盒，再往下是构建分支和 main 线。画面和配乐共用 `v2/ch07.js` 顶部的时间表 `AT`。访客的两句话、Clef 挑中的档、额度格子的满空、计划内容都是示意；档位名和人设照代码（FACTS §9），额度不出数。

交接：0:0 接第 06 章最后一帧（心电图横线，笔尖在屏幕 (1350, 540)），硬切纸面：同一高度一条整宽墨线，笔尖处一个橙点；0.05 起墨线收成对话卡输入框的下沿，橙点成了光标。15.92 落到 `FIN`：只剩 main 线、提交圆点和 HEAD，和第 08 章首帧相同（见 CONVENTIONS「交接」07 → 08）。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 墨线收成输入框，镜头拉出整张对话卡（右边），左上标题；0.6 起打出「你最近在听什么？」 | 只有 pad 和打字机 |
| 1–2.5 | 1:0 发出，气泡上去；卡片先回隐私说明（去向一行一行亮：Cloudflare Workers、Turnstile、Workers AI 的 Clef、Anthropic、GitHub、这个浏览器）；2:0 点接受，说明收起，输入框里 Verifying you are human…。旁白 `n1` | 1:0 纸滑；2:0 一声叮；2:2 气动管（消息出门） |
| 2.5–5.4 | 火花出卡片往右：3:1 验人（通行证 · Turnstile）打勾；进 ChatQuota，三道（访客自己的总量、全站路由次数、至少一档还有空位）3:3、4:0、4:1 各勾一项；4:2 一旁盖 429（Too many prayers），脚注「挡下：回 429，不调 Clef」，Clawd 跳到章旁边说「弹回来了。」；4.75 之前离开，4:3 放行。旁白 `n2` | 一项一声叮；4:2 印章；4:3 气动管；0:0 马林巴，和后面的打字声分开 |
| 5.4–7.9 | Clef 分拣台：三档 Fable · God、Sonnet · Prophet、Haiku · Small Fry，各一排名额格；6:0 挑中 Sonnet，6:1 它的格子已满、标「满了」，6:2 往下降一档，旁注「额度满了，换更省的」，6:3 Haiku 亮灯、占一格；7:0 前后注 refuse。旁白 `n3` | 6:0 叮；6:1 熄灯往下滑；6:2 下坠；6:3 灯 |
| 7.9–9.7 | 工具：8:1 Haiku 调 `get_site_status`，经 `PUBLIC_STATUS` 下到 core · PublicStatus，8:2 `listening/now` 回来，注「和浏览器看到的同一份」；9:0 右上外部 AI 客户端经 `POST /mcp` 接进同一张 `SITE_TOOLS`。旁白 `n4` | 8:1 气动管；8:2 灯；9:0 叮、9:1 灯；9:2 甩镜头 |
| 9.7–11.3 | 回到卡片：10:0 回复（HAIKU · SMALL FRY）连着一张在听卡；10:1 盖 SEAL，引线注「盖章：下一轮只认盖过章的历史」；10:3 第二句「给在听卡加个歌词按钮」，旧消息滚上去；11:0 分隔线 DESIGN SESSION · ARCHITECT TAKES OVER | 10:0 翻面；10:1 印章；10:3 纸滑；11:0 落地一声，暖铃唱信封主题 |
| 11.3–13.5 | 往下到只读沙盒（Claude Managed Agents）：Opus · Architect，卡的右半边一只戴安全帽的 Clawd 11.26 起从卡底冒出来（裁在卡里，不压卡上的字）；11:2 从 LYJW131/lyjwpage 匿名克隆，Clawd 左右看；read、glob、grep 打勾，write、edit 打叉；网络只放行 github.com；12:0 ask_visitor 出题，12:1 访客选第一项；12:2 propose_build 出计划卡（标题、规格与验收、预计路径，Open issue / Start build），Clawd 跳一下；13:0 先展开 GitHub 授权说明并接受，13:1 点 Start build，13.4 起 Clawd 随沙盒一起淡出。旁白 `n5` | 11:2 分叉声；12:0、12:1 叮；12:2 翻面；13:0 钥匙；13:1 灯 |
| 13.5–15.3 | 往下到 main 线：从 HEAD 弯出构建分支 `claude/build-<runId>`；13:3 计划提交 `builds/<runId>.md`；14:0 草稿 PR；Actions · Claude Code（不持有写凭据）14:1 上传，注「上传改动，Worker 校验后提交」，14:2 实现提交；14:3「审查只作参考」；15:0「合不合并：lyjw 决定」。旁白 `n6` | 13:3 叮；14:0 灯；14:1 气动管；14:2、14:3 叮 |
| 15.3–16 | 分支、PR 和标注退掉，网格淡掉，镜头落到 `FIN`：只剩 main 线、提交圆点和 HEAD | 15:1 甩镜头；15:3 吸一口气，收在 A7sus4，交给第 08 章 0:0 的 boom |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch07.n1a` / `n1b` | 1.1–2.45 | 发第一句之前，先说清数据去哪；／点了接受，才去验人、发请求。 | First, a notice of where data goes; / nothing is sent until you accept. |
| `ch07.n2a` / `n2b` | 3.1–5.3 | 花钱之前先过闸：验人，再数额度；／被挡下就回 429，不再调 Clef。 | Before any spend: a human check, / then quotas; blocked means a 429. |
| `ch07.n3a` / `n3b` | 5.55–7.7 | Clef 看问题挑一档模型；／满了就降档，省着额度。 | Clef picks a model tier; / Full means step down: cheaper. |
| `ch07.bounce`（气泡） | 4.5–4.71 | 弹回来了。 | Bounced. |
| `ch07.n4a` / `n4b` | 8.0–9.7 | 工具只读公开模型，和浏览器同一份；／同一套工具也挂在 /mcp 上。 | Tools read the same public model; / the same tools are served on /mcp. |
| `ch07.n5a` / `n5b` | 11.35–13.45 | 想改站，Sonnet 开一个设计会话；／Opus 只读仓库，出题、出计划。 | Site ideas open a design session; / Opus reads the repo, asks, plans. |
| `ch07.n6a` / `n6b` | 13.6–15.4 | 构建在新分支上开 draft PR，／合不合并，由 lyjw 决定。 | A build opens a draft PR; / merging is lyjw's call. |

## 08 一句话之后（20 小节）

事实：FACTS §11（例子是 PR #308，PR 上的记录按 GitHub 读回）。下表按 `v2/ch08.js` 和 `v2/music/ch08.js` 的现状写。画面标题「一句话之后 / After one line」，副标 `Claude Projects · GitHub · Codex · Devin · Haiku`。暗底，一张横向长图纸：main 线贯穿下方，三根分支（文档、界面、#308）从 HEAD 弯出去，往右依次经过线程、PR、验证、合并闸门，在最右边弯回 main；项目聊天的看板和夜班时间轴在上方。这一章的主角是 Clawd：一只 Clawd 就是一个 Claude，戴耳机的是协调的 Claude，拿放大镜的是 Haiku 验证员，小台上那只是判定员。提交短哈希、PR 标题、合并卡里的提交主题与首页提交卡照 GitHub 原文，英文模式下也不翻；文档、界面两个线程只是陪衬，内容示意。画面和配乐共用 `v2/ch08.js` 顶部的时间表 `AT`。

交接：0:0 接第 07 章最后一帧，硬切暗底、几何不变：屏幕 y 540 一条 main 线，HEAD 在屏幕 x 1350，往前隔 100 一颗提交、再往前每隔 200 一颗。20:0 镜头停在 `FIN`，新的 HEAD 落在屏幕 x 1350，画面上只剩 main 线和提交圆点，几何和首帧相同；第 09 章从这一帧硬切纸面。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1.3 | 0:0.5 起从最早那颗往 HEAD 这边，每颗旧提交上冒出一只小 Clawd，0.45 起线下注 `Co-Authored-By: Claude`；0.25–0.5 向导 Clawd 从右边跳上 HEAD，0.5 起气泡（接第 00 章「我们几个 Claude 动手」）；0.3 起标题；1:0 向导往上一跃出画，镜头跟着升到看板 | 0:0 一声低「咚」；0:0.5 起七颗提交各一声小跳，往上爬；0:1 向导落上 HEAD 一声；1:0 跳起来、一口风 |
| 1.3–2.95 | 项目聊天的看板：一面插孔板，界面、文档两个线程早已插着，各一根线垂到自己的分支；左边白卡「项目记忆」逐行写出三条（第三人称写 lyjw · 等待都有上限 · 改界面等 lyjw 点头）；1.3–1.5 戴耳机的协调 Claude 从上面落到看板下的横线上；1.5–1.75 一张纸条从左边滑进来「PageSpeed 两行老显示「—」」，上面署 lyjw；1.8 协调 Claude 看一眼，2:0 起跳把一根线插进空插孔，2:1 插好、插孔亮，标 #308，线一路垂到 main 下面。旁白 `n1` | 1:2 落地一声，1:3 纸滑；2:0 一口风，2:1 灯，2:3 叮（线到底） |
| 2.95–4.85 | 落到线程那一段：3:0 #308 那根从 HEAD 弯出分支 `claude/project-thread-…`（界面、文档两根早已分出去，各有一只小 Clawd），3:1 分支尖上冒出线程 Clawd，3:2 跳到第一个提交 `f03f371`；3:3 左边一张白卡「本地门禁」（docs:check · typecheck · test · eslint · build），4:0–4:3 前四项一拍勾一项，build 这次不跑、灰着；4.8 注「按改动挑着跑」。旁白 `n2` | 3:0 分叉声；3:1 小跳，3:2 按键，3:3 纸滑；4:0–4:3 四声叮；4:3.6 小跳 |
| 4.85–7.35 | 甩到 PR：线程 Clawd 跳到分支前头，5:0 弹出 PR 卡（PR #308 · `fix(collector):` PageSpeed 两端各算各的，放宽超时 · `claude/project-thread-… → main`），5:0.5 CI · check 打勾；5:1 起评审机器人的意见一张张从右边滑进来（Codex、Devin、Codex、Devin、Codex），每张晚半拍盖结论：改了的打勾「改了」，第二张 Devin 写「回理由」；6:2 最后一张 Claude review「No issues found」；6.25 起注「Codex 最多三轮」；6:3、7:0 线程 Clawd 再落两个提交 `065aa93`、`f6ef255`。旁白 `n3` | 5:0 纸滑；5:0.5 CI 一声叮；改了的各一声叮（5:1.5、5:2.5、5:3.5、6:1.5），回理由那条往下一滑（6:0.5）；6:2 灯；6:2.5、6:3.5 小跳，6:3、7:0 按键 |
| 7.35–10.65 | 甩到验证：7:2 拿放大镜的 Haiku Clawd 从上面落到 `f6ef255` 旁；左边测试卡 `f6ef255`（collector test · typecheck · eslint · docs:check），8:0–8:3 一拍勾一项；9:0 中间弹出「验证回执」：完整 SHA（注「SHA 只粘贴，不手抄」）、9:1 等级 `unit-test-verified`、证据、「验证员：Haiku，没写这段代码」；右边一列等级（算通过：live-ui-verified · unit-test-verified · type-check-only；不算通过：verifier-blocked · verifier-failed），9:2 `unit-test-verified` 那一级亮；9:3 起敲出 `$ verify-receipt.ts check --pr 308`，敲完下一行行首挂一盏灯，10:1 回 `"coverage": "exact", "pass": true`、灯亮；10:2 Haiku 贴着清单卡底边往左飞，出了卡再往上飞走；10.55 起这一幕淡掉，赶在 #308 那只 Clawd 跳过终端那两行之前。旁白 `n4` | 7:1 甩镜头的风，7:2 下坠；8:0–8:3 四声叮；9:0 纸滑，9:1 印章，9:2 灯；10:1 灯；10:2 两下小跳，一口风 |
| 10.65–13.75 | 甩到合并闸门：10.8、10.9、11.0 三张小牌（文档、#308、界面）依次在自己那道闸前弹出，闸名和闸灯并排，写各自那一档：文档「CI 绿就合」、#308「处理完评审 + 判定员」、界面「lyjw 看图点头」；11:0 判定员 Clawd 落到闸上方的小台上（注「没写这段代码」）；11:1 文档那道闸开，闸杆收完小牌才过去；11:3 判定员在 #308 小牌正上方盖骨白 FAIL（副标「退回」，和在途的橙色分开），#308 停住，线程 Clawd 回头看；12:0 补一个提交 `e3886f1`，12:2 盖 PASS（线程 Clawd 庆祝），12:3 #308 的闸开；13:1 界面那道盖「OK · lyjw 点头」，13:2 闸开。旁白 `n5` | 11:0 小跳，11:1 开闸；11:3 印章、往下一滑；12:0 按键，12:2 印章和一声叮，12:3 开闸；13:1 大章，13:2 开闸；13:3 甩镜头的风 |
| 13.75–15.85 | 跟到合并处：14:0、14:1、14:2 文档、界面、#308 三根分支依次弯回 main，HEAD 每次往前跳一格、亮一下，线程 Clawd 跟着落回 main；14:3 弹出合并提交卡 `cf92f7c`：标题「fix(collector): PageSpeed 两端各算各的，放宽超时 (#308)」，下面四行是 PR 里各提交的主题，15:1 `Co-Authored-By: Claude …` 那一行亮；15:2 下面弹出 lyjw.me 首页的 Commits 卡（「LYJW131 committed」，下一行「with claude」），一根橙线从合并卡连过来，15:3 头像那一格跳出一只小 Clawd。旁白 `n6` | 14:0、14:1 叮，14:2 落地一声和小跳，14:3 纸滑；14 小节拇指琴第一次唱信封主题，低八度拨弦垫着，15 小节往下答一句；15:1 灯，15:2 纸滑，15:3 小跳 |
| 15.85–18.4 | 升到夜班：一条 00:00–09:00 的时间轴（「夜班 UTC+8」），16.05 起一根橙色游标从 00:00 往右走，每走到一个定时任务冒出一只 Clawd 跳一下，标时刻和名字：01:53 盯防采集、03:15 记忆镜像、04:00 代码审查（拿放大镜，游标在这里停一下，旁注「四点还在看 diff」）、04:53 提炼 skill、08:41 读 Anthropic 动态、09:00 晨报（戴耳机）。旁白 `n7` | 16:0 甩镜头的风；每冒一只一声小跳；拇指琴零星的琶音 |
| 18.4–20 | 落回 main 线：线程 Clawd 站在新的 HEAD 上，18:2 举起牌子「等 lyjw 验收」；网格淡掉；19:1 它跳出右边画面，最后一帧只剩 main 线和提交圆点 | 18:2 纸滑；19:1 小跳；19:3 吸一口气，交给第 09 章 0:0 的 boom |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch08.hi`（气泡） | 0.5–1.0 | 说好的，看看我们怎么动手。 | As promised: / here's how we build it. |
| `ch08.n1a` / `n1b` | 1.45–2.95 | lyjw 在项目聊天说一句，／协调的 Claude 开一个线程去做。 | lyjw asks in the project chat; / a coordinator opens a thread. |
| `ch08.n2a` / `n2b` | 3.1–4.95 | 一件事一个线程，从头跟到尾：／开分支、改代码、先过本地门禁。 | One thread per task, start to end: / branch, change, pass local gates. |
| `ch08.n3a` / `n3b` | 5.15–7.35 | 机器评审不一定对：／每一条，要么改，要么回理由。 | Bot reviews can be wrong; / each gets a fix or a reason. |
| `ch08.n4a` / `n4b` | 7.6–10.65 | 检查交给便宜的 Haiku 跑，／它签一张按提交记的回执。 | The cheap Haiku runs the checks / and signs a receipt per commit. |
| `ch08.n5a` / `n5b` | 11.05–13.8 | 合并按改动大小分三档；／改了界面的，要等 lyjw 看图点头。 | Merges come in three tiers; / UI changes wait for lyjw's nod. |
| `ch08.n6a` / `n6b` | 14.1–15.9 | 合并提交汇总协作者，／首页的提交卡靠它认出 agent。 | Merge commits list co-authors; / the homepage reads them back. |
| `ch08.n7a` / `n7b` | 16.15–17.95 | 夜里也有 Claude 值班：／审代码、提炼做法、写晨报。 | Claudes work the night shift: / review code, distill skills, report. |
| `ch08.sign`（牌子） | 18.5–19.6 | 等 lyjw 验收 | Waiting on lyjw |

## 09 发布（10 小节）

事实：FACTS §10，例子是 §11 里 PR #308 的真实合并。下表按 `v2/ch09.js` 和 `v2/music/ch09.js` 的现状写。画面标题「发布 / Release」，副标 `main → GitHub Actions · Workers Builds`。纸面（硬切，接第 08 章的暗底）。一张流水线总图，一根主轴贯穿全章，就是屏幕 y 540 那条线：第 08 章收尾的 main 线 → site Worker 那条流水线 → lyjw.me 线。其余流水线从这次的合并提交（HEAD）散开，按平台分组：GitHub Actions 在主轴上方，Workers Builds 在下方，各条在散开那一镜里自己跑完；落地时回到主轴，画源站、ESA 与两个域名，只画线和站，不讲缓存。画面和配乐共用 `v2/ch09.js` 顶部的时间表 `AT`。讲的是 main 从 `a451a72` 到 `cf92f7c` 那次合并：改到的路径、跑没跑、亮灯的先后都照 cf92f7c 上的检查（FACTS §10）；只有 site 那盏灯放在落地那一拍，先后不对应真实。

交接：0:0 接第 08 章最后一帧，硬切纸面、几何不变：屏幕 y 540 一条墨线，提交圆点在屏幕 x 50、250…1250，HEAD（`cf92f7c`）在 x 1350（`ch09.js` 的 `Y0`、`HEAD`、`COMMITS`，`ch08.js` 照抄）；首帧只有线和圆点。9.92 到位，镜头停在 `[MX + 1400, 540]`、缩放 1，画面上只剩主轴那一段收成的一根 3 px 墨线，横穿屏幕 y 540；第 10 章从这一帧硬切暗底，同一高度的这条线成了它长图版的脊线（见第 10 章）。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1.45 | 接住第 08 章的 main 线与提交圆点；0.25 起逐字敲出 `PR #308 → main`；左下一张「这次改到的路径」（`shared/site-deployments-types.ts`、`workers/collector/…`、`workers/core/README.md`）；1:0 HEAD 跳一下、亮一圈，下一行 `a451a72..cf92f7c  main -> main`，HEAD 下面标 `cf92f7c` | 0:0 一声低「咚」落地，空五度的铃垫着；一个字一声打字机；1:0 HEAD 一声小跳 |
| 1.45–4 | 拉远，标题和改动卡退掉；1.5 起九条流水线从 HEAD 散开（GitHub Actions：Hub 发布、上报器镜像、CodeQL、CI；主轴：site Worker；Workers Builds：core、ingress、collector、ai），右边括线分组；2:0 起每条闸门一个十六分：放行的打勾，线上写放行的理由（`shared/…`、`workers/collector/…`，或「每次推到 main」），Hub 发布、上报器镜像、ai 划一道、写「没改到」，闸门后变虚线、灯是空的；放行的几条有火花往前走，3:0 起五盏灯从下往上亮（collector、ingress、core、CI、CodeQL），就是 cf92f7c 上这几项检查完成的先后；site 的火花越走越快，3:3 甩镜头，领着镜头落到源站。旁白 `n1` | 1:2 分叉声；2:0 起闸门一条一声：放行的「叮」往上爬（A5 B5 D6 E6 F6 A6），没改到的三条各一声闷拨弦；律动进来；3:0–3:2 五声灯；3:3 一口风 |
| 4–6 | 落地：4:0 site Worker 那条的火花过 pnpm build、到源站，Production 亮；4:1 一根虚线 `check_run`（`Workers Builds: site` 成功）叫起 GitHub Actions 的单子；4:2 ESA 手上的首页划掉、盖 purge，4:3 新的一份从源站沿 lyjw131.com 线预热回来，第一项打勾；5:0、5:1 两个终点站先后打勾（两个域名的 `/api/version` 答出 `cf92f7c`），5:2 第二项打勾；第三项「通知上报入口（ingress Worker）」，注「失败重试，最长 10 分钟」。4.69 一只拿放大镜的小 Clawd 从右边跳进来，停在 lyjw.me 站左边看，5:0 跳到 lyjw131.com 线上，5:1 原地跳一下，5.56 从右边跳出画。旁白 `n5` | 4:0 落地一声 + 灯；4:1 叮，4:2 印章，4:3 气动管；5:0、5:1、5:2 三声叮；Clawd 四跳各一声小跳（4:2.75、5:0、5:1、5:2.25） |
| 6–9 | 6:0 第三项打勾，火花顺着线往右出画；镜头跟过去：6:2 上报入口放行（权限 `internal:site-deployed`），经 Service Binding 到 StateCore 的 `broadcastVersion()`，7:0 推送房间 LivePushRoom 广播 `version`（不带数据），橙环荡开扫过两个窗口；7:2 两个窗口各自问 `GET /api/version → cf92f7c`；8:0 前台 lyjw.me 纵向弹出 UPDATE 卡（`7d35661 → cf92f7c`）；8:2 后台 lyjw131.com 的标签页自己刷新，从上往下换成新的一版；脚注「收不到通知也没关系：每 30 分钟、切回前台时各问一次」。旁白 `n6` | 6:0 钥匙，6:2 叮，6:3 吸一口气；7:0 广播，第二支铃唱信封主题（高八度），拨弦低八度跟着；8:0 翻面一记；8:2 纸滑 |
| 9–10 | 9:0 拉远看整张图纸（PLATE 09 · RELEASE，灯都亮着，开场的标题、改动卡回来）；9.5 起落回主轴，别的一起退掉，主轴收成一根细墨线；最后一帧只剩屏幕 y 540 那条线 | 9:0 呼啸，9:3 吸一口气；收在 Ebmaj7s11 → A9sus4，交给第 10 章 0:0 的 Dm9 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch09.n1a` / `n1b` | 1.95–3.65 | 合进 main，几条流水线同时触发；／设了监视路径的，没改到就不跑。 | A merge to main fans out at once; / watch paths decide who sits out. |
| `ch09.n5a` / `n5b` | 4.1–6.25 | 部署成功才刷新 ESA 首页；／先等两个域名换好，再通知页面。 | ESA is purged only after the deploy; / pages hear after both are polled. |
| `ch09.n6a` / `n6b` | 6.6–8.95 | 页面收到 version，自己去问版本：／前台弹出提示，后台的旧页自己刷新。 | Pages hear “version” and re-check: / visible: a prompt; hidden: a reload. |

## 10 一首歌的旅程（14 小节）

事实：FACTS 全篇。下表按 `v2/ch10.js` 和 `v2/music/ch10.js` 的现状写。画面标题「一首歌的旅程 / One song's journey」，副标 `mac · appleMusic → Now Playing`，右下 `PLATE 10 · RECAP`。暗底，一张横向长图版：第 01–09 章各缩成一格、一格一个机位那么高，按章号从左往右排，暗底的格画在墨色图版上，纸面的格是一张张纸，远看是全片的明暗节奏；06 格（心电图）在原点，首帧只拍到它。01–05 格是信封走过的路，信封经过哪一格，镜头就推近那一格、用那一章的画法闪回；06–09 格是缩样，只在全景里看得到。各章的画法抄成本章的局部函数；第 00 章的主页和终端直接调第 00 章登记对象上的 `share`。延迟不标数（没重测过）。旁白排在各机位的左下。Clawd 一路追着信封跑：骑信封过门、过秤，站上实时那根管子，翻墙坐进账房，骑着推送出门，跳上缓存卡，最后在页面边上欢呼。画面和配乐共用 `v2/ch10.js` 顶部的时间表 `AT`。

交接：0:0 接第 09 章最后一帧，硬切暗底、几何不变：屏幕 y 540 一条整宽的骨白线，就是 06 格拉平的心电图加上笔尖往右接到格子右沿那一段（笔尖在屏幕 x 1350，`ch10.js` 的 `NOW_X`、`Y0` 跟着 `ch06.js`）。15.6 起停在第 00 章第一帧：同一个函数、同一份状态，只差后期颗粒，首尾相接可以循环。配乐尾音的两秒里，这一帧的光标按半秒闪。

| 小节 | 画面 | 配乐 |
|---|---|---|
| 0–1 | 0.05 起心电图的尖峰长出来，0.12 起各格淡入，每格正中一个很淡的大号格号；0.2 起镜头以笔尖为锚往后拉出整条长图版，0.3 起标题；0.8 起冲进 01 格 | 0:0 落回 Dm9，一声低「咚」，主题全体唱一遍（铃、第二支铃唱三度、拨弦低八度）；0:1 一口风，0:3 吸一口气 |
| 1–2 | 01 格（暗底专利图）：一台笔记本，菜单栏右上是 Mac Telemetry Hub 的图标，窗口里在放 夜に駆ける；1:1 换歌，曲名翻成 アイドル（YOASOBI），Hub 图标亮一下；1.31 Clawd 从上面落到线上，1:2 信封从 Hub 图标出来、停到右边的线上，1.69 Clawd 跳上信封，1:3 信封出发。旁白 `n1a` | 1:1 读数灯（玻璃 A5）；1:1.5、1:2.75 两声小跳；1:2 纸滑，1:3 一口风 |
| 2–4 | 02 格（纸面）：2:0 mac 的钥匙卡飞到锁下方，/mac 那扇门打开，信封驮着 Clawd 进门；2:2 落上秤（4 MiB，「不超过 4 MiB」），指针一抖，Clawd 在信封上跳两下；3:0 信封走一道弧升到漏斗上方，3:2 拆开，`mac · appleMusic` 那一格落进「实时」；3.44 Clawd 跳上实时那根管子，火花顺着管子出格。管名写在储存图标下面，漏斗口上方留给信封飞过。旁白 `n1b` | 2:0 钥匙；2:2 一声叮，跟着两声小跳；3:1.75 小跳，3:2 气动管；打字机当踩镲，印章闷拍 |
| 4–6 | 03 格（暗底平面图）：火花进了账房门外那条队，信封一拍一封进屋（4:0 mac · desktop、4:1 homepod · nowPlaying、4:2 mac · appleMusic），右上「StateHub 账本」逐行落账、打勾；3.81 Clawd 翻上账房的墙，4.19 跳进桌后的椅子，4:2 落账那一拍跳两下；5:0 账本换成「要做的事」（IngestEffect：listening · 广播 listening-now），Clawd 看一眼；5:2 纸条从托盘递出门外，Clawd 跳到 StateCore 那间小亭子上。旁白 `n2a` | 十六分的钟摆就是那条队，暖铃唱主题；3:3.25、4:0.75 小跳，4:2 两下小跳；5:2 纸滑和一声小跳 |
| 6–7.4 | 6:0「要做的事」打勾、盖 waitUntil，回执和推送同一拍出发，Clawd 跳上推送的亮核；6.2 起镜头拉远到 02–05 格：回执「ok · data」顺着虚线往左回到 02 格，6:2、6:3、7:0 三盏灯依次亮（状态核心已提交 · LAG 已写 · 凭据已写），7:1 盖「202 Accepted」；推送从 LivePushRoom 出来往右，7:0 经过 04 格时「在听」那块印版亮一下，一根红线连到大字「换歌不重印：交给推送」。旁白 `n2b` | 6:0 广播 + 印章，一声小跳；三盏灯 A5 D6 F6；7:1 大章 |
| 7.4–9.75 | 7.4 起冲进 05 格（暗底示波器）：7.69 Clawd 从推送上跳到缓存卡上沿；8:0 脉冲到站，示波线立起一个尖峰，标 listening-now；纸条落进「SWR 浏览器缓存」，8:2 listening/now 那行的 receivedAt 从 10:31:40 换成 10:35:17（`mutate(path, data, {revalidate: false})`），Clawd 跳两下；8:3 起火花奔向迷你页面里「正在听」那一行，8.81 Clawd 跳到页面上方的线上，9.63 跳起来欢呼；9.45 起镜头推进那一行。旁白 `n3a` | 7:2.75 小跳；8:0 电键，闷音拨弦唱主题，8:2 叮和小跳；8:3.25、9:2.75 小跳；9:3 吸一口气 |
| 9.75–10.5 | 9.75 切到第 00 章那张主页，10:0 火花落卡、「正在听」卡片翻面，和第 00 章第 4 小节同一个画面（同一个函数画）；底下旁白 `n3b` | 10:0 翻面，拨弦唱回第 00 章第一次出场的样子 |
| 10.5–12 | 切到第 00 章总览图停住的那一帧（同一个 `paperFrame`，不带页眉和客串的 Clawd）。旁白 `mapA`、`mapB` | 鼓停，只留 pad |
| 12–14.05 | 12:0 切回第 00 章的终端：欢迎框里 Clawd 按官方 celebrate 庆祝，12.15 起下面是片尾字卡；12.55 起四只戴道具的 Clawd（耳机、安全帽、放大镜、举牌「等 lyjw 验收」）一拍一只从欢迎框上沿冒出来谢幕，和框里那只一起庆祝，14.05 起按十六分依次缩回 | 12:0 终和弦上的长音和一声低的；框里 Clawd 两次举手各一声往上挑的小「啾」（12:1 A5 D6，13:2 E6 A6）；12:2、12:3、13:0、13:1 四只各一声小跳（A5 D6 E6 F6）；14:0 起缩回各一声轻键 |
| 14.05–16 | 14.05 起拉回整个终端，14:2 起自下往上清屏；14.85–15.6 暗底正中大字 `lyjw.me`，旁边一根闪的光标；15.6 起停在第 00 章第一帧 | 14:2 清屏一声很轻的、从低往高的擦声；尾音淡出；第 00 章从同一个 Dmadd9 起 |

| 键 | 小节 | 中文 | English |
|---|---|---|---|
| `ch10.n1a` / `n1b` | 1.05–1.72 / 2.05–3.72 | Mac 只寄出 appleMusic 这一格，／入口验过 JWT，分进实时那根管； | The Mac sends just appleMusic; / ingress verifies it, sorts it live; |
| `ch10.n2a` / `n2b` | 4.1–5.9 / 6.02–7.4 | StateHub 串行落账，交回效果单；／回执回入口盖 202，推送同时出发。 | StateHub commits, returns effects; / 202 goes back as the push goes out. |
| `ch10.n3a` / `n3b` | 7.85–9.4 / 10.05–10.5 | WebSocket 到站，写进 SWR 缓存，／卡片当场翻面。 | The WebSocket lands it in SWR, / and the card flips. |
| `ch10.noRecast1` / `noRecast2` | 7.05–7.75 | 换歌不重印：／交给推送 | No recast: / push does it |
| `ch10.mapA` / `mapB` | 10.65–11.95 / 11.05–12 | 这是整座邮局：／采集端、中枢、再印到屏幕上。 | The whole post office: / reporters, the core, the screen. |
| `ch10.end1` | 12.15–14.5 | 谢谢观看 | Thanks for watching |
| `ch10.end2` | 12.15–14.5 | 讲解 Claude Opus 5.5 · lyjw.me | Narrated by Claude Opus 5.5 · lyjw.me |
| `ch10.sign`（牌子） | 13.3–14.3 | 等 lyjw 验收 | Waiting on lyjw |
