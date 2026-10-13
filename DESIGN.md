# DESIGN.md

站点（`lyjw.me` 首页与各卡片）的视觉与交互规范。改任何站点 UI 前先读这份；新卡片、新部件、换样式都按这里的刻度来，不自拟数值。

- 颜色、阴影、字体族这些 token 的取值只在 `src/app/globals.css`（`:root`、`.dark`、`@theme inline`），这里只说用哪个、怎么用。
- 规范与代码冲突时：代码是现状，这份是目标。不符合这份的现有写法不是先例，新代码不照抄；修它们走单独的 PR（合并前要站主看过，见末节）。
- 章节顺序参照 Google Labs 的 [DESIGN.md 格式](https://github.com/google-labs-code/design.md)（Overview → Colors → Typography → Layout → Elevation → Shapes → Components → Do's and Don'ts），外加文案、动效与交付三节。
- 讲解动画 `/explainer` 是视频画面，有自己的字号与镜头约定，见 [`docs/explainer/v2/CONVENTIONS.md`](./docs/explainer/v2/CONVENTIONS.md)，不受本文件约束。

## Overview

一张「方格纸上的仪表盘」：浅暖灰方格底，等宽字体，零圆角，卡片是带硬阴影的纸片。气质是工程师的实时看板，安静、密、准。

- 每张卡有且只有一个视觉重点：一个大数字、一个圆环 / 表盘、一张封面。其余信息给重点让路。
- 信息靠字号、字重、颜色分层；只有一种字号字重的一行字不成卡（站主否掉过「纯一行字」与「太素」的版本）。
- 少即是多：不加说明性、署名性的灰色小字，不加装饰性分隔、徽章和 eyebrow 标签。
- 同一行、同一网格里的并列元素长得一样：同一套「标签 + 数值」，同字号同字重。
- 规则互相冲突时按这个顺序保：数据原样、主信息完整可读 > 首屏 SSR 即最终样子、不跳 > 同排等高、左边缘对齐 > 一个视觉重点、层级清楚 > 其余细节。

## Colors

全部用语义 token 的 Tailwind 类（`bg-surface`、`text-muted-foreground`、`border-line` …），组件里不写裸 hex / oklch。

| 角色 | token | 用途 |
| --- | --- | --- |
| 页面底 | `background` | 只给页面方格底，卡片里不用 |
| 卡片面 | `surface` / `surface-hover` | 卡片正文区、可点行的悬停 |
| 次级面 | `muted` | 卡片表头、选中的分段按钮、空格子 |
| 正文 | `foreground` | 主要文字与数值 |
| 次级文字 | `muted-foreground` | 标签、单位、时间、副标题 |
| 线 | `line` / `line-strong` | 内部分隔 / 卡片外框 |
| 状态 | `live` / `live-idle` / `live-off` | 在线、空闲、离线；通过 `StatusDot` 用 |
| 分类色 | `--signal-red/orange/yellow/green/blue/violet` | 图表系列、图例方块、分类标记 |
| 品牌色 | `claude`、活动圆环 `--activity-*` | 只给对应品牌或 Apple 活动圆环 |

- 对比度：文字对它的底色至少 4.5:1；24px 以上或 18.7px 以上加粗的大字至少 3:1；圆点、色条、圆环这类非文字图形至少 3:1。浅色和深色两套都要过。
- 彩色字要先算对比度。达不到 4.5:1 的颜色（如浅色主题下的 `live`、`claude`、`signal-orange`、`signal-yellow`，深色主题下的 `signal-green/blue/violet`）只用在色块、圆点、线条上，旁边的字用 `foreground`；要用彩色字就先给这个 token 补一个够深 / 够亮的文字变体。
- 颜色不单独承载意思：状态有文字（`Operational`、`Now Playing`），图表系列直接标注，标不下才用图例。
- 颜色只表达状态或分类；数值「好」或「重要」不是上色的理由（省了多少、排第一都不染绿）。
- 新 token 同时定义 `:root` 与 `.dark` 两个值；深色值是降饱和、提亮度的同色相，不是反色。
- 图表配色：对话里的图示用 `src/components/chat-visual.tsx` 里经 dataviz 校验过的顺序；卡片里的系列色从 signal 系取，不另起一套。

## Typography

字体族：全站 `font-mono`（Geist Mono，数字默认等宽 + 斜杠零）。中文落到系统字体（苹方等）。

- 中文标题（如摘要卡的中文标语）用 `font-sans` 粗体，短句、可带句号，参照 Apple 中文宣传语。
- 不用书法、手写、装饰性字体；不新增网络字体，确有需要先问站主。

字号阶梯（Tailwind 类），一张卡里最多用四级：

| 级别 | 类 | 字重 | 用途 |
| --- | --- | --- | --- |
| label | `label-mono`（11px，大写，字距 0.08em） | 400 | 卡片表头、字段标签（`DOWNLOAD`、`UPTIME`） |
| caption | `text-xs`（12px） | 400 | 时间、单位、次要元信息 |
| body | `text-sm`（14px） | 400 / 500 | 列表行主文字、名称、正文 |
| lead | `text-base`（16px） | 400 / 500 | 卡内唯一的主名称（正在播放的歌名、手机上的地点） |
| title | `text-lg` → `lg:text-xl`（18 → 20px） | 600 | 卡片自己的标题句，一张卡最多一个 |
| stat | `text-2xl`（24px） | 500 | 数值网格里的主数值，同一网格内统一 |
| hero | `text-3xl` / `text-4xl`（30 / 36px） | 400 / 500 | 一张卡顶部的 KPI 行 |
| display | `text-5xl` 以上 | 400 | 整卡只有一个数字时（如电量百分比） |

- 最小字号 11px。10px 只允许出现在图形内部（坐标轴刻度、热力图月份、表盘刻度数字）；9px 及以下不用。
- 不写 `text-[10px]`、`text-[13px]` 这类任意值；阶梯里没有的级别说明阶梯该扩，先改这份文档。
- 同一组并列数值不因字符串更长或数值更大单独缩字号；放不下先缩短或挪走次要信息，还不行就整组一起降一级。
- 字重只用 400 / 500 / 600；700 只给站名（Contact 卡的 `LYJW131`）与中文标语。
- 字距：`label-mono` 自带；标题可 `tracking-tight`；正文不改字距。行高：多行正文 `leading-relaxed`，单行数值 `leading-none` / `leading-tight`。
- 数字一律等宽（全站默认 `tabular-nums`），变化的数字用 NumberFlow，并保证服务端 HTML 里就有值。
- 长文字：标题 `text-balance`；名称类单行截断（`truncate`）且在别处能看到全文；URL / ID 用 `break-words`，不用 `break-all`。

## Layout

基准是 4px。间距只取下表这些 Tailwind 刻度：

| 刻度 | px | 用途 |
| --- | --- | --- |
| `0.5` / `1` | 2 / 4 | 标签与数值之间、图标与文字之间 |
| `1.5` / `2` | 6 / 8 | 行内元素间距、紧凑列表行距 |
| `3` | 12 | 卡片之间的网格间距、组内条目间距 |
| `4` | 16 | 卡片内边距（窄）、组与组之间 |
| `5` | 20 | 卡片内边距（`lg` 起）、组与组之间（`lg` 起） |
| `6` / `8` | 24 / 32 | 分区之间 |

- 间距只有一个主人：一组兄弟元素之间的距离由父级的 `gap` / `space-y-*` 设，子元素不再各自带 `mt-*` / `mb-*`。某处过渡别扭时改分组或父级的间距，不给单个元素补一次性外边距。
- `2.5`、`3.5`、`4.5` 这类半步和 `[3px]` 这类任意值不用。唯一例外是把图形与文字基线对齐的光学微调（如给方块图例 `-translate-y-px`），必须写一行注释说明对齐的是什么。
- 页面：内容最大宽 `max-w-5xl`，两侧至少 16px（`w-[calc(100%-2rem)]`）；断点用 Tailwind 默认（`sm` 640 / `md` 768 / `lg` 1024），`md` 起两栏。
- 卡片网格：`grid gap-3`，横纵都是 12px；同一行的卡片等高。替换或新增卡片不能改变所在行的高度（首屏 Contact 与摘要卡这一排桌面是固定的一排高），交付前量前后高度。
- 卡片尺寸：`src/app/page.tsx` 的 `SLOT` 里每张卡的 `contain-intrinsic-size` 要跟实际高度一致，改了卡片高度同步改它，否则滚动时页面会跳。
- 卡片内边距（inset）：窄于 `lg` 是 16px（`p-4`），`lg` 起 20px（`lg:p-5`）。一张卡里所有内容的左边缘落在同一条线上：表头标签、正文、列表行文字都对齐这条线。
  - 通栏的行（列表行、状态网格格子、左右分栏）可以把分隔线和悬停底色铺到卡片边缘，但行里的文字仍在 inset 线上：悬停底色要往外扩时用 `-mx-2 px-2`，不要让文字缩进。
  - 卡内组与组之间的距离等于 inset（16 / 20px）；组内条目 8–12px；标签到数值 2–6px。
- 等高的多栏列表：各栏行高一致（如 44px），配合吸附滚动后两边对得齐。
- 手机（375px）：单栏；数值靠右；不截断主信息（供应商名、歌名优先换行或缩短次要信息）；不出现横向滚动。桌面布局调整用断点限定，不顺带改手机。

## Elevation & Depth

- 只有一种层级：卡片的 `paper-card` 硬阴影（实色、无模糊，往右下偏移）。可按的卡片悬停时阴影收短、整体向阴影方向平移，像按下去。
- 不用模糊阴影、发光、毛玻璃、渐变背景。弹层（`src/components/ui/modal.tsx` 的 `Modal`）是 `surface` 面，底下用半透明 `background` 盖住页面，不加模糊。

## Shapes

- 圆角一律 0：`--radius` 为 0，所有 `rounded-*` 都被映射成 0，不要绕开它写任意圆角。
- `rounded-full` 只留给真正的圆：状态点、圆环、表盘、品牌圆标。头像、封面、按钮、输入框都是直角。
- 线宽 1px；卡片外框 `border-line-strong`，内部分隔 `border-line`。

## Components

- 卡片：一律用 `src/components/ui/card.tsx` 的 `Card`，不手写外框和阴影。
  - 表头（可选）：至少 36px 高，`bg-muted`，左边是 `label-mono` 的卡名（可带 `StatusDot`），右边是来源或时间。表头的左右内边距等于正文 inset。
  - 无表头卡：只给首屏那类「一句话 + 一个图形」的卡（Contact、摘要卡、时钟卡），卡内自己的标题句承担卡名。
- 分区：`src/components/ui/section.tsx` 的 `Section`；小分区标题是 `text-sm font-medium` 加右侧 `label-mono` 来源。
- 数值块：上 `label-mono` 标签、下数值；同一网格里所有块同一套字号字重，单位用 `text-xs text-muted-foreground` 贴在数值后。
- 分段切换（如 Contact 卡的 Tokens / Commit）：外框 `border-line`，选中项 `bg-muted text-foreground`，未选 `text-muted-foreground`。
- 状态点：`src/components/ui/status-dot.tsx` 的 `StatusDot`，不手画圆点。
- 图片：静态图标走 `AppImage` 并设 `unoptimized`；图片交付与压缩规则见 `AGENTS.md`「图片交付」。
- 图标：
  - 品牌 / 产品图标先查 [LobeHub 图标集](https://lobehub.com/icons)。项目已装 `@lobehub/icons`，按深路径导入：单色 `@lobehub/icons/es/<名字>/components/Mono`（继承文字色）、彩色 `.../Color`、带字 `.../Text`；示例见 `src/components/live/vibecoding-card.tsx`。
  - LobeHub 没有的品牌再找官方 SVG：含 `fill="currentColor"` 的要内联为组件，通过 `<img>` 或 `AppImage` 加载时无法继承页面文字色；示例见 `src/components/live/agent-status-card.tsx` 的 `TypesafeIcon`。只有位图时，先压到展示所需尺寸再入库。
  - 界面图标用 `lucide-react`，与文字同色，尺寸跟随相邻文字（14px 文字配 `size-3.5`）。不用 emoji 当图标（数据里自带的 emoji 照原样）。
- 滚动区：
  - 站内滚动条默认隐藏：可滚动区域一律加 `scrollbar-none [&::-webkit-scrollbar]:hidden`（前者管 Firefox 的 `scrollbar-width`，后者管 Chromium 系，两句缺一不可）。现有示例：播放器队列。
  - 条目式滚动要吸附：容器加 `snap-y snap-mandatory`（横向用 `snap-x`，见奖杯组、在看瓷砖），子项加 `snap-start`，滚动停稳后永远是整行对齐。
  - 列表只渲染放得下的整行，不出现被裁掉一半的行或封面（做法见最近播放的容器查询）。
- 条形与进度条：
  - 一组横条是一个布局：标签、轨道、数值各占一列，列宽由父级 grid 定（`subgrid` 或固定列宽），每条轨道起止落在同一条线上，只有填充长度变；某一行的长标签或长数值把轨道挤短算布局错误。
  - 同组共用一个比例尺、从零起；单位和周期标在数值旁边。轨道不当分隔线或装饰用。
- 对话里的图示：无边框、透明底、跟随站点主题与字体，像正文的一部分；优先用站点原生组件，HTML 沙箱只兜底。

## Interaction

- 点击目标至少 24×24px；手机上的主要操作至少 44px 高。小图标按钮用内边距或伪元素扩大命中区，不放大图标。
- 每个可交互元素都有可见的 `:focus-visible` 样式；只有图标的按钮和链接带 `aria-label`。
- 悬停只做增强，所有操作都能点按完成；可点的卡片和行有悬停反馈（`surface-hover` 或硬阴影收短）。
- 状态改变等后端确认：点了按钮不立刻收起或隐藏控件，确认成功后再变，中途回来还能改选。
- 加载：首屏 SSR 就带最终数据；客户端补数据时给占位留好尺寸，不让布局跳。

## Motion

- 只动 `transform` 与 `opacity`；时长 120–300ms，进入用减速曲线、离开更短；主题切换的 view transition 例外，见 `globals.css`。
- 首屏到稳定只允许一次变化：水合对时、换锚点、换数据这类大跨度变化直接落位，不做补间；正常走时、换句才用动画。
- 已知没有的内容（如无歌词）首帧就画对应布局，不先画占位再收起。
- `prefers-reduced-motion` 由 `globals.css` 全局处理；新加的 view transition 伪元素要单独写进 reduced-motion 规则。
- 一屏里同时在动的东西不超过一两处；每个动画都对应一个真实变化。
- 循环动画只给正在发生的事：`live` 状态点的脉冲、播放中的均衡器、加载中的占位与转圈；不加装饰性的循环动画。

## Copy

- 界面文案一律英文：标注、正文、状态、按钮、提示、无障碍文案、错误页和元数据都用英文，`<html lang>` 为 `en`；日期用 en-US（`Jun 22`、`Mon 11:00 AM`），数字用 en-US 分组。
- 来自数据源的内容（歌名、游戏名、剧名、歌词、提交信息）照原样，不翻译。模型生成、按约定写成中文的展示内容（摘要卡的中文标语）按它自己的约定走。
- 站主的中文全名不出现在站点任何位置，显示为 `LYJW`。
- 仅开发环境可见的调试开关提示可以用中文。
- 文案短：图例是「数字 + 一到三个词」，不写长句；按钮用动词。

## Do's and Don'ts

| Do | Don't |
| --- | --- |
| 用 `Card`、`Section`、`StatusDot`、`label-mono` 这些现成部件 | 手写外框、阴影、圆点 |
| 间距、字号只取上面阶梯里的值 | `pl-4.5`、`gap-y-2.5`、`text-[10px]`、`-translate-y-[3px]` |
| 表头标签、正文、列表文字左边缘对齐同一条 inset 线 | 表头 12px、正文 20px 这种两条线 |
| 一张卡一个视觉重点，靠字号、字重、颜色分层 | 一行同字号同色的纯文字；满屏灰色说明小字 |
| 间距由父级 `gap` 设，别扭就改分组 | 子元素各带 `mt-*` 拼间距；给一处补一次性外边距 |
| 同组数值同字号，放不下先缩次要信息 | 给较长的那个数值单独缩字号 |
| 一组条形共用列宽和比例尺，直接标注 | 每行各自撑开的条形；用图例代替标注 |
| 层级靠字号、字重、分组和留白 | 徽章 / 胶囊装元数据；卡中套卡；加边框补救层级；彩色方块垫图标 |
| 彩色只用在够对比度的地方，字用 `foreground` | 浅色主题下用 `live` / `signal-orange` 写小字 |
| 同一行的卡等高，改前改后都量 | 换个部件把整行撑高或留白 |
| 浅色桌面 + 深色 375px 都看过 | 只看一种主题、一种宽度 |
| 中文标语用系统无衬线粗体 | 书法、手写、装饰字体 |

## 交付与合并

- UI 改动交付桌面（1280）与手机（375）截图，至少一张深色；什么时候附图见 `AGENTS.md`「项目入口与验证」与 `HUMAN.md`。改到同一行的卡片或替换部件时，报前后各卡高度与相邻同类文字的字号字重（验证怎么做见 `.claude/skills/lyjwpage-verify/SKILL.md`）。
- 自查用 `.claude/skills/lyjwpage-ui-design/SKILL.md`：它有对照本文件的检查清单和一个量间距、字号、点击区的浏览器脚本。
- 有 UI / UX 变化的改动进 main 前，先给站主看效果、等他点头再合；站主明确要求的小改动除外。
