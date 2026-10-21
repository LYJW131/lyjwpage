# 讲解动画 v2 · 章节作者约定

> 类型：reference

写 `/explainer` v2 某一章的契约：章节怎么接进时间轴、怎么画、字多大、文字键、配乐、交接、自检、提交。分镜和旁白在 [SCRIPT.md](../SCRIPT.md)，事实出处在 [FACTS.md](../FACTS.md)，画法总则、母题和调色板的来历在 [TREATMENT.md](../TREATMENT.md)。照着抄的样板：第 04 章（报纸纸面）`ch04.js` + `music/ch04.js`，第 07 章（暗底像素）`ch07.js` + `music/ch07.js`。每章的底和合成各按自己的画法拼，没有统一的底板。

## 文件与分工

| 文件 | 谁改 | 内容 |
|---|---|---|
| `ch<NN>.js` | 章节作者 | 这一章的画面，顶部 `I18N.add` 是这一章的全部文字 |
| `music/ch<NN>.js` | 章节作者 | 这一章的配乐乐谱 |
| `plan.js` | 主创 | 章节顺序和小节数，抄 SCRIPT 的章节表 |
| `score.js` | 主创 | 合成器、共享词汇、按章拼装 |
| `engine.js`、`kit.js`、`film.js`、`i18n.js`、`index.html`、`tools/` | 主创 | 引擎、共用件、时间轴与播放器、播放器文字、加载顺序、自检工具 |

`index.html` 已按顺序列好十一章（00–10）的两个文件，还没写的加载失败会被忽略、由占位画面和占位配乐（每拍一声滴答）顶上，整片始终能从头播到尾。并行期每位作者只碰自己那两个文件（旁白要改时连带 SCRIPT 里自己那一章）；第 01 章的画面拆在 `ch01.js` 和五个 `ch01-*.js` 里，另用 `vendor/three.min.js`，算作这一章自己的文件。需要新的共用件，先在本章文件里写局部函数；需要新音色、新剧情音，先用现有的顶上；这两样都在交付说明里写清，收尾由主创加进 `kit.js` / `score.js`。

## 章节接口

```js
(() => {
  I18N.add({ "ch05.title": ["电报线", "The live wire"], "ch05.n1a": ["…", "…"] });
  let plate, ink, emit, paper, stampL, top;
  function render(f) { /* 见下 */ }
  window.CHAPTERS.push({
    id: "ch05", title: "ch.05", bars: 18,
    init() { plate = G.pass(K.PLATE.ink); ink = G.layer("ink"); emit = G.layer("emit", 0.5); paper = G.layer("paper"); stampL = G.layer("stamp"); top = G.layer("top"); },
    render,
  });
})();
```

- `bars` 必须等于 `plan.js` 里这一章的小节数（不一致时报错，以 plan.js 为准）；`title` 是进度条标签的键，在 `i18n.js`。
- `render(f)` 画一帧。`f.bar` 章内小节（浮点，5.5 = 第 5 小节第三拍）、`f.lt` 章内秒、`f.t` 全片秒、`f.BAR` / `f.BEAT` 秒数、`f.frame` 60 fps 帧号、`f.at(小节, 拍)` 章内秒、`f.hit(事件, 半衰期)` 某类配乐事件最近一次的衰减脉冲、`f.env(名字)` 配乐包络、`f.tr(键)` 查文字；后期参数写进 `f.post`（可用的键和默认值见 `engine.js` 的 `POST_DEFAULT`）。
- **画面是时间的纯函数**：同一个 `f` 永远画出同一帧，拖动、`?t=`、无头抽帧才一致。不读 `Date`、`performance.now()` 或任何时钟；不用 `Math.random`（用 `K.mulberry32(种子)` 或 `K.hash(n)`）；帧与帧之间不留状态。时间一律写章内小节，关键时刻落在拍上。

## 图层与合成

`render` 的顺序：`K.camera` 算镜头 → `G.setCam(cam)` → `G.fill(plate, { uGridA, uPlate })` 画图版底 → 每个图层 `begin()` 清空、`cam(cam)` 进世界坐标 → 画 → 按下表顺序 `G.composite(图层.upload(), {...})`。

