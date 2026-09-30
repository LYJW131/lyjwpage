# 讲解动画 v2 · 章节作者约定

> 类型：reference

写 `/explainer` v2 某一章的契约：章节怎么接进时间轴、怎么画、字多大、文字键、配乐、交接、自检、提交。分镜和旁白在 [SCRIPT.md](../SCRIPT.md)，事实出处在 [FACTS.md](../FACTS.md)，画法总则、母题和调色板的来历在 [TREATMENT.md](../TREATMENT.md)。照着抄的样板：第 02 章（纸面）`ch02.js` + `music/ch02.js`，第 03 章（暗底 + 白卡）`ch03.js` + `music/ch03.js`。

## 文件与分工

| 文件 | 谁改 | 内容 |
|---|---|---|
| `ch<NN>.js` | 章节作者 | 这一章的画面，顶部 `I18N.add` 是这一章的全部文字 |
| `music/ch<NN>.js` | 章节作者 | 这一章的配乐乐谱 |
| `plan.js` | 主创 | 章节顺序和小节数，抄 SCRIPT 的章节表 |
| `score.js` | 主创 | 合成器、共享词汇、按章拼装 |
| `engine.js`、`kit.js`、`film.js`、`i18n.js`、`index.html`、`tools/` | 主创 | 引擎、共用件、时间轴与播放器、播放器文字、加载顺序、自检工具 |

`index.html` 已按顺序列好十一章（00–10）的两个文件，还没写的加载失败会被忽略、由占位画面和占位配乐（每拍一声滴答）顶上，整片始终能从头播到尾。并行期每位作者只碰自己那两个文件（旁白要改时连带 SCRIPT 里自己那一章）。需要新的共用件，先在本章文件里写局部函数；需要新音色、新剧情音，先用现有的顶上；这两样都在交付说明里写清，收尾由主创加进 `kit.js` / `score.js`。

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

图层按名字从共用池里取，各章共用同一组画布（同一时刻只画一章），不要自己 `new G.Layer`。着色器用 `G.pass(源码)`，同一段源码只编译一次。图版底只用 `K.PLATE.paper` / `K.PLATE.ink`；`uPlate` 是这一章大图纸的世界坐标范围 `[x0, y0, x1, y1]`，网格只铺在里面。第 02 章把 `emit` 放在最后（发光盖在印章上），新章按上表。

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
- 橙色是全片唯一发光的颜色；在线绿只在第 05 章（在线人数）和第 08 章（今天那一格）出现。站点卡片原来的颜色（圆环三色、品牌色）一律画成 signal / bone。
- 字体：`K.FONT.cjk`（中文旁白与标注）、`K.FONT.sans`（Geist，标题、英文）、`K.FONT.mono`（机器的声音：端点、状态码、JSON、计时、注记）、`K.FONT.pixel`（Clawd、终端、章节号）。

## kit.js 共用件

| 类 | 件 | 用法 |
|---|---|---|
| 时间 | `E.*`、`prog(t, a, b, 缓动)`、`keys(t, [[t, 值, 缓动], …])` | 缓动；`t` 在 `[a, b]` 里的进度；关键帧插值（值可以是数组） |
| 随机 | `mulberry32(种子)`、`hash(n)` | 带种子的随机，逐帧闪烁用 `hash(f.frame)` |
| 字 | `text`、`narration`、`measure`、`FONT` | `text(x, 字, px, py, { font, color, align, reveal, dim, alpha, maxW, texture })` |
| 线 | `line`、`polyline`、`rect`、`fillRect`、`dashed`、`roundRect` | `polyline(x, 点, k)` 按进度 k 把折线画出来，返回笔尖位置 |
| 物件 | `envelope`、`stamp`、`clawd`、`bubble`、`spark` | 信封（`open` 翻开封舌）、橡皮章（画在 stamp 层，`k` 落章进度）、Clawd（`pose`、`crouch`，造型出自 `../clawd.js`）、对白框、信封火花（亮核画在 emit 层） |
| 图版 | `PLATE.paper`、`PLATE.ink` | 两种图版底的着色器源码，交给 `G.pass` |
| 母题 | `glyph(x, 种类, cx, cy, 颜色, 缩放)` | 四个库的符号：`room` 实时、`lag` 可滞后、`d1` 历史、`cred` 凭据；全片一致 |
| 详图 | `sheet`、`checkbox`、`leader` | 白卡（画在 paper 层）、按拍打勾的方框、引线标注（锚点 → 引线 → 字压在底线上） |
| 路径 | `pathAt`、`pathLen`、`trailOn` | 折线按弧长取点、总长、身后一段拖尾 |
| 镜头 | `camera(CAM, 小节, BAR)` | 见「镜头」 |

## 交接

每章自己负责首尾两拍：上一章怎么落，这一章怎么起。默认是强拍上硬切；SCRIPT 章节表写了做法的照做，做不到就在交付说明里写明，由主创协调相邻两章。已经定下的几处：

