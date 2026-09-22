# 项目文档与技术架构导览 (Documentation)

本目录归档 `lyjwpage` 的系统架构设计、数据后端存储、实时遥测子系统协议规范及自动化部署运维指南。

---

## 核心文档索引

| 文档 | 简介 | 核心关注点 |
| --- | --- | --- |
| [**遥测与实时状态子系统指南**](./telemetry-subsystems.md) | 全站实时状态模块接入规范与架构 | Emby、Apple Music (MusicKit/歌词)、Anker BLE 充电监测、Vibe Coding 用量与热力图、Mac/iPhone 遥测中心、HomePod mini、三档自适应调频 |
| [**Worker 数据后端与首屏缓存**](./state-storage.md) | Cloudflare Workers 数据流与 Next.js 缓存 | Durable Objects SQLite 持久化、统一信封、`home-snapshot` 首屏缓存、`'use cache'` 标签失效、ESA 边缘回源策略、数据迁移验证 |
| [**KV 公开读取投影**](./kv-read-model.md) | 可选 KV 投影层，DO SQLite 仍是唯一权威 | 六条慢端点、登记表约束、300/600 秒策略、`readModelPathsForSource`、请求边界与回滚 |
| [**Workers 原生 Git 部署**](./workers-builds.md) | Cloudflare Workers Builds CI/CD 机制 | 三个独立 Worker 的原生构建配置、Monorepo 监视路径规则、依赖锁定与发布验收 |
| [**生产上报端点核验记录**](./reporter-endpoints.md) | 生产实例上报健康度核验与配置备份 | 各上报端点（Mac、NAS、Home Assistant、云端节点等）验证记录、备份路径与回滚说明 |

---

## 交互式架构图

- 网页在线交互版：[https://lyjw131.github.io/lyjwpage/](https://lyjw131.github.io/lyjwpage/)
- 原始架构定义：[`architecture.json`](./architecture.json) 与 [`architecture.receipt.json`](./architecture.receipt.json)
- 离线渲染快照：[`architecture-dark.png`](./architecture-dark.png) / [`architecture-light.png`](./architecture-light.png)

改图只改 `architecture.json`，其余产物由 [`scripts/architecture-diagram.mjs`](../scripts/architecture-diagram.mjs) 一次出齐：`pnpm docs:architecture -- --validate` 反复校验布局（showcase 九项检查），通过后 `pnpm docs:architecture` 渲染 HTML、驱动无头 Chrome 用查看器自带的 PNG 导出重出明暗快照并缩到 2x、跑四个桌面视口的溢出检查、写 `architecture.receipt.json`。依赖本机的 archify 技能（默认 `~/.claude/skills/archify`，可用 `ARCHIFY_DIR` 覆盖）和 Chrome；跑完看一眼 PNG，把 receipt 里两处 `pending` 改成 `passed`。

## 页面效果图

[`screenshots/`](./screenshots/) 是根 README 里的效果图，明暗各一份。用本地 Worker 的假数据注入把平时不显示的状态点亮后截的，夹具在 [`workers/api/dev-fixtures/`](../workers/api/dev-fixtures/)，注入方式见 [`workers/api/README.md`](../workers/api/README.md)。截图用无头 Chrome（playwright-core 的 `channel: "chrome"`）开 1280 宽、2 倍像素密度，`colorScheme` 切明暗；裁卡片按元素 boundingBox 外扩 12px 取 `clip`，并把目标之外的兄弟节点 `visibility: hidden`，边距里才不会露出邻居卡片的边；PNG 用项目自带的 sharp 转 WebP（q 88）。

两张需要额外动作：页头那行窗口标题要先注入带 `windowTitle` 的 desktop 夹具（如 `desktop-cursor.json`）；Pulse 的时段详情要用鼠标停在泳道上，把 `[role="tooltip"]`（body 上的浮层）和卡片的 boundingBox 取并集再裁，并顺手把上一张卡 `visibility: hidden`——浮层画在卡片上方，那 12px 的缝里会露出它的下边和硬阴影。

3211 / 8788 被别的实例占着时，用 `.claude/launch.json` 里的 `api-worker-alt`（8790）和 `lyjwpage-local-alt`（3213）另起一套：`dev:worker` / `dev:local` 认 `DEV_WORKER_PORT` / `DEV_SITE_PORT`，`next.config.ts` 认 `NEXT_DIST_DIR`（`next dev` 按 `<distDir>/dev/lock` 保证同目录单实例，第二套要指到 `.next/alt`），`pnpm dev:override` 和截图脚本分别用 `DEV_WORKER_URL` / `SITE_URL` 指过去。

歌词不入库：本地 Worker 没有 Apple Music 凭据，`/api/lyrics` 也不走上游兜底，所以截「正在听」时把生产站的响应包一层 `ok` 直接注入（`song` 取 `listening-now-*.json` 里的 `songId`）：

```sh
curl -s 'https://api.homepage.lyjw.llc/api/lyrics?song=1490256995' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify({ok:true,...JSON.parse(s)})))' \
  > /tmp/lyrics-override.json
pnpm dev:override /api/lyrics /tmp/lyrics-override.json
```

页头品牌标识那条是 GIF（`desktop-marks-{light,dark}.gif`），由 [`scripts/desktop-marks-gif.py`](../scripts/desktop-marks-gif.py) 生成：四段标识都从本地站点页头真实截下再拼成一条，两段会动的都装上 Playwright 的假时钟推进、逐帧截图。Claude Code 那段逐 25ms 推进，精灵 SVG 一变就截一帧，抓到完整一轮 33 个取物姿势，帧时长直接取 `src/lib/mascot-fetch.json` 的原始毫秒数；Ghostty 那段按 SVG 的 `data-frame` 拨到第 0 帧起逐帧截满一轮，帧时长取 `src/lib/ghostty-frames.json` 的 `frameMs`。GIF 一轮等于 Ghostty 一轮（79 × 93 ms ≈ 7.3 秒），Claude Code 跑完约 3.1 秒的取物后停在首姿势等到轮尾（站点上停 5 秒，这里约 4.3 秒）；两条时间线上任一段换帧就出一张 GIF 帧。需要 Python 3、`playwright`、`pillow`（`pip install playwright pillow && playwright install chromium`；装了 Google Chrome 可设 `PLAYWRIGHT_CHANNEL=chrome` 免下载），本地 Worker 与 `pnpm dev:local` 在跑（不在默认端口时用 `SITE_URL` / `DEV_WORKER_URL` 指过去）：

```sh
python3 scripts/desktop-marks-gif.py            # 明暗各一张
python3 scripts/desktop-marks-gif.py --theme dark
```

脚本自己打开假数据总开关、依次注入 `desktop-claude-code / ghostty / cursor / antigravity` 四个夹具，结束后清掉注入并把总开关恢复原状。标识改了外观、`mascot-fetch.json` 或 `ghostty-frames.json` 换了帧或节拍时重跑一次即可。