| 次序 | 图层 | 合成 | 画什么 |
|---|---|---|---|
| 1 | `G.layer("ink")` | `G.MODE.ink`（纸上吃墨；暗底的骨白线也用它） | 线稿、字、旁白 |
| 2 | `G.layer("emit", 0.5)` | `G.MODE.add`，`gain` 1.3–1.6 | 只放 signal 色的发光：信封亮核、灯、广播的环 |
| 3 | `G.layer("paper")` | `G.MODE.paper` | 暗底图版上的白卡（`K.sheet`）和卡上的字 |
| 4 | `G.layer("stamp")` | `G.MODE.stamp` | 橡皮章（`K.stamp`） |
| 5 | `G.layer("top")` | `G.MODE.normal` | Clawd、气泡 |

图层按名字从共用池里取，各章共用同一组画布（同一时刻只画一章），不要自己 `new G.Layer`。着色器用 `G.pass(源码)`，同一段源码只编译一次。共用的图版底是 `K.PLATE.paper` / `K.PLATE.ink`（目前只有第 10 章用），`uPlate` 是这一章大图纸的世界坐标范围 `[x0, y0, x1, y1]`，网格只铺在里面；换了画风的章可以用自己的底版着色器（第 00 章 `ch00.js` 的 `PLATE`），图层只开用得上的几层，合成次序按这一章自己的需要排（第 04 章 `ch04.js` 把 `emit` 放在 `stamp` 后面，第 02 章只用 bg、top 两层）。

## 镜头

- 只有平移、缩放、旋转：`CAM = [[小节, [x, y, zoom, rot], 缓动], …]`，`const { cam, blur, zoomBlur } = K.camera(CAM, f.bar, f.BAR)`，`blur`、`zoomBlur` 原样放进 `f.post`（按镜头速度算运动模糊和径向模糊）。
- 世界坐标：镜头在 `(960, 540)`、缩放 1 时，世界坐标就是 1920×1080 的屏幕坐标。一章一张大图纸，分几个机位。
- 机位之间在强拍上甩（约 0.2–0.3 小节，`K.E.io`）；停住时用 `K.E.lin` 慢推 1–3%；冲进去用 `K.E.inExpo`。落章、盖章那一下可以把 `zoom` 乘 1.02 左右顶一下，配 `f.post.shake`。

## 字

- **字号下限**（舞台 1920×1080 逻辑像素，手机上约缩到 0.2 倍）：旁白屏幕上不小于 56 px，要读的标注不小于 28 px。屏幕字号 = 字号 × 镜头缩放 × 自己加的缩放：缩放 0.66 的机位上，标注要写到 43 px 以上、旁白 85 px 以上。更小的字只能当纹理，给 `K.text` 传 `texture: true`。
- 旁白一律用 `K.narration`（默认 60 px、逐字亮），按 SCRIPT 的行宽写（中文每行不超过 17 字，英文不超过 36 个字符）；要读的字走 `K.text` 或 `K.leader`。**只有经过 `K.text`（`K.narration`、`K.leader` 也走它）的字会被 `tools/check.mjs` 量到**；`K.stamp` 的主字和 `sub`、`K.bubble`、自己 `fillText` 的字量不到，要自己保证：`K.stamp` 的 `sub` 要读就给 `subPx`（不小于 28）。
- check 的判据是「这句字落在画面里时出现过的最大屏幕字号」，只能证明它在某一刻够大；要读的字在它该被读的那个机位上够大才算数，抽帧时看。
- **文字键**：人读的字（旁白、标注、标题、气泡）一律写成 `ch<NN>.*` 键，在本章文件顶部 `I18N.add({ 键: [中文, English] })`，场景里用 `f.tr(键)`。机器的字（端点、状态码、代码标识符、`KV LAG` 这类名字）两种语言一样，可以直接写。数据源里的内容（歌名、剧名）照原样。旁白原文以 SCRIPT 为准。
- 英文按同一条时间轴播放、时长按中文算；英文通常更长，给 `maxW` 让它缩字，但缩完仍要满足下限（check 会查）。`K.FONT.cjk` 在英文模式下自动把 Geist 排到前面。

## 调色板与字体