- **00 → 01**：第 00 章 9.5 起以总览图里 Mac 那一格为锚冲进去，10:0 在强拍上硬切第 01 章的暗底，不对位。配乐：第 00 章的 `sweeps` 从 9:2 往下扫，第 01 章 0:0 最闷、0:1 打开；第 00 章收在 A7sus4，第 01 章从 Dmadd9 起。
- **02 → 03**：第 02 章冲进「状态核心已提交」那盏灯，整屏化成橙色，`f.post.fade` 在 19.97 到 1（20:0 那一帧归第 03 章）；第 03 章从黑里起，0.25 小节内淡入，先亮一盏桌灯。
- **03 → 04**：第 03 章在 15.72–15.97 冲进对照表白卡下方的空白，缩放到 12 停住，满屏是纸，**不落黑**。第 04 章第一帧必须是满屏的纸（纸面图版、`uGridA` 从 0 起），再往后拉；首帧的后期参数和第 03 章最后一帧一样（bloom 0.7、threshold 0.9、halation 0.28、grain 0.05、vignette 0.42、ca 0.4），之后再缓到本章自己的值。
- 冲镜接下一章首帧（03 → 04、07 → 08）时，最后一个镜头键写在 N − 0.03，到位后停住，不写在 N:0：N:0 那一帧属于下一章，`inExpo` 的键落在 N，本章最后一帧只走到八九成、还带着运动模糊，和下一章首帧对不上。
- **08 → 09**：第 08 章 12:0 镜头停在 `[960, 540]`、缩放 1，画面只剩心电图横线，笔尖在屏幕 (1350, 540)；第 09 章首帧硬切纸面，同一高度一条墨线（git 的 main），提交的圆点落在那几处敲门尖峰的横坐标上，这次的提交在笔尖的位置，首帧只有线和圆点（`ch09.js` 的 `HEAD`、`COMMITS` 跟着 `ch08.js` 的心电图几何，两边注明）。配乐：第 08 章收在 A7sus4，第 09 章 0:0 一声 boom 落地。
- **09 → 10**：第 09 章在 15.92 落到 `FIN`（缩放 1）停住，最后一帧只剩屏幕 y 540 一条整宽的 3 px 墨线；第 10 章首帧硬切暗底，同一高度一条整宽的骨白线：第 08 格的心电图拉平（`AT.grow` 从 0 起），笔尖往右另有一段平线接到格子右沿，就是长图版的脊线 `SPINE`；0.05 起尖峰长出来（`AT.grow`），0.2 起镜头往后拉（`AT.pull`）。配乐：第 09 章收在 A9sus4、15:3 吸一口气，第 10 章 0:0 落回 Dm9。
- **10 → 00**（循环）：第 10 章 13:0 起自下往上清屏，13.5 起调第 00 章 `share` 里的 `termFrame(termState(0))`，和第 00 章第 0 帧是同一个函数、同一份状态，只差按帧号取的颗粒。配乐：第 10 章收在 Dmadd9，第 00 章从同一个 Dmadd9 起。
- 配乐同理：第 02 章的 `sweeps` 写到第 03 章的 0:0 / 0:1（下坠在交接点最闷），第 03 章用 `postBars: [0, 1]` 让开场那声铃绕开扫频；第 03 章收在 Dm9 和 `bass: "end"` 上，第 04 章从这里接。

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
- 词汇都在 `score.js` 顶部：和弦 `CHORD`，鼓型是 16 格字符串（`X` 重、`x` 中、`o` 轻、`.` 空；数组逐小节轮换，`null` 不打），`kickKind`（tight / light / heart）、`snareKind`（thud / rim）、`hatKind`（type 打字机 / flip 翻纸），贝斯型 `BASS`（另有 `"hold"`），琶音型 `ARP`，段落里的 `clock`（钟摆，16 格，tick / tock 交替）和 `ghost: [隔几拍, 深度, 时间常数]`（不出声的幽灵底鼓，只让 pad 呼吸），旋律乐器 pluck / pluckDark / pluckMute / bell / bell2 / marimba（低音马林巴）/ glass（玻璃读数灯，第 01 章唱主题），剧情音 `story.kind`：key、stamp、tick、lamp、whoosh（`tube` 取 0–3 气动管、`"fork"` 分叉、`"down"` 下坠、`"whip"` 甩镜头的一口风，中点最响）、accent（`what`：arrive / slip / broadcast / flip）、swell、boom、morse（电键的「嘟」，`m` 音高、`len` 拍）、gate（闸门弹开）、off（熄灯，往下滑一个八度）、ping（报到的低音，`late` 是远处）、clear（清屏）、hop（Clawd 跳一下）；段落里写 `clockKind: "knock"`（或隔着地层的 `"knockFar"`）把钟摆换成敲门。
- `f.hit` / `f.env` 能取的事件：kick、snare、hat、clock（含敲门）、tick、stamp、whoosh、lamp、key、bell（只算主题音，不管哪件乐器唱）、accent；另有包络 duck、pad、bass、riser、energy、beat、bar。morse、gate、off、ping、clear、hop 只出声、不进事件表，画面按本章的 AT 落拍。
- **不改 `score.js`**：新和弦写在本章乐谱的 `chords` 里；新鼓型直接在 `sections` 里写 16 格字符串；新音色、新剧情音交给主创（改已有条目或合成器会改到别的章）。
- 信封主题 `THEME`（A4 D5 F5 E5）：信封出场时唱，每章换一件乐器。调性以 D 多利亚 / D 小调为主，第 06 章转调。
- 试听：`score-test.html?only=ch05` 看这一章的时间轴、事件和包络；`index.html?only=ch04,ch05,ch06` 连着前后章边看边听（只排几章时和整片 `score.mp3` 长度对不上，一定在浏览器里现合成）。不带 `?only=` 的整片预览放的是入库的 `score.mp3`，乐谱改了而时长没变时听到的还是旧配乐。`score.mp3` 由主创在乐谱定稿后用 `tools/score-mp3.mjs` 重渲入库（站点版只用它，见 [README「站点版」](../README.md#站点版)）。

## 事实

- 画面和旁白里的每个端点、数字、「谁做什么」都要能在 [FACTS.md](../FACTS.md) 找到。找不到就回代码核，核完连出处（`path#symbol`）补进 FACTS 对应的那一节再用；FACTS 和代码冲突以代码为准，改 FACTS。
- 会随代码变的数（首屏卡数、采集任务数、D1 表数）画的时候按写章时的代码数，旁白和标注里不说具体数。
- 不上画面：窗口标题隐私判断的判据、阈值、例子（只说 Jev 参与、拿不准交主人、放行才进信封，概率条是示意）；Sentry 的组织名、监控 ID、真实报错标题、可用率数字（令牌只标它实际发出的请求方法，如 `GET`，不声称权限范围）；真实密钥和 client id；歌词原文（用占位）；没重测过的延迟数字；厂商 logo（厂商只用 Mono 字写名字）。
- 编码用量只讲到「Mac、云端、容器里的 Cursor 各报原始事实，站点侧合并；Pulse 上有一条 token 处理量（5 分钟平均）」，不点存储键和模块名；不说「生成速度」，也不说它是此刻的精确值（FACTS §1「编码用量」）。

## 禁止

- 透视、光线步进、3D；调色板以外的色相；signal 以外的东西发光；紫青霓虹、发光大脑、代码雨、粒子星云、镜头光晕、云朵加机柜这类库存图示；模仿别家产品的界面（站点自己的主页可以画）。
- 在场景代码里写人读的字面文字；读时钟、`Math.random`、跨帧状态。
- 改自己两个文件以外的文件（SCRIPT 里自己那一章、FACTS 里要补的出处除外）；提交 `score.mp3`、截图、联系表。
- 用浏览器面板截图（面板隐藏时是空帧），自检一律走下面的无头工具。

## 自检

在仓库根目录跑。工作树里先接上渲染工具的依赖（`playwright-core`，用本机 Chrome）：

```bash
ln -s <主仓>/docs/explainer/render/node_modules docs/explainer/render/node_modules   # 主仓也没装就：pnpm --dir docs/explainer/render install --ignore-workspace
node docs/explainer/v2/tools/check.mjs 05                     # 中英各把这一章每 1/8 小节画一遍：字太小、缺文字键、报错；有问题退出码 1
node docs/explainer/v2/tools/stills.mjs <目录> c05:0 c05:2.5 c05:17.9 c06:0      # 抽帧（写秒数也行），输出 zh_c05_2_5.png
node docs/explainer/v2/tools/stills.mjs <目录> --lang en c05:0 c05:2.5           # 英文
node docs/explainer/v2/tools/stills.mjs <目录> --scale 0.2 c05:5                 # 375px 宽手机的等效图
montage <目录>/zh_*.png -tile 4x -geometry 960x540+4+4 -background '#222' <联系表>.png
node docs/explainer/render/serve.mjs docs/explainer 4827      # 预览：http://localhost:4827/v2/?only=ch04,ch05,ch06（用完关掉）
```

交付前：`check.mjs` 通过；中英各一张联系表，覆盖每个机位、每句旁白、每个配乐锚点，外加和前后章交界处各一帧（上一章最后一帧、本章第一帧、本章最后一帧、下一章第一帧；相邻章还没写时那边是占位画面，只核自己这一侧，接不接得上由主创合并后再核）；逐张看过：字够大、没有压字和出界、英文不溢出、交接连得上。

## 提交

每章在自己的分支 / 工作树上做，从讲解片的阶段分支开出来。只 `git add` 明确路径（`docs/explainer/v2/ch<NN>.js`、`docs/explainer/v2/music/ch<NN>.js`，改了旁白、补了事实再加 `docs/explainer/SCRIPT.md`、`docs/explainer/FACTS.md`），不用 `git add -A`；中文提交信息，形如 `docs(explainer): 第 05 章电报线`；提交走签名，不加 `--no-gpgsign`；不 push、不合 main，交回前先 rebase 到阶段分支的最新提交。
