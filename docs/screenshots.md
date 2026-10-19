# 页面效果图、GIF 与 README 图示

> 类型：runbook

根 README 里的效果图和图示怎么录、怎么重出。改了对应的界面、夹具、架构或流程后照本文重跑。

## 页面效果图

[`screenshots/`](./screenshots/) 是根 README 里的首页总览图与聊天卡，明暗各一份；页头品牌标识动画在 `public/readme/`（见下文），其余卡片不截图，见下文「实时卡片」。总览图的数据来自场景 [`readme`](../workers/core/dev-fixtures/scenes/readme.json)：在生产快照 `readme-base` 上用夹具点亮平时不显示的卡片，`pnpm dev:scene readme` 一次注入全部端点，摘要的三格按同一份 Pulse 重算、标题池收成一句，SSR 与浏览器、明暗两轮读到的是同一份数据。场景的写法与 `--capture` 重新抓生产快照见 [`workers/core/README.md`](../workers/core/README.md#本地开发)。

总览图由 [`scripts/readme-shots.ts`](../scripts/readme-shots.ts) 一条命令截出：先注入场景，再用无头 Chromium 开 1280 宽、2 倍像素密度截整页，`colorScheme` 切明暗；PNG 用项目自带的 sharp 转 WebP（q 88），写进 `docs/screenshots/`。截完场景留在本地 Worker 里供对照，看完 `pnpm dev:scene --reset`：

```sh
pnpm readme:shots                 # 明暗各一张
pnpm readme:shots --theme dark    # 只出暗色；--out 改输出目录，--scene 换场景
```

3211 / 8788 被别的实例占着时，用 `.claude/launch.json` 里的 `api-worker-alt`（8790）和 `lyjwpage-local-alt`（3213）另起一套：`dev:worker` / `dev:local` / `dev` / `start` 认 `DEV_WORKER_PORT` / `DEV_SITE_PORT`（如 `DEV_SITE_PORT=3213 pnpm dev`），`pnpm dev:override`、`pnpm dev:scene` 和截图脚本分别用 `DEV_WORKER_URL` / `SITE_URL` 指过去。

歌词不入库：本地 Worker 没有 Apple Music 凭据，场景里 `/api/lyrics?song=<songId>` 写成 `{ "fetch": "https://lyjw.me/api/lyrics?song=<songId>" }`，注入时现取生产站的响应（`songId` 取 `listening-now-*.json` 里的）。

页头品牌标识那条是 SVG 动画（[`public/readme/desktop-marks-{light,dark}.svg`](../public/readme/)），由 [`scripts/desktop-marks-svg.py`](../scripts/desktop-marks-svg.py) 生成：四段标识（Claude Code、Ghostty、Cursor、Antigravity）都从本地站点页头真实截下再拼成一条，四段都会动。Claude Code 和 Ghostty 两段装上 Playwright 的假时钟逐帧推进，帧时长取 `src/lib/mascot-fetch.json` 与 `src/lib/ghostty-frames.json` 的节拍；Cursor 和 Antigravity 两段演示窗口标题的出现、变化和消失，按脚本里 `TITLE_SCRIPTS` 的剧本从夹具派生只改 `windowTitle` 的临时变体逐个注入，用真实时钟截（标题的淡入淡出交给 motion 的 Web Animations API，假时钟拨不动它）。一轮等于 Ghostty 一轮，标题剧本首尾都没有标题，循环回到起点才接得上。SVG 里四段各走各的时间线：每段去重后的帧内联成 WebP / PNG 的 `data:` 图（垫底一张常驻，其余只留与它不同的那块），CSS `@keyframes` 以 `step-end` 切换不透明度，没有脚本、不引外部资源，`<img>` 里照常播放；宽高取 CSS 像素，内联的是 2 倍截图，高分屏不糊。各段时间线怎么拼、节拍怎么取，见脚本开头的说明。

它放在 `public/` 而不是 `docs/screenshots/`，README 里用 `https://lyjw.me/readme/…` 的绝对地址引用：仓库相对路径的图由 `raw.githubusercontent.com` 出，响应头的 CSP 是 `default-src 'none'; style-src 'unsafe-inline'; sandbox`，不放行 SVG 里内联的 `data:` 图；绝对地址走 GitHub 的图片代理 camo，它的 CSP 带 `img-src data:`。`public/` 随站点部署，`/readme/*` 的缓存头在 `public/_headers`。

重出需要 Python 3、`playwright`、`pillow`（`pip install playwright pillow && playwright install chromium`；装了 Google Chrome 可设 `PLAYWRIGHT_CHANNEL=chrome` 免下载），本地 Worker 与 `pnpm dev:local` 在跑（不在默认端口时用 `SITE_URL` / `DEV_WORKER_URL` 指过去）：

```sh
python3 scripts/desktop-marks-svg.py            # 明暗各一张
python3 scripts/desktop-marks-svg.py --theme dark
```

标识改了外观、`mascot-fetch.json` 或 `ghostty-frames.json` 换了帧或节拍、标题那行改了样式或过渡时重跑一次即可；脚本自己开关假数据总开关、注入 `desktop-*` 夹具并在结束后清掉注入（细节见脚本开头）。

## 实时卡片

README 里总览之后的卡都不是截图，是站点路由 `/cards/<卡>.svg`（[`src/app/cards/route.tsx`](../src/app/cards/route.tsx) 的 `CARDS`）现渲染的 SVG，`?theme=dark` 出暗色，README 用 `<picture>` 按系统明暗二选一。

- site Worker 用首页同一个卡片组件 SSR，配上只扫卡片相关目录生成的 Tailwind 样式（[`src/app/cards/readme-cards.css`](../src/app/cards/readme-cards.css)），放进 `<foreignObject>`。WebKit（iOS 的 GitHub App 与 Safari）把缩小显示的 foreignObject 按原尺寸画再裁掉，路由把这张 SVG 再作为 `<image>` 的 data URI 套一层（`scalableSvg`），缩放只落在外层；套在里面的图异步解码或懒加载时 WebKit 解完不重画，卡内 `<img>` 一律 `decoding="sync"`。
- GitHub 经 camo 把它当 `<img>` 显示，图片里不跑脚本、不取外部资源：卡内图片按显示宽度取 2 倍后内嵌成 data URI；camo 的 CSP 拦字体，卡片用系统等宽字体，不内嵌 Geist Mono，NumberFlow 只留纯文本读数，歌词逐字扫过、读数滚动这类靠脚本的动效不动；按 `useMountedAt` 算的内容（限额配速线、重置倒计时）经 `RenderClock` 取出图时刻烧进图里，绝对时刻按站点时区写，图片缓存期内不再走。
- 卡宽按首页 1280 宽下的整卡或半卡定死；充电头与充电宝在 README 里并排（`pair`），各占一半、中间不留空格，图宽取整卡一半，卡间距补在左卡右侧和右卡左侧，右缘与整卡对齐；图片里的媒体查询按显示宽度算，路由把宽度断点按首页内容宽定死，缩小显示也保持桌面布局。卡高写在路由的 `CARDS` 里，按首页 1280 宽实测；卡片行数变了要重量，否则底部被裁或留白。
- 状态卡此刻没在发生（正在看、勿扰、Quest 正在玩、充电头、充电宝、正在听）或数据取不到（落地节点）时用 `workers/core/dev-fixtures/` 的夹具补，卡头标题后标 Sample data（没有卡头的每日摘要标在右上角，勿扰卡接在模式名后）；用实时数据的标抓取时间（站点时区），每日摘要的表盘本身就是时间，不另标。缓存头与 core 的 `/api/cards/*.svg` 同档。 camo 按完整 URL 缓存，旧图在 stale-while-revalidate 期内还会发出去；出图格式改了要让手机上立刻看到新图，就把 README 里卡片地址的 `v=` 加一。
- PlayStation 卡展开最近一个奖杯所在的游戏（同首页点「Latest」）：路由先渲一遍找出展开的那格，取它的奖杯目录作 SWR 兜底再渲，展开面板的高度在样式里放开。
- 聊天卡不随时间变，`render` 返回 `still`、不标时间。外层套的 data URI 图被 `raw.githubusercontent.com` 的 CSP 拦下，所以聊天卡也走站点路由，不存仓库副本。
- 本地看效果要用生产构建：`pnpm build && pnpm start` 后开 `http://localhost:3211/cards/pulse.svg?theme=dark`。`pnpm dev` 里 NumberFlow 输出空壳，读数是空的。

## README 图示

根 README 的系统架构图和开发工作流图是 [`scripts/readme-diagrams.ts`](../scripts/readme-diagrams.ts) 按坐标画的 SVG，中英文各一套、明暗各一张，写进 [`diagrams/`](./diagrams/)：

```sh
pnpm docs:diagrams
```

- 改图只改 `scripts/readme-diagrams/architecture.ts#architecture` 与 `scripts/readme-diagrams/workflow.ts#workflow` 两个函数：卡片、连线、注记按 24px 方格摆，坐标写死，不做自动布局。架构或流程变了（新 Worker、绑定、上报来源、定时任务、合并门槛）就同步改图；图只画主干，细节留在各自的 README。
- 颜色每次从 [`src/app/styles/theme.css`](../src/app/styles/theme.css) 的 `:root` 与 `.dark` 读，与首页同一套 token；字体照首页写等宽字体栈，图片里不加载网络字体，没装 Geist Mono 的机器落到系统等宽字体。
- 脚本按等宽字宽（拉丁字符 0.6em、中日韩字符 1em）估算每段文字，放不下就报错退出，中英两套都要放得下。
- 不用 `foreignObject`（WebKit 缩小显示时会裁掉），README 用 `<picture>` 按 `prefers-color-scheme` 选明暗。
- 图没有底色：卡片自带填色，连线和注记直接落在 GitHub 的页面底色上；注记压线的地方用 `mask` 给线留缺口，不画遮挡色块。
- CI 的 docs 门禁跑 `pnpm docs:diagrams --check`：改了脚本或颜色 token 却没重出图，提交的图与脚本输出对不上就报红。