- 颜色只用 `G.css(名字, 透明度)`：`ink` `ink2`（暗底与暗底上的实心物件）、`paper`（纸面、白卡）、`pink`（纸上的墨）、`bone`（暗底上的字与线）、`graphite` / `ash`（次要线和注记，纸上用 graphite、暗底用 ash）、`signal`（纸面上的橙）/ `signalD`（暗底上的橙）、`ember`（信封亮核）、`live` / `liveL`（在线绿，暗底 / 纸面）。取值在 `engine.js` 的 `LIN`。
- 橙色是全片唯一发光的颜色；在线绿只在第 05 章（在线人数）和第 06 章（今天那一格）出现。站点卡片原来的颜色（圆环三色、品牌色）一律画成 signal / bone。
- 字体：`K.FONT.cjk`（中文旁白与标注）、`K.FONT.sans`（Geist，标题、英文）、`K.FONT.mono`（机器的声音：端点、状态码、JSON、计时、注记）、`K.FONT.pixel`（Clawd、终端、章节号）。

## kit.js 共用件

| 类 | 件 | 用法 |
|---|---|---|
| 时间 | `E.*`、`prog(t, a, b, 缓动)`、`keys(t, [[t, 值, 缓动], …])`、`track(t, [[t, 目标], …])` | 缓动；`t` 在 `[a, b]` 里的进度；关键帧插值，每个键都停住（值可以是数组）；叠加弹簧，连续经过几个点时用，换目标不减速 |
| 随机 | `mulberry32(种子)`、`hash(n)` | 带种子的随机，逐帧闪烁用 `hash(f.frame)` |
| 字 | `text`、`narration`、`measure`、`FONT` | `text(x, 字, px, py, { font, color, align, reveal, dim, alpha, maxW, texture })` |
| 线 | `line`、`polyline`、`rect`、`fillRect`、`dashed`、`roundRect` | `polyline(x, 点, k)` 按进度 k 把折线画出来，返回笔尖位置 |
| 物件 | `envelope`、`stamp`、`clawd`、`bubble`、`spark` | 信封（`open` 翻开封舌）、橡皮章（画在 stamp 层，`k` 落章进度）、Clawd（`pose`、`crouch`，造型出自 `../clawd.js`）、对白框、信封火花（亮核画在 emit 层） |
| Clawd 的戏 | `clawdSeq`、`clawdFrame`、`clawdProp`、`hop` | `clawdSeq(名字, 小节, 起点, BAR)` 按官方动画（`../clawd.js` 的 `SEQ`，一帧 `FRAME_MS`）取这一刻的帧，播完回 null；`clawdFrame` 画这一帧（带水平位移和落地的烟）；`clawdProp` 按 Clawd 的格子坐标画道具（`hardhat` 安全帽、`headset` 耳机、`magnifier` 放大镜、`sign` 牌子），跟着 `flip` 镜像；`hop(小节, 起, 止, 高)` 一跳的抛物线高度 |
| 图版 | `PLATE.paper`、`PLATE.ink` | 两种图版底的着色器源码，交给 `G.pass` |
| 母题 | `glyph(x, 种类, cx, cy, 颜色, 缩放)` | 四个库的符号：`room` 实时、`lag` 可滞后、`d1` 历史、`cred` 凭据；全片一致 |
| 详图 | `sheet`、`checkbox`、`leader` | 白卡（画在 paper 层）、按拍打勾的方框、引线标注（锚点 → 引线 → 字压在底线上） |
| 路径 | `pathAt`、`pathLen`、`trailOn` | 折线按弧长取点、总长、身后一段拖尾 |
| 镜头 | `camera(CAM, 小节, BAR)` | 见「镜头」 |

## 交接

每章自己负责首尾两拍：上一章怎么落，这一章怎么起。默认找一个两章共有的东西做桥（匹配剪辑、甩镜头、底色溶进下一章），不留整屏空白或纯黑，配乐在上一章最后一小节给过门、落到下一章第一拍；SCRIPT 章节表写了做法的照做，做不到就在交付说明里写明，由主创协调相邻两章。已经定下的几处：

