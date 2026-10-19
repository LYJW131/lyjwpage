# 页面效果图、GIF 与架构图产物

> 类型：runbook

根 README 里的效果图和架构图怎么录、怎么重出。改了对应的界面、夹具或 `docs/architecture.json` 后照本文重跑。

## 页面效果图

[`screenshots/`](./screenshots/) 是根 README 里的首页总览图与页头品牌标识动画，明暗各一份；各卡片不截图，见下文「实时卡片」。总览图的数据来自场景 [`readme`](../workers/core/dev-fixtures/scenes/readme.json)：在生产快照 `readme-base` 上用夹具点亮平时不显示的卡片，`pnpm dev:scene readme` 一次注入全部端点，摘要的三格按同一份 Pulse 重算、标题池收成一句，SSR 与浏览器、明暗两轮读到的是同一份数据。场景的写法与 `--capture` 重新抓生产快照见 [`workers/core/README.md`](../workers/core/README.md#本地开发)。

总览图由 [`scripts/readme-shots.ts`](../scripts/readme-shots.ts) 一条命令截出：先注入场景，再用无头 Chromium 开 1280 宽、2 倍像素密度截整页，`colorScheme` 切明暗；PNG 用项目自带的 sharp 转 WebP（q 88），写进 `docs/screenshots/`。截完场景留在本地 Worker 里供对照，看完 `pnpm dev:scene --reset`：

```sh
pnpm readme:shots                 # 明暗各一张
pnpm readme:shots --theme dark    # 只出暗色；--out 改输出目录，--scene 换场景
```

3211 / 8788 被别的实例占着时，用 `.claude/launch.json` 里的 `api-worker-alt`（8790）和 `lyjwpage-local-alt`（3213）另起一套：`dev:worker` / `dev:local` / `dev` / `start` 认 `DEV_WORKER_PORT` / `DEV_SITE_PORT`（如 `DEV_SITE_PORT=3213 pnpm dev`），`pnpm dev:override`、`pnpm dev:scene` 和截图脚本分别用 `DEV_WORKER_URL` / `SITE_URL` 指过去。

歌词不入库：本地 Worker 没有 Apple Music 凭据，场景里 `/api/lyrics?song=<songId>` 写成 `{ "fetch": "https://lyjw.me/api/lyrics?song=<songId>" }`，注入时现取生产站的响应（`songId` 取 `listening-now-*.json` 里的）。

页头品牌标识那条是 GIF（`desktop-marks-{light,dark}.gif`），由 [`scripts/desktop-marks-gif.py`](../scripts/desktop-marks-gif.py) 生成：四段标识（Claude Code、Ghostty、Cursor、Antigravity）都从本地站点页头真实截下再拼成一条，四段都会动。Claude Code 和 Ghostty 两段装上 Playwright 的假时钟逐帧推进，帧时长取 `src/lib/mascot-fetch.json` 与 `src/lib/ghostty-frames.json` 的节拍；Cursor 和 Antigravity 两段演示窗口标题的出现、变化和消失，按脚本里 `TITLE_SCRIPTS` 的剧本从夹具派生只改 `windowTitle` 的临时变体逐个注入，用真实时钟截（标题的淡入淡出交给 motion 的 Web Animations API，假时钟拨不动它）。GIF 一轮等于 Ghostty 一轮，标题剧本首尾都没有标题，循环回到起点才接得上。各段时间线怎么拼、节拍怎么取，见脚本开头的说明。需要 Python 3、`playwright`、`pillow`（`pip install playwright pillow && playwright install chromium`；装了 Google Chrome 可设 `PLAYWRIGHT_CHANNEL=chrome` 免下载），本地 Worker 与 `pnpm dev:local` 在跑（不在默认端口时用 `SITE_URL` / `DEV_WORKER_URL` 指过去）：

```sh
python3 scripts/desktop-marks-gif.py            # 明暗各一张
python3 scripts/desktop-marks-gif.py --theme dark
```

标识改了外观、`mascot-fetch.json` 或 `ghostty-frames.json` 换了帧或节拍、标题那行改了样式或过渡时重跑一次即可；脚本自己开关假数据总开关、注入 `desktop-*` 夹具并在结束后清掉注入（细节见脚本开头）。

## 实时卡片

README 里总览之后的每张卡都不是截图，是站点路由 `/cards/<卡>.svg`（[`src/app/cards/route.tsx`](../src/app/cards/route.tsx) 的 `CARDS`）现渲染的 SVG，`?theme=dark` 出暗色，README 用 `<picture>` 按系统明暗二选一。

- site Worker 用首页同一个卡片组件 SSR，配上只扫卡片相关目录生成的 Tailwind 样式（[`src/app/cards/readme-cards.css`](../src/app/cards/readme-cards.css)），放进 `<foreignObject>`。
- GitHub 经 camo 把它当 `<img>` 显示，图片里不跑脚本、不取外部资源：卡内图片按显示宽度取 2 倍后内嵌成 data URI；camo 的 CSP 拦字体，卡片用系统等宽字体，不内嵌 Geist Mono，NumberFlow 只留纯文本读数，歌词逐字扫过、读数滚动这类靠脚本的动效不动；按 `useMountedAt` 算的内容（限额配速线、重置倒计时）经 `RenderClock` 取出图时刻烧进图里，绝对时刻按站点时区写，图片缓存期内不再走。
- 卡宽按首页 1280 宽下的整卡或半卡定死；图片里的媒体查询按显示宽度算，路由把宽度断点按首页内容宽定死，缩小显示也保持桌面布局。卡高写在路由的 `CARDS` 里，按首页 1280 宽实测；卡片行数变了要重量，否则底部被裁或留白。
- 状态卡此刻没在发生（正在看、充电头、充电宝、正在听）或数据取不到（落地节点）时用 `workers/core/dev-fixtures/` 的夹具补，卡头标题后标 Sample data；用实时数据的标抓取时间（站点时区）。没有卡头的每日摘要标在右上角。缓存头与 core 的 `/api/cards/*.svg` 同档。
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
