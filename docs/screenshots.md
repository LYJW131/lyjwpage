# 页面效果图、GIF 与架构图产物

> 类型：runbook

根 README 里的效果图和架构图怎么录、怎么重出。改了对应的界面、夹具或 `docs/architecture.json` 后照本文重跑。

## 页面效果图

[`screenshots/`](./screenshots/) 是根 README 里的效果图，明暗各一份；静态的是 WebP，会动的是 GIF。数据来自场景 [`readme`](../workers/core/dev-fixtures/scenes/readme.json)：在生产快照 `readme-base` 上用夹具点亮平时不显示的卡片，`pnpm dev:scene readme` 一次注入全部端点，摘要的三格按同一份 Pulse 重算、标题池收成一句，SSR 与浏览器、明暗两轮读到的是同一份数据。场景的写法与 `--capture` 重新抓生产快照见 [`workers/core/README.md`](../workers/core/README.md#本地开发)。

静态图（总览、正在看、充电宝、PlayStation 奖杯展开、Pulse 悬停详情、LYJWPAGE）由 [`scripts/readme-shots.ts`](../scripts/readme-shots.ts) 一条命令截出：先注入场景，再用无头 Chromium 开 1280 宽、2 倍像素密度，`colorScheme` 切明暗；裁卡片按元素框外扩 12px，并把目标之外的兄弟节点 `visibility: hidden`，边距里才不会露出邻居卡片的边；Pulse 悬停在听歌道上，把浮层和卡片的框取并集再裁（上一张卡同样藏起，浮层画在卡片上方，缝里会露出它的下边和硬阴影）；PNG 用项目自带的 sharp 转 WebP（q 88），写进 `docs/screenshots/`。截完场景留在本地 Worker 里供对照，看完 `pnpm dev:scene --reset`：

```sh
pnpm readme:shots                                   # 全部静态图，明暗各一张
pnpm readme:shots --only pulse-detail --theme dark  # 单张；--out 改输出目录，--scene 换场景
```

3211 / 8788 被别的实例占着时，用 `.claude/launch.json` 里的 `api-worker-alt`（8790）和 `lyjwpage-local-alt`（3213）另起一套：`dev:worker` / `dev:local` / `dev` / `start` 认 `DEV_WORKER_PORT` / `DEV_SITE_PORT`（如 `DEV_SITE_PORT=3213 pnpm dev`），`pnpm dev:override`、`pnpm dev:scene` 和截图脚本分别用 `DEV_WORKER_URL` / `SITE_URL` 指过去。

歌词不入库：本地 Worker 没有 Apple Music 凭据，场景里 `/api/lyrics?song=<songId>` 写成 `{ "fetch": "https://lyjw.me/api/lyrics?song=<songId>" }`，注入时现取生产站的响应（`songId` 取 `listening-now-*.json` 里的）。

五张会动的卡片（正在听、充电头、活动、落地节点、AI Coding）由 [`scripts/card-gifs.py`](../scripts/card-gifs.py) 录制：把卡片滚到视口、藏起邻居，在真实时间里连续截图，画面一变留一帧，帧时长按真实经过的毫秒记（motion 把不少动画交给 Web Animations API，假时钟拨不动，所以不用假时钟）。正在听录的是歌词从一句收尾到「二人だけの空が広がる夜に」整句扫完，靠注入 `positionMs` 改过的变体把播放位置拨到句前，录前清掉充电头和充电宝——它们在场时这张卡只占右边一列；其余四张靠换夹具驱动——从夹具派生只改几个读数的临时变体逐份注入，借 SWR 的 `revalidateOnFocus` 让卡片回源（对 focus 节流 5 秒），换夹具的等待不进时间线。充电头的历史点在派生变体时冻成绝对时间（`$now-…` 每次注入都按新的当下重算，曲线会整条平移），录的时候先清掉充电宝——它在场时充电头是紧凑布局、没有曲线。AI Coding 的基线直接取本地 Worker 此刻的 `/api/status/coding`（生产数据经上游补缺；也可以先注入 `coding-multi-source.json`），再派生读数涨一档的变体。总览、Emby 正在播放、充电宝、PlayStation、Pulse 仍是静态图：总览本来就是全貌，其余几张要么几秒内没什么在动，要么静态一张已经说清。跑之前先 `pnpm dev:scene readme` 注入基线，跑法和下面的 GIF 脚本一样：

```sh
python3 scripts/card-gifs.py                      # 全部场景，明暗各一张
python3 scripts/card-gifs.py --scene charger --theme dark
```

页头品牌标识那条是 GIF（`desktop-marks-{light,dark}.gif`），由 [`scripts/desktop-marks-gif.py`](../scripts/desktop-marks-gif.py) 生成：四段标识（Claude Code、Ghostty、Cursor、Antigravity）都从本地站点页头真实截下再拼成一条，四段都会动。Claude Code 和 Ghostty 两段装上 Playwright 的假时钟逐帧推进，帧时长取 `src/lib/mascot-fetch.json` 与 `src/lib/ghostty-frames.json` 的节拍；Cursor 和 Antigravity 两段演示窗口标题的出现、变化和消失，按脚本里 `TITLE_SCRIPTS` 的剧本从夹具派生只改 `windowTitle` 的临时变体逐个注入，用真实时钟截（标题的淡入淡出交给 motion 的 Web Animations API，假时钟拨不动它）。GIF 一轮等于 Ghostty 一轮，标题剧本首尾都没有标题，循环回到起点才接得上。各段时间线怎么拼、节拍怎么取，见脚本开头的说明。需要 Python 3、`playwright`、`pillow`（`pip install playwright pillow && playwright install chromium`；装了 Google Chrome 可设 `PLAYWRIGHT_CHANNEL=chrome` 免下载），本地 Worker 与 `pnpm dev:local` 在跑（不在默认端口时用 `SITE_URL` / `DEV_WORKER_URL` 指过去）：

```sh
python3 scripts/desktop-marks-gif.py            # 明暗各一张
python3 scripts/desktop-marks-gif.py --theme dark
```

标识改了外观、`mascot-fetch.json` 或 `ghostty-frames.json` 换了帧或节拍、标题那行改了样式或过渡时重跑一次即可；脚本自己开关假数据总开关、注入 `desktop-*` 夹具并在结束后清掉注入（细节见脚本开头）。

## 实时卡片

README 里落地节点、AI Coding、Pulse、站点自身四张不是截图，是站点路由 `/cards/<卡>.svg`（[`src/app/cards/route.tsx`](../src/app/cards/route.tsx)）现渲染的 SVG，`?theme=dark` 出暗色，README 用 `<picture>` 按系统明暗二选一。`pnpm readme:shots` 与 `scripts/card-gifs.py` 仍会产出这四张的静态图，README 不再引用。

- site Worker 用首页同一个卡片组件 SSR，配上只扫卡片相关目录生成的 Tailwind 样式（[`src/app/cards/readme-cards.css`](../src/app/cards/readme-cards.css)），放进 `<foreignObject>`。
- GitHub 经 camo 把它当 `<img>` 显示，图片里不跑脚本、不取外部资源：卡内图片内嵌成 data URI；camo 的 CSP 拦字体，卡片用系统等宽字体，不内嵌 Geist Mono，NumberFlow 只留纯文本读数；按 `useMountedAt` 算的内容（限额配速线、重置倒计时）经 `RenderClock` 取出图时刻烧进图里，绝对时刻按站点时区写，图片缓存期内不再走。
- 卡宽固定为首页桌面内容宽；图片里的媒体查询按显示宽度算，路由把宽度断点按卡宽定死，缩小显示也保持桌面布局。卡高写在路由的 `CARDS` 里，按首页 1280 宽实测；卡片行数变了要重量，否则底部被裁或留白。
- 实时数据为空时用 `workers/core/dev-fixtures/` 的夹具补，卡头标 Sample data。缓存头与 core 的 `/api/cards/*.svg` 同档。
- 本地看效果要用生产构建：`pnpm build && pnpm start` 后开 `http://localhost:3211/cards/pulse.svg?theme=dark`。`pnpm dev` 里 NumberFlow 输出空壳，读数是空的。

## 交互式架构图

- 网页在线交互版：[https://lyjw131.github.io/lyjwpage/](https://lyjw131.github.io/lyjwpage/)
- 原始架构定义：[`architecture.json`](./architecture.json) 与 [`architecture.receipt.json`](./architecture.receipt.json)
- 离线渲染快照：[`architecture-dark.png`](./architecture-dark.png) / [`architecture-light.png`](./architecture-light.png)

改图只改 `architecture.json`，其余产物由 [`scripts/architecture-diagram.mjs`](../scripts/architecture-diagram.mjs) 生成。工具版本与官方提交锁定在 [`scripts/archify.lock.json`](../scripts/archify.lock.json)，不依赖或升级全局技能：

```sh
pnpm docs:architecture -- --setup       # 安装到仓库内忽略的 .archify/toolchain
pnpm docs:architecture                  # 完整生成与检查
pnpm docs:architecture -- --validate    # 仅作布局失败的定向诊断
pnpm docs:architecture -- --skip-visual # 省略额外截图，仍运行 browser-check 和明暗 PNG 导出
```

也可用 `ARCHIFY_DIR` 指向已有安装的 `archify/` 包目录；脚本强制核对锁文件中的版本，完整源码提交与干净工作树核对只适用于隔离安装。需要本机 Chrome / Chromium，可用 `ARCHIFY_CHROME` 指定可执行文件。浏览器默认保留沙箱；只有 root 或显式 `ARCHIFY_CHROME_NO_SANDBOX=1` 才禁用，后者仅用于可信、隔离且无法提供浏览器沙箱的执行环境。

完整生成先运行 `finalize`，依次完成 showcase 校验、交付、严格溯源检查和真实浏览器检查，任一退出非零就停止。再由查看器自带 PNG 导出生成明暗快照，用渲染后的 SVG `viewBox` 确定 2x 尺寸，不要求候选 JSON 固定画布。默认额外运行严格溯源的 `visual-check` 并保留截图；每次的原始检查回执与截图使用独立 `.archify/evidence/` 目录，不删除旧证据。HTML 旁的 `architecture.delivery.json` 是严格溯源所需交付元数据。

`architecture.receipt.json` 记录当前规格、HTML、PNG 的哈希及完整浏览器检查回执。`--skip-visual` 只把额外截图标为未请求，不复用上一份视口或人工审阅结论。自动检查通过不等于视觉审阅通过：打开当前 HTML 和明暗 PNG，检查节点、线路、标签与导出边界后，再按实际结果更新 `visual_review`、`static_diagram_review` 和 `correction_rounds`；若改了候选，完整重跑。仅在确实检查后填写 `passed`。

架构输入、生成脚本或锁文件变更的 PR 会触发 [Architecture diagram 检查](../.github/workflows/architecture-diagram.yml)：在 CI 安装隔离工具链、完整生成并上传 HTML、明暗 PNG 与原始证据。任务失败也上传已有文件和日志，必须结合任务退出状态、当前规格与产物哈希判断，不把旧产物当作新生成结果。工作流只读仓库，不提交或部署。