- **00 → 01**：匹配剪辑。第 00 章 11:2 起推进总装图里 Mac 那一格的笔记本小样（`ch00.js#CUT`：`E.io` 在 `AT.end` 11.9 到位，之后按 `creep` 慢推到 12:0），Mac 的名字和图版网格在推进时淡掉，末帧满屏只剩晒图蓝和红线笔记本，笔记本框心在屏幕中心上方 2 格处。第 01 章首帧从 `share.cut` 取位置、大小、线宽、底色和后期参数，在同一处、同样大小画出同一个红线笔记本，镜头接着按同一速率慢推（`ch01.js#camOpen`、`blueprint`）：镜头从正前方微微俯看 Mac 屋里的笔记本，屏幕正对镜头；0.03–0.3 蓝底从笔记本往外化开、红线变到立体笔记本的轮廓上再淡掉，0.18–0.7 拉出到 S0 全景，镜头一路绕到 45° 方位（2.2 绕完）；后期参数从第 00 章的值缓到本章自己的值。S0 的标题、标签、信封从 0.7 起才出，旁白 `n1` 0.6 起，拉出没走完时按当前镜头画在屏幕上。配乐：第 00 章不再扫频、不再下坠，11:2 起马林巴弹 A7sus4 上行琶音（两台交替、渐强，后四个音钢片琴叠上），11:3 吸一口气，落到第 01 章 0:0：底鼓、开镲、贝斯和电钢的 Dmadd9 一起落。
- **01 → 02**：甩镜头。第 01 章骑乘值不变（`rideD`：`E.inExpo`，到 N − 0.02 走完 1100；28.66 Clawd 跳上去；蹲姿 pose `default`、`offset` 1、不翻转，正面 18 格、屏幕上 126 px 宽，底边比亮核高 7 px；亮核在屏幕 y 540，镜头缩放 1 → 1.014；约 28.97 Clawd 整只出右缘）。28.75 起镜头往右 `E.inExpo` 横甩，到 N 甩过 2200（`ch01.js#WHIP`），骑手和火花加上同一段位移，屏幕轨迹不变，画面带横向运动模糊；最后两帧第 02 章的红斜块（`ch02.js` 的 `share.whipBand`）从右缘进画，N:0 那一帧它的左下角在屏幕 x 900。第 02 章 0:0 镜头还落在左边 `WHIP.D` 处，按第 01 章末的屏幕速度起步、`E.outExpo` 在 0.35 内刹到 `CAM0`（`ch02.js#WHIP`；0:0 之前那一帧按起速外推，首帧就带着同方向的模糊），红斜块和墨条往左甩出画，门墙从右边滑进来；火花和 Clawd 减去同一段位移，仍照原来的值从左缘骑进来、`E.outExpo` 在 `A_BRAKE` 内刹停（`A_PATH`、`sparkD`）。两边的甩程、时长和出口缩放注释里都写了须同步。配乐：第 01 章 28:3 吸一口气，一口甩镜头的风（`whoosh` 的 `whip`，中点最响）落在剪切点上，收在 A7sus4；第 02 章 0:0 军鼓一记带倚音的重音接住，落在 D 小调，小号在军鼓滚奏上唱信封主题。
- **02 → 03**：第 02 章 29.2 起冲回「状态核心已提交」那盏灯（29.74 缩放 1.15，29.97 `inExpo` 推到 60），29.77 起整屏化成橙色，`f.post.fade` 在 29.97 到 1（30:0 那一帧归第 03 章）；第 03 章从黑里起，0.25 小节内淡入，先亮的是片头字卡上的饼眼台灯（屏幕 960, 250）；1.75–2.0 光圈收到这盏灯上，2.0 从屋里那盏台灯的同一屏幕点张开。 配乐：第 02 章 29:1.75 下坠，滚奏推到 29:3.75 的一记对镲，镲和低音的 A 拖过 30:0 自己衰减，不在落黑处掐断；`sweeps` 照旧写到第 03 章的 0:0 / 0:1（下坠在交接点最闷），第 03 章用 `postBars: [0, 1]`。
- **03 → 04**：第 03 章 25.6 起冲进号外头版空白的照片框（`ch03.js` 的 `NP.box`，框里填 `G.css("paper")`），`inExpo` 放大到 12，25.97 停住，满屏是纸，**不落黑**；胶片颗粒和划痕 25.65–25.9 淡掉，后期颗粒 25.935 起才加。第 04 章第一帧必须是满屏的纸（纸面图版、`uGridA` 从 0 起），拉远从第一帧就起步（`ch04.js` 的 `CAM`，0–0.9 `outExpo` 从 12 拉到 0.44）；版面不等：`AT.print` 是 0，墨色 0–0.08 跟着淡进来，首帧镜头里只有 A、B 两栏之间的空白，拉远的头几帧就看得到正文和印版。首帧的后期参数和第 03 章最后一帧一样（bloom 0.7、threshold 0.9、halation 0.28、grain 0.05、vignette 0.42、ca 0.4），之后再缓到本章自己的值。配乐：第 03 章 25:0 啪地停住后滚奏和单簧管颤音垫到 25:2 的 A7，滑哨顺着冲镜往上滑；撞进框里那一下写在第 04 章 0:0：热爵士的捂镲（`kind: "toon"`）、boom、章、落地、印刷机和翻纸一起落在强拍上，Dm9 接住。
- 冲镜接下一章首帧（03 → 04）时，最后一个镜头键写在 N − 0.03，到位后停住，不写在 N:0：N:0 那一帧属于下一章，`inExpo` 的键落在 N，本章最后一帧只走到八九成、还带着运动模糊，和下一章首帧对不上。
- **04 → 05**：不落黑。第 04 章 13.3 退回整版后停住慢推；13.44 起第 05 章的剪纸从右边滑进来盖住报纸：朱红、芥末黄两条先走一步，米白纸面载着片头海报（芥末黄圆盘、戴耳机的 Clawd、墨条）压在最上面，左沿是手剪的斜边带投影，约 13.8 报纸全被盖住。这张纸由第 05 章画（`ch05.js` 的 `WIPE`、`sheetOff`、`wipe`，经 `share.wipe` 交给第 04 章，第 04 章在最上层按屏幕坐标调 `wipe(tp, b − 14)`）；第 05 章 0–0.5 镜头 x = 960 − `sheetOff(b)`，同一条 `outExpo` 接着减速到停，剪切点两边是同一张纸、同一个位置，后期参数都是 grain 0.035、vignette 0.22。配乐：第 04 章 13:2 起拨弦按 Dm9 → A7sus4 往上一串（A3 到 G5），13:3 吸一口气，13.44 一口风、两声纸片；第 05 章 0:0 叮叮镲一记、底鼓、刷子点接住，低音提琴 D 长音照旧。
- **05 → 06**：第 05 章最后把示波线拉平成屏幕 y 540 一条整宽直线；第 06 章首帧镜头缩放 1.5（`ch06.js` 的 `Z0`、`FIRST`），这条线就是心电图的基线，只画到笔尖为止，0:0 的报到尖峰在屏幕 x 1100 处立起来，0–0.95 往后拉出整条心电图。不落黑。配乐：第 05 章 27:3 刷子点两下、底鼓带一下，颤音琴按 A7sus4 往上一串（E4 到 G5），收在 A7sus4，第 06 章 0:0 落回 Dm9。
- **06 → 07**：第 06 章最后一小节里镜头升回地面，16:0 停在 `[960, 540]`、缩放 1；心电图的起伏 15.1–15.5 渐平成屏幕 y 540 一条水平墨线，笔尖停在屏幕 (1350, 540)；15.45–15.95 墨从四边往笔尖晕进来（`ch06.js` 的 `inkNight`），宣纸被吞成纯黑，黑里那段线是白的，笔尖的朱砂圆点收成橙色方点，15.95 起画面就是第 07 章首帧：黑底、屏幕 y 535–545 一道整宽白线、(1340–1360, 530–550) 的橙色方点（`ch07.js` 的 `sTitle` 在 `AT.crt` 之前那一帧，`ch06.js` 的 `C_W`、`C_O` 抄 `ch07.js` 的 `C.w`、`C.o`），暗角和颗粒也在收尾半小节里收到第 07 章的值；之后白线张开成显像管开机，橙点跳起来变成 Clawd。配乐：第 06 章 15:0、15:1 心跳两下就停，15:2 起一声长「嘀」（`score.js` 的 `jCflat`，D5，正弦渐渐长出奇次谐波）拉到 16:0，收在 A7sus4；第 07 章 0:0 同音 D5 的方波加一记底鼓接住，落回 Dm9。
- **07 → 08**：第 07 章末尾（`AT.mosaic`）把 8 位大厅按 5、4、3、2 个屏幕像素一格逐级变细，最后一档就是第 08 章首帧的彩铅大厅：屏幕 y 540 是挂灯笼的 main，HEAD 在 x 1350，提交圆点落在第 06 章那几处敲门尖峰的横坐标上（`ch07.js` 的 `HEAD`、`COMMITS` 照抄 `ch08.js` 的 `Y0`、`HEAD0`、`OLD`，后者跟着 `ch06.js` 的心电图几何；大厅的画法与种子也照抄，几处都注明）。配乐：第 07 章收在 A7sus4、最后一小节第 3 拍空着吸一口气，第 08 章 0:0 一声 boom 落地。
- **08 → 09**：第 08 章 18.4 起镜头停在 `FIN`，屏幕 y 540 一条 main 线，灯笼在屏幕 x 50、250…1250，HEAD 在 x 1350。最后一小节（`ch08.js` 的 `HAND`、`handoff`，故事小节）19.375–19.75 一块橡皮来回五道，把大厅擦成第 09 章的暖白纸（`#F5F3EE`），只留灯笼；19.6 起一道铅笔线顺着 y 540 画过去，19.7 起灯线和挂绳淡掉，19.74–19.9 铅笔线从左往右描成 16 px 墨线，墨线走过哪盏灯，那盏灯就缩进黑圈白点的车站，HEAD 最后一颗；颗粒和暗角随擦除退到 0。最后几帧和第 09 章首帧一样，不落白、不落黑：几何照抄 `ch09.js` 的 `Y0`、`HEAD`、`COMMITS`，底色、墨色、线宽、站圈照抄它的 `C`、`LW` 和 `dot`（`ch08.js` 里叫 `C9`、`LW9`、`R9`），两处都注明。配乐：第 08 章最后一小节边击滚上去，拇指琴 Bbmaj7 两个八分，A7sus4 十六分一路往上爬到 A6，23:3 吸一口气（`swell`）；擦一道一声纸响，描墨线一声拉链；第 09 章 0:0 的 boom、底鼓、一记开镲和贝斯的 D 一起落在 Dsus2。
- **09 → 10**：第 09 章最后一帧是 #F5F3EE 平底、屏幕 y 540 一根整宽 3 px 的 #121212 墨线，后期全关；第 10 章 0:0 画同一帧（同底色、同一根线、`f.post` 的 bloom、halation、grain、vignette、ca 都是 0，threshold 1.2），字块 0.125 起才落下来，墨线就是信封滑进来、蓄力拉成 V 形的那根弦。配乐：第 09 章收在 A9sus4、16:3 吸一口气；第 10 章 0:0 用第 09 章的 motorik 音色接住（低「咚」、底鼓、开镲、贝斯的 D，弦乐机垫 Dm9），一小节后再换成每块字一章的乐器。
- **10 → 00**：第 10 章 20.5 起十条竖幕依次升起、上下墨色带滑出画外，幕后已经是第 00 章的终端（直接调第 00 章 `share` 上的 `termFrame(f, termState(0))`，后期用第 00 章 `share.cut.post` 那一组）；21.5 起只剩这一帧，和第 00 章 0:0 逐像素一样，首尾相接可以循环。谢幕的 Clawd 在 20.25 起跳下台、21.5 前全部出画。第 10 章 12.5–17 借 `paperFrame` 重放翻面那一段时，旁白按它自己的颜色画在 paper 层上：第 00 章在下方垫一块注释框，再把 paper 层整层染成白字（`extra`），晒图底上才读得清；第 10 章在旁白在场时压掉第 00 章推镜头的运动模糊。配乐：第 10 章收在 Dmadd9（20.5 起长音和低音 D 放到底），第 00 章从同一个和弦起。
- 配乐同理：第 02 章的 `sweeps` 写到第 03 章的 0:0 / 0:1（下坠在交接点最闷），第 03 章用 `postBars: [0, 1]`，第 0 小节的剧情音另标 `post`，绕开扫频；第 03 章最后一小节停在 A7（25:2 一记，滑哨顺着冲镜往上滑），第 04 章 0:0 的捂镲、boom、章和 Dm9 接住。

