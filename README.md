<div align="center">

# lyjwpage

**个人主页与全栈数字生活看板**

基于 Next.js 16 与 Cloudflare Workers 构建的个人主页。除展示个人简介、项目经历与社交链接外，连接了多端物联网与云端上报体系，实时呈现听歌、追剧、游戏、充电功率、AI Coding 统计、运动健身及服务器运行等多维状态。

[在线访问](https://lyjw.me) · [大陆加速 (ESA)](https://lyjw131.com) · [交互式架构图](https://lyjw131.github.io/lyjwpage/) · [架构与子系统文档](./docs/README.md)

</div>

---

## 核心特性

- **全链路低延迟与实时状态感知**
  - **Apple Music 音乐流**：实时同步播放状态、字级动态歌词随播放进度逐字高亮渲染（rAF 驱动）、内嵌 Web 播放器，并支持访客使用自己的 Apple 账号实现「一起听」实时同步。
  - **Emby 流媒体实况**：NAS 追剧状态感知，实时推算播放进度，解析视频规格（4K / HDR10 / 杜比视界 / 音轨字幕），海报由上报器压缩直传 R2。
  - **PlayStation 5 在线与奖杯**：展示 PS5 实时在线状态与游戏实况，点击游戏瓷砖可平滑展开对应奖杯进度与明细。
  - **Anker 充电监测**：通过 BLE 实时采集 Anker Prime 160W 充电头与 A110G 充电宝的各口电压、电流、协议与设备识别，在服务端维护 400 点环形缓冲，绘制过去 20 分钟实时功率曲线。
  - **Vibe Coding 统计**：聚合 Claude Code、Codex、Cursor、Grok 等 AI coding agent 的 Token 消耗、API 等值成本、今日限额窗口以及过去 53 周（371 天）的全量年度用量热力图。
  - **Apple Watch 运动三环**：原生读取活动、锻炼、站立真实目标与完成度，按手表当地时区结算，呈现健康生活状态。
  - **边缘节点状态**：监测东京落地节点的 CPU 负载、内存占用与网络实时流量吞吐。
- **端到端安全与隐私优先**
  - 服务端不托管用户敏感私钥，Apple Music 开发者令牌由本地 Mac 钥匙串安全签发并自动续期。
  - 所有上报器仅发送规范化遥测指标，不传输提示词、代码片段、会话日志或内网网络拓扑。
- **现代混合边缘架构**
  - **Next.js 16 App Router**：基于 `'use cache'` 实现极速首屏渲染，内容按标签失效后台重建；配合 SWR 客户端无感刷新。
  - **Cloudflare Workers 中枢**：采用 Durable Objects + SQLite 实现多端状态的串行合并、持久化落盘与高并发读取。
  - **WebSocket 休眠长连接**：基于 Cloudflare WebSocket Hibernation API，连接常驻但无事件时实例完全休眠，毫秒级状态翻面直推浏览器。
- **极简克制的设计语言**
  - 灰阶打底，1px 视口贯通边框线条，全站仅有实时状态区允许彩色点亮。
  - 全站启用 `tabular-nums slashed-zero` 等宽数字排版，动态数值跳动时不抖动布局。
  - 容器滚动条默认隐藏，条目式横纵向滚动原生吸附对齐。

---

## 系统架构

整个系统由前端（Next.js）、数据中枢（Cloudflare Workers）与多端采集器（Reporters）协同组成：

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.png">
  <img alt="主页上报与 Vercel 读取架构" src="docs/architecture-light.png" width="100%">
</picture>

*[查看交互式架构图](https://lyjw131.github.io/lyjwpage/)*

</div>

1. **展示端**：承载 Next.js 16 页面渲染，首屏聚合快照直读 Worker；境内通过阿里云 ESA 边缘回源加速。
2. **数据中枢**：
   - `api`：统一接收七路遥测上报，写入 Durable Objects SQLite，处理 WebSocket 广播与页面缓存失效。
   - `online-counter`：独立维护活跃访客数，为空闲上报器提供调频信号。
   - `playstation-reporter`：定时同步 PlayStation Network 在线状态与游戏成就。
3. **上报生态**：
   - **Mac Telemetry Hub**：基于 macOS 原生能力采集前台应用、本机 Apple Music、充电设备 BLE 快照及本地编码日志。
   - **iPhone Telemetry Hub**：Swift 原生读取 HealthKit 运动三环与步数。
   - **Emby Reporter**：NAS 上的代理程序，监听并转发家庭影院播放状态，海报压成 WebP 直传 R2。
   - **Agent Limits Reporter**：Linux 容器常驻，独立采集各 AI Agent 的套餐窗口与限额状态。
   - **Home Assistant**：监听 HomePod mini 播放实况与智能插座电源状态。
   - **Server Reporter**：采集 Linux 节点的系统资源与网络指标。

---

## 技术栈

| 层次 | 核心技术选型 |
| --- | --- |
| **前端框架** | Next.js 16 (App Router / Turbopack) · React 19 |
| **样式与动效** | Tailwind CSS v4 (CSS-first) · `motion` · `@number-flow/react` |
| **客户端状态** | SWR (数据缓存与轮询兜底) · WebSocket (实时事件直推) |
| **字体排版** | Geist Sans / Geist Mono (本地打包，无外部网络依赖) |
| **后端与存储** | Cloudflare Workers · Durable Objects SQLite · Cloudflare R2 |
| **边缘与网络** | Vercel · 阿里云 ESA · WebSocket Hibernation |

---

## 快速开始

### 前置准备

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 10

### 1. 克隆与安装

```bash
git clone https://github.com/LYJW131/lyjwpage.git
cd lyjwpage
pnpm install
```

### 2. 环境配置

复制环境变量样例：

```bash
cp .env.example .env.local
```

根据需要填写 `.env.local`。默认情况下，前端开发服务器将直接连接生产只读 Worker 数据。

### 3. 启动开发服务器

```bash
pnpm dev
```

浏览器打开 [http://localhost:3211](http://localhost:3211)（端口固定为 3211，避免冲突）。

---

## 本地全栈开发与模拟测试

如果需要开发新的状态端点、调整后端 Worker 逻辑或调试新卡片，可以使用完整的本地开发环境：

### 启动本地 Worker 与 SQLite

```bash
# 1. 复制 Worker 环境变量配置
cp workers/api/.dev.vars.example workers/api/.dev.vars

# 2. 启动本地 Worker（端口 8788，持久化存储在 workers/api/.wrangler/dev-state）
pnpm dev:worker

# 3. 初始化本地数据库（首次运行需要，执行一次即可）
pnpm dev:worker:init

# 4. 启动前端并指向本地 Worker
pnpm dev:local
```

> **提示**：本地 Worker 支持「生产为主、本地补缺」：在 `.dev.vars` 中配置 `UPSTREAM_API_URL` 后，本地未上报的数据会自动代理生产环境，专注于正在新增的端点和字段即可。

### 假数据注入系统 (Dev Overrides)

当需要调试特定状态（例如：当前没有在看电影、充电头未插线、或者测试极端用量），可随时注入假数据，无需触发真实硬件：

```bash
# 注入假数据（夹具位于 workers/api/dev-fixtures/，也可以是任意 JSON 路径）
pnpm dev:override /api/status/watching/now watching-now.json

# 清除指定端点的假数据
pnpm dev:override /api/status/watching/now --clear

# 查看当前生效的注入列表
pnpm dev:override --list

# 临时关闭 / 重新启用假数据总开关
pnpm dev:override --off
pnpm dev:override --on
```

同时，在开发环境页面右下角提供了「Debug Capsule」悬浮胶囊，可直接在网页上一键切换假数据开关。

---

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动前端开发环境（连接生产 Worker 数据） |
| `pnpm dev:local` | 启动前端开发环境（连接本地 Worker `http://localhost:8788`） |
| `pnpm dev:worker` | 启动本地 Cloudflare API Worker |
| `pnpm dev:worker:init` | 初始化本地 Worker 数据库 |
| `pnpm dev:override <端点> <文件>` | 向本地 Worker 注入假数据夹具 |
| `pnpm build` | 执行 Next.js 生产构建与类型检查 |
| `pnpm test` | 执行全站单元测试与逻辑验证 |
| `pnpm typecheck` | 执行全量 TypeScript 类型检查 |
| `pnpm lint` | 执行 ESLint 静态代码检查 |

---

## 项目结构

```text
lyjwpage/
├── src/
│   ├── app/                 # Next.js App Router 页面与路由
│   ├── components/          # UI 业务组件（包含各实时状态卡片与 Hero 播放器）
│   ├── hooks/               # 客户端 Hooks（WebSocket 监听、在线人数、歌词渲染等）
│   └── lib/                 # 工具函数、数据获取、类型定义与个人主页内容配置
├── workers/
│   ├── api/                 # 核心状态 API Worker（Durable Objects SQLite + WebSocket）
│   ├── online-counter/      # 独立在线访客计数 Worker
│   └── playstation-reporter/# PlayStation 状态同步定时 Worker
├── reporters/               # 各端数据采集器
│   ├── mac-telemetry-hub/   # macOS 本机遥测中心（子模块，SwiftUI / 菜单栏应用）
│   ├── iphone-telemetry-hub/# iOS 运动三环采集中心（SwiftUI / HealthKit）
│   ├── emby-reporter/       # NAS Emby 播放实况代理与海报压缩程序
│   ├── agent-limits-reporter/ # AI Coding Agent 限额采集容器
│   └── server-reporter/     # Linux 服务器系统状态采集器
├── shared/                  # Worker 与前端共用的数据契约与时间算法
├── docs/                    # 深度技术文档与设计备忘
└── public/                  # 静态资源、离线页与 PWA Manifest
```

---

## 个性化定制

主页的所有文案、个人简介、社交账号、项目经历和时间线均集中在单处管理：

- **配置文件**：[`src/lib/site.ts`](./src/lib/site.ts)
- 修改该文件即可一站式更新站点上的展示内容，UI 组件无需侵入修改。

---

## 深入文档

如需了解底层设计细节、通信协议与架构机制，请参阅 `docs/` 专栏文档：

- [**遥测子系统与状态协议架构**](./docs/telemetry-subsystems.md)：各硬件设备（BLE、HealthKit、Emby、Apple Music、HomePod）的通信协议与工程实践记录。
- [**Worker 数据存储与缓存设计**](./docs/state-storage.md)：Durable Objects SQLite 存储模式、信封设计、`'use cache'` 与边缘回源策略。
- [**生产上报端点核验记录**](./docs/reporter-endpoints.md)：各上报源健康度核验与配置备份指引。
