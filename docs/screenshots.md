# 页面效果图、GIF 与架构图产物

> 类型：runbook

根 README 里的效果图和架构图怎么录、怎么重出。改了对应的界面、夹具或 `docs/architecture.json` 后照本文重跑。

## 页面效果图

[`screenshots/`](./screenshots/) 是根 README 里的效果图，明暗各一份；静态的是 WebP，会动的是 GIF。用本地 Worker 的假数据注入把平时不显示的状态点亮后截的，夹具在 [`workers/api/dev-fixtures/`](../workers/api/dev-fixtures/)，注入方式见 [`workers/api/README.md`](../workers/api/README.md)。截图用无头 Chrome（playwright-core 的 `channel: "chrome"`）开 1280 宽、2 倍像素密度，`colorScheme` 切明暗；裁卡片按元素 boundingBox 外扩 12px 取 `clip`，并把目标之外的兄弟节点 `visibility: hidden`，边距里才不会露出邻居卡片的边；PNG 用项目自带的 sharp 转 WebP（q 88）。

Pulse 的时段详情需要额外动作：用鼠标停在泳道上，把 `[role="tooltip"]`（body 上的浮层）和卡片的 boundingBox 取并集再裁，并顺手把上一张卡 `visibility: hidden`——浮层画在卡片上方，那 12px 的缝里会露出它的下边和硬阴影。

3211 / 8788 被别的实例占着时，用 `.claude/launch.json` 里的 `api-worker-alt`（8790）和 `lyjwpage-local-alt`（3213）另起一套：`dev:worker` / `dev:local` 认 `DEV_WORKER_PORT` / `DEV_SITE_PORT`，`next.config.ts` 认 `NEXT_DIST_DIR`（`next dev` 按 `<distDir>/dev/lock` 保证同目录单实例，第二套要指到 `.next/alt`），`pnpm dev:override` 和截图脚本分别用 `DEV_WORKER_URL` / `SITE_URL` 指过去。

歌词不入库：本地 Worker 没有 Apple Music 凭据，`/api/lyrics` 也不走上游兜底，所以截「正在听」时把生产站的响应包一层 `ok` 直接注入（`song` 取 `listening-now-*.json` 里的 `songId`）：

```sh
curl -s 'https://api.homepage.lyjw.llc/api/lyrics?song=1490256995' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify({ok:true,...JSON.parse(s)})))' \
  > /tmp/lyrics-override.json
pnpm dev:override /api/lyrics /tmp/lyrics-override.json
```

五张会动的卡片（正在听、充电头、活动、落地节点、AI Coding）由 [`scripts/card-gifs.py`](../scripts/card-gifs.py) 录制：把卡片滚到视口、藏起邻居，在真实时间里连续截图，画面一变留一帧，帧时长按真实经过的毫秒记（motion 把不少动画交给 Web Animations API，假时钟拨不动，所以不用假时钟）。正在听录的是歌词从一句收尾到「二人だけの空が広がる夜に」整句扫完，靠注入 `positionMs` 改过的变体把播放位置拨到句前，录前清掉充电头和充电宝——它们在场时这张卡只占右边一列；其余四张靠换夹具驱动——从夹具派生只改几个读数的临时变体逐份注入，借 SWR 的 `revalidateOnFocus` 让卡片回源（对 focus 节流 5 秒），换夹具的等待不进时间线。充电头的历史点在派生变体时冻成绝对时间（`$now-…` 每次注入都按新的当下重算，曲线会整条平移），录的时候先清掉充电宝——它在场时充电头是紧凑布局、没有曲线。AI Coding 没有夹具，基线直接取本地 Worker 此刻的响应（生产数据经上游补缺），再派生读数涨一档的变体。总览、Emby 正在播放、充电宝、PlayStation、Pulse 仍是静态图：总览本来就是全貌，其余几张要么几秒内没什么在动，要么静态一张已经说清。跑之前先按脚本开头列的清单注入基线夹具，跑法和下面的 GIF 脚本一样：

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

## 交互式架构图

- 网页在线交互版：[https://lyjw131.github.io/lyjwpage/](https://lyjw131.github.io/lyjwpage/)
- 原始架构定义：[`architecture.json`](./architecture.json) 与 [`architecture.receipt.json`](./architecture.receipt.json)
- 离线渲染快照：[`architecture-dark.png`](./architecture-dark.png) / [`architecture-light.png`](./architecture-light.png)

改图只改 `architecture.json`，其余产物由 [`scripts/architecture-diagram.mjs`](../scripts/architecture-diagram.mjs) 一次出齐：`pnpm docs:architecture -- --validate` 反复校验布局（showcase 九项检查），通过后 `pnpm docs:architecture` 渲染 HTML、驱动无头 Chrome 用查看器自带的 PNG 导出重出明暗快照并缩到 2x、跑四个桌面视口的溢出检查、写 `architecture.receipt.json`。依赖本机的 archify 技能（默认 `~/.claude/skills/archify`，可用 `ARCHIFY_DIR` 覆盖）和 Chrome；跑完看一眼 PNG，把 receipt 里两处 `pending` 改成 `passed`。