## 配乐

每章一份乐谱 `music/ch<NN>.js`，章内小节，`score.js` 按 `plan.js` 的顺序拼成整片；画面上所有「落在拍上」的动作查同一张表（`f.hit`、`f.env`），不做音频分析。

```js
(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch05",
  tone: { bell: "bright", pluckPan: 0, snareVerb: 0.12 }, // 可选：bell 还有 "warm"
  // seed: 可选，琶音和踩镲力度抖动的种子，默认按章 id 算
  // postBars: [a, b] 可选，这几小节的旋律不过母线扫频
  // chords: { Emadd9: ["E3", "B3", "F#4", "G4"] } 可选，本章要的新和弦（第一个音是根音；名字全片唯一，和已有的同名不同音会报错）
  score: ({ THEME, withNotes, phrase, midi, CHORD, BASS, ARP, BAR, BEAT }) => ({
    harm: ["Dm9", "G6", /* … 每小节一个；小节内换和弦写 [["A7sus4", 0], ["A7", 2]] */],
    sections: [{ from: 0, to: 3, id: "wire-intro", name: "…", energy: 0.4, kick: "X...X...X...X...", duck: 0.5,
      hat: "..x...x...x...x.", hatKind: "type", bass: "light", arp: { p: "sparse", lo: 69, inst: "pluck", v: 0.5 }, pad: 0.8, lp: 2400, padVerb: 0.3 }],
    melody: [...phrase(0, THEME, "bell", 1.2, true)], // [小节, 拍, 时值(拍), 音, 乐器, 力度, 是否主题]
    story: [{ bar: 5, beat: 0, kind: "stamp", size: "mid" }],
    sweeps: [], // [{ at: [小节, 拍], down: [小节, 拍], up: [小节, 拍], f: 380 }]，可以写到下一章去
  }),
});
```

