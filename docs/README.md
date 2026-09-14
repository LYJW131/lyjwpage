# 项目文档与技术架构导览 (Documentation)

本目录归档 `lyjwpage` 的系统架构设计、数据后端存储、实时遥测子系统协议规范及自动化部署运维指南。

---

## 核心文档索引

| 文档 | 简介 | 核心关注点 |
| --- | --- | --- |
| [**遥测与实时状态子系统指南**](./telemetry-subsystems.md) | 全站实时状态模块接入规范与架构 | Emby、Apple Music (MusicKit/歌词)、Anker BLE 充电监测、Vibe Coding 用量与热力图、Mac/iPhone 遥测中心、HomePod mini、三档自适应调频 |
| [**Worker 数据后端与首屏缓存**](./state-storage.md) | Cloudflare Workers 数据流与 Next.js 缓存 | Durable Objects SQLite 持久化、统一信封、`'use cache'` 标签失效、ESA 边缘回源策略、数据迁移验证 |
| [**Workers 原生 Git 部署**](./workers-builds.md) | Cloudflare Workers Builds CI/CD 机制 | 三个独立 Worker 的原生构建配置、Monorepo 监视路径规则、依赖锁定与发布验收 |
| [**生产上报端点核验记录**](./reporter-endpoints.md) | 生产实例上报健康度核验与配置备份 | 各上报端点（Mac、NAS、Home Assistant、云端节点等）验证记录、备份路径与回滚说明 |

---

## 交互式架构图

- 网页在线交互版：[https://lyjw131.github.io/lyjwpage/](https://lyjw131.github.io/lyjwpage/)
- 原始架构定义：[`architecture.json`](./architecture.json) 与 [`architecture.receipt.json`](./architecture.receipt.json)
- 离线渲染快照：[`architecture-dark.png`](./architecture-dark.png) / [`architecture-light.png`](./architecture-light.png)

## 页面效果图

[`screenshots/`](./screenshots/) 是根 README 里的效果图，明暗各一份。用本地 Worker 的假数据注入把平时不显示的状态点亮后截的，夹具在 [`workers/api/dev-fixtures/`](../workers/api/dev-fixtures/)，注入方式见 [`workers/api/README.md`](../workers/api/README.md)。

歌词不入库：本地 Worker 没有 Apple Music 凭据，`/api/lyrics` 也不走上游兜底，所以截「正在听」时把生产站的响应包一层 `ok` 直接注入（`song` 取 `listening-now-*.json` 里的 `songId`）：

```sh
curl -s 'https://api.homepage.lyjw.llc/api/lyrics?song=1490256995' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify({ok:true,...JSON.parse(s)})))' \
  > /tmp/lyrics-override.json
pnpm dev:override /api/lyrics /tmp/lyrics-override.json
```

页头品牌字标那条是 GIF（`desktop-marks-{light,dark}.gif`），由 [`scripts/desktop-marks-gif.py`](../scripts/desktop-marks-gif.py) 生成：三段字标都从本地站点页头真实截下再拼成一条；Claude Code 那段装上 Playwright 的假时钟逐 25ms 推进，精灵 SVG 一变就截一帧，抓到完整一轮 33 个取物姿势，帧时长直接取 `src/lib/mascot-fetch.json` 的原始毫秒数。站点上每轮结束停 5 秒，GIF 里不停，首姿势只保留源数据自带的两步（767 + 258 ms），整轮 4.1 秒连续循环。需要 Python 3、`playwright`、`pillow`（`pip install playwright pillow && playwright install chromium`），本地 Worker 与 `pnpm dev:local` 在跑：

```sh
python3 scripts/desktop-marks-gif.py            # 明暗各一张
python3 scripts/desktop-marks-gif.py --theme dark
```

脚本自己打开假数据总开关、依次注入 `desktop-claude-code / cursor / antigravity` 三个夹具，结束后清掉注入并把总开关恢复原状。字标改了外观、`mascot-fetch.json` 换了姿势或节拍时重跑一次即可。