- `harm` 的长度等于这一章的小节数；`sections` 要盖满每一小节（漏掉的会报错并补一段安静的）。
- 词汇都在 `score.js` 顶部：和弦 `CHORD`，鼓型是 16 格字符串（`X` 重、`x` 中、`o` 轻、`.` 空；数组逐小节轮换，`null` 不打），`kickKind`（tight / light / heart）、`snareKind`（thud / rim）、`hatKind`（type 打字机 / flip 翻纸），贝斯型 `BASS`（另有 `"hold"`），琶音型 `ARP`，段落里的 `clock`（钟摆，16 格，tick / tock 交替）和 `ghost: [隔几拍, 深度, 时间常数]`（不出声的幽灵底鼓，只让 pad 呼吸），旋律乐器 pluck / pluckDark / pluckMute / bell / bell2 / marimba（低音马林巴）/ kalimba（拇指琴，第 08 章唱主题）/ glass（玻璃读数灯，第 10 章回顾格用），剧情音 `story.kind`：key、stamp、tick、lamp、whoosh（`tube` 取 0–3 气动管、`"fork"` 分叉、`"down"` 下坠、`"whip"` 甩镜头的一口风，中点最响）、accent（`what`：arrive / slip / broadcast / flip）、swell、boom、morse（电键的「嘟」，`m` 音高、`len` 拍）、gate（闸门弹开）、off（熄灯，往下滑一个八度）、ping（报到的低音，`late` 是远处）、clear（清屏）、hop（Clawd 跳一下）；段落里写 `clockKind: "knock"`（或隔着地层的 `"knockFar"`）把钟摆换成敲门。
- `f.hit` / `f.env` 能取的事件：kick、snare、hat、clock（含敲门）、tick、stamp、whoosh、lamp、key、bell（只算主题音，不管哪件乐器唱）、accent；另有包络 duck、pad、bass、riser、energy、beat、bar。morse、gate、off、ping、clear、hop 只出声、不进事件表，画面按本章的 AT 落拍。
- **不改 `score.js`**：新和弦写在本章乐谱的 `chords` 里；新鼓型直接在 `sections` 里写 16 格字符串；新音色、新剧情音交给主创（改已有条目或合成器会改到别的章）。
- 信封主题 `THEME`（A4 D5 F5 E5）：信封出场时唱，每章换一件乐器。调性以 D 多利亚 / D 小调为主，全片不转调。
- 试听：`score-test.html?only=ch05` 看这一章的时间轴、事件和包络；`index.html?only=ch04,ch05,ch06` 连着前后章边看边听（只排几章时和整片 `score.mp3` 长度对不上，一定在浏览器里现合成）。不带 `?only=` 的整片预览放的是本地渲过的 `score.mp3`（不入库），乐谱改了而时长没变时听到的还是旧配乐；没有它就现合成。站点版的配乐推送后由 CI 渲染传到 R2，见 [README「站点版」](../README.md#站点版)。

## 事实

- 画面和旁白里的每个端点、数字、「谁做什么」都要能在 [FACTS.md](../FACTS.md) 找到。找不到就回代码核，核完连出处（`path#symbol`）补进 FACTS 对应的那一节再用；FACTS 和代码冲突以代码为准，改 FACTS。
- 会随代码变的数（首屏卡数、采集任务数、D1 表数）画的时候按写章时的代码数，旁白和标注里不说具体数。
- 不上画面：窗口标题隐私判断的判据、阈值、例子（只说 Jev 参与、拿不准交 lyjw、放行才进信封，概率条是示意）；站点自检的 Cloudflare 账号 ID、真实报错标题、可用率数字（令牌不上画面，只标请求实际做的事，如 `SELECT`，不声称权限范围）；真实密钥和 client id；歌词原文（用占位）；没重测过的延迟数字；厂商 logo（厂商只用 Mono 字写名字）。
- 编码用量只讲到「Mac、云端、容器代报的 Cursor 账号各报原始事实，站点侧合并；Pulse 上有一条 token 处理量（5 分钟平均）」，不点存储键和模块名；不说「生成速度」，也不说它是此刻的精确值（FACTS §1「编码用量」）。

## 禁止

- 透视、光线步进、3D（第 01 章例外：lyjw 要的真 3D 微缩，模型用 three.js 渲染，字、牌子和标注仍画在 2D 层上）；调色板以外的色相；signal 以外的东西发光；紫青霓虹、发光大脑、代码雨、粒子星云、镜头光晕、云朵加机柜这类库存图示；模仿别家产品的界面（站点自己的主页可以画）。
- 在场景代码里写人读的字面文字；读时钟、`Math.random`、跨帧状态。
- 改自己两个文件以外的文件（SCRIPT 里自己那一章、FACTS 里要补的出处除外）；提交 `score.mp3`、截图、联系表。
- 用浏览器面板截图（面板隐藏时是空帧），自检一律走下面的无头工具。

## 自检

在仓库根目录跑。工作树里先接上渲染工具的依赖（`playwright-core`；工具在 Mac 上用本机 Chrome，在云端用 Playwright 自带的 Chromium，见 `tools/browser.mjs`）：

```bash
ln -s <主仓>/docs/explainer/render/node_modules docs/explainer/render/node_modules   # 主仓也没装就：pnpm --dir docs/explainer/render install --ignore-workspace
node docs/explainer/v2/tools/check.mjs 05                     # 中英各把这一章每 1/8 小节画一遍：字太小、缺文字键、报错；有问题退出码 1
node docs/explainer/v2/tools/en-cjk.mjs <目录>/cjk.json 05      # 英文模式下还画出来的中文；章号不写就扫整片
node docs/explainer/v2/tools/stills.mjs <目录> c05:0 c05:2.5 c05:17.9 c06:0      # 抽帧（写秒数也行），输出 zh_c05_2_5.png
node docs/explainer/v2/tools/stills.mjs <目录> --lang en c05:0 c05:2.5           # 英文
node docs/explainer/v2/tools/stills.mjs <目录> --scale 0.2 c05:5                 # 375px 宽手机的等效图
montage <目录>/zh_*.png -tile 4x -geometry 960x540+4+4 -background '#222' <联系表>.png
node docs/explainer/render/serve.mjs docs/explainer 4827      # 预览：http://localhost:4827/v2/?only=ch04,ch05,ch06（用完关掉）
```

交付前：`check.mjs` 通过；中英各一张联系表，覆盖每个机位、每句旁白、每个配乐锚点，外加和前后章交界处各一帧（上一章最后一帧、本章第一帧、本章最后一帧、下一章第一帧；相邻章还没写时那边是占位画面，只核自己这一侧，接不接得上由主创合并后再核）。联系表由主创派 Haiku 看（字够大、没有压字和出界、英文不溢出、交接连得上），作者不自己逐张看。

整片的逐帧验收（渲帧、拼图、派 Haiku 看图、像素比对）由主创在合拢后做，见 `.claude/skills/lyjwpage-explainer/SKILL.md`。

## 提交

云端几位作者在同一个工作树里并行时不提交、不切分支、不用 `git stash`，交回时列出改了哪些文件，由主创统一提交；下面是 Mac 上各开工作树时的规矩。每章在自己的分支 / 工作树上做，从讲解片的阶段分支开出来。只 `git add` 明确路径（`docs/explainer/v2/ch<NN>.js`、`docs/explainer/v2/music/ch<NN>.js`，改了旁白、补了事实再加 `docs/explainer/SCRIPT.md`、`docs/explainer/FACTS.md`），不用 `git add -A`；中文提交信息，形如 `docs(explainer): 第 05 章电报线`；提交走签名，不加 `--no-gpgsign`；不 push、不合 main，交回前先 rebase 到阶段分支的最新提交。
