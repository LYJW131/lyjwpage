<div align="center">

# lyjwpage

**一个由真实设备与日常活动驱动的个人主页。**

[在线访问](https://lyjw.me) · [中国大陆访问](https://lyjw131.com) · [交互式架构图](https://lyjw131.github.io/lyjwpage/)

</div>

听什么、看什么、玩什么，正在使用哪些应用，设备如何运行——这个主页把分散在 Mac、iPhone、NAS 和云端服务中的状态汇集到同一个页面。

它既是我的个人主页，也是一套持续演进的个人遥测系统。这个仓库记录网站源码，以及从设备采集、状态聚合到页面呈现的架构与实现。

## 页面里有什么

| 模块 | 展示与交互 |
| --- | --- |
| **本机与充电设备** | Mac 前台应用（几款常用工具换成品牌标识和动画），以及通过隐私判断放行的窗口标题；Anker 充电器、充电宝的端口状态、电压、电流和功率变化。 |
| **影视** | Emby 正在播放与最近观看，呈现播放进度、剧集信息、画面与音轨规格。 |
| **音乐** | Apple Music 与 HomePod 播放状态、最近收听、逐字歌词和动态封面；访客可通过自己的 Apple Music 账号与订阅使用网页播放器和「一起听」。 |
| **运动活动** | 通过 iPhone 的 HealthKit 数据展示 Apple Watch 活动、锻炼与站立三环，以及最近 10 次训练的时长、能量和心率。 |
| **服务器** | 落地节点的运行时间、CPU、内存、网络吞吐，以及按计费周期累计的流量。 |
| **AI Coding** | 编码工具的 Token 用量、API 等值成本估算、年度热力图与账号限额窗口。 |
| **游戏** | PlayStation 在线状态、游戏记录与奖杯进度，展开游戏卡片查看成就明细。 |
| **Pulse** | 编码、听、看、玩、充电、身体活动六个域最近 24 小时的活跃度泳道；悬停任一时段可看当时在听的曲目、在看的影视、在玩的游戏与该窗口的评分。 |
| **站点自身** | 网站版本、GitHub 仓库统计与最近提交（含签名状态），PageSpeed 实验室指标的滚动中位数，以及 Vercel 部署和 Cloudflare Workers 的调用统计。 |

界面以灰阶、细线边界和卡片布局为基础，用等宽数字稳定动态指标的排版。颜色与动效主要服务于媒体内容、状态变化和交互反馈。

## 页面效果

首页是动态的：正在播放、正在充电、正在游玩这些卡片只在对应的事情发生时出现，平时看不到。下面的效果图在本地用示例数据把这些状态同时点亮，明暗主题跟随系统；会动的那几张是从站点上真实录下来的。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.webp">
  <img src="docs/screenshots/overview-light.webp" alt="首页总览：正在看、充电头与充电宝、正在听、活动圆环与最近训练、落地节点同时点亮" width="100%">
</picture>

**页头的前台应用**：页头中央显示 Mac 此刻的前台应用，图标和名字由 Mac 上报器上报。几款常用工具换成了品牌标识：Claude Code 是像素吉祥物的取物动画，来自 [mascot-fetch-loop](https://github.com/LYJW131/mascot-fetch-loop)（从屏幕录像逐帧复原的 19 个姿势，站点内联其精灵数据自行播放，[在线预览](https://lyjw131.github.io/mascot-fetch-loop/)）；Ghostty 是[官网首页](https://ghostty.org/)那只 ASCII 幽灵，`scripts/ghostty-frames.mjs` 从首页载荷里取出 235 帧 100×41 的字符画，每两列并成一个单元、按字形墨量分成本体三档和光环三档、每三帧取一帧，压成 79 帧 39×39 的粗网格（`src/lib/ghostty-frames.json`，57 KB），站内按 93 ms 一帧用 SVG 路径循环播放，本体跟随页面文字色、光环保持官网的蓝；Cursor 与 Antigravity 用 [LobeHub 图标集](https://github.com/lobehub/lobe-icons)的字标。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/desktop-marks-dark.gif">
  <img src="docs/screenshots/desktop-marks-light.gif" alt="页头前台应用的四种品牌标识：Claude Code 吉祥物取物动画、Ghostty ASCII 幽灵动画、Cursor 与 Antigravity 下方窗口标题的出现、变化与消失" width="788">
</picture>

应用名下面那行淡色小字是当前窗口的标题，Cursor 和 Antigravity 两段演示了它出现、变化和消失的样子——但只有通过隐私判断的标题才会出现，见下文。

**Emby 正在播放**：海报、剧集、进度，以及画面、音轨与码率规格。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/now-watching-dark.webp">
  <img src="docs/screenshots/now-watching-light.webp" alt="Emby 正在播放卡片" width="100%">
</picture>

**充电设备**：Anker 充电头各端口的功率、设备与协议，以及总功率曲线；充电宝的电量、收放电、温度与健康度。

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/charger-dark.gif">
        <img src="docs/screenshots/charger-light.gif" alt="Anker 充电头卡片：总功率换档时读数滚动、曲线末尾接上新点">
      </picture>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/powerbank-dark.webp">
        <img src="docs/screenshots/powerbank-light.webp" alt="Anker 充电宝卡片：电量、底座输入、输出与端口">
      </picture>
    </td>
  </tr>
</table>

**Apple Music 正在播放**：封面、来源设备、进度与逐字高亮的同步歌词，下方是最近收听。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/now-listening-dark.gif">
  <img src="docs/screenshots/now-listening-light.gif" alt="Apple Music 正在播放：逐字高亮的歌词一句扫过、换到下一句，下方是最近收听" width="100%">
</picture>

**活动与训练**：Apple Watch 的活动、锻炼、站立三环与步数、距离、爬楼，右侧是最近训练，每页两条横向翻页。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/activity-dark.gif">
  <img src="docs/screenshots/activity-light.gif" alt="活动卡片：读数从上午换到下午，三环转到新位置、数字滚动，右侧是最近训练" width="100%">
</picture>

**落地节点**：位置与运营商、上下行速率、本计费周期已用流量，以及 CPU 与内存。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/server-dark.gif">
  <img src="docs/screenshots/server-light.gif" alt="落地节点卡片：上下行速率、CPU 与内存换档时读数滚动" width="100%">
</picture>

**AI Coding**：各编码工具的 Token 用量、成本估算、今日用量与账号限额窗口。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/vibecoding-dark.gif">
  <img src="docs/screenshots/vibecoding-light.gif" alt="AI Coding 卡片：用量涨一档时 Token、成本与限额百分比滚动" width="100%">
</picture>

**PlayStation**：在线状态、正在游玩的游戏、奖杯统计与最近解锁；展开游戏卡片查看奖杯组与逐条成就。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/playstation-trophies-dark.webp">
  <img src="docs/screenshots/playstation-trophies-light.webp" alt="PlayStation 卡片：在线、正在游玩与展开的奖杯明细" width="100%">
</picture>

**Pulse**：六个域最近 24 小时的活跃度泳道。看、玩画实测的播放与游戏状态，充电画实测瓦数；编码、听、身体活动画 Jev 的五分钟评分。听在 iPhone 等设备播放时，本机观测有盲区，因此评分还会结合「最近在听」列表；身体活动由 iPhone 回查 HealthKit 的闭合五分钟统计桶，不依赖后台上传恰好按时发生。缺失桶保持未知，活动估算不会延伸到此刻。身体活动的判据除了统计桶档位，还包括已完成训练的项目名和落在每个五分钟窗口里的活动秒数。六项右侧统一汇总强度档位、趋势和置信度，历史每分钟归档到 D1。悬停、点击或用方向键走到某一段，会显示这一段的时间范围、当时在听的曲目（在看的影视、在玩的游戏同理）以及该窗口的强度、连续性和置信度；播放停止的时段不沿用上一首的名字。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/pulse-detail-dark.webp">
  <img src="docs/screenshots/pulse-detail-light.webp" alt="Pulse 卡片：六条活跃度泳道与评分，悬停某一段显示时间范围、当时的曲目与该窗口评分" width="100%">
</picture>

## 系统架构

系统分为三部分：**采集端适配不同来源，Cloudflare 统一管理状态，Next.js 负责页面呈现。**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.png">
  <img src="docs/architecture-light.png" alt="多端采集、Cloudflare 状态中枢与 Next.js 展示端架构" width="100%">
</picture>

[打开交互式架构图](https://lyjw131.github.io/lyjwpage/)

**采集端**运行在数据产生的位置。Mac 采集本机应用、音乐、BLE 设备与编码用量，iPhone 读取运动活动，NAS 代理 Emby 播放状态，Linux 上报器提供服务器指标和 Agent 限额。Home Assistant 接入 HomePod 等家庭设备，独立 Worker 定时同步 PlayStation 数据。

**状态中枢**由 Cloudflare Workers 承担，负责接收上报、整合外部服务数据、提供公开状态 API 和实时推送。Durable Objects SQLite 保存快照与历史，是唯一权威；几条慢端点的公开读模型发布到 KV，读路径先取 KV、缺失或过旧时回源 DO。R2 保存海报等图片资源，D1 归档 Pulse 的逐分钟历史；在线访客计数由独立 Worker 维护。

**展示端**运行在 Vercel。Next.js 生成首页时读取 Worker 的聚合快照，浏览器挂载后直接连接 Worker 获取最新状态，不再经由 Vercel 转发状态请求。中国大陆访问入口通过阿里云 ESA 加速页面与静态资源。

## 几个关键设计

### 首屏快照与实时更新分开处理

首页通过一次聚合读取取得各模块快照，使用 Next.js `use cache` 缓存，让首次展示不依赖浏览器逐张卡片请求数据。

页面加载后，实时数据由浏览器直连 Worker 更新。首页缓存只在布局变化时（卡片出现或消失、换形态、行数变化，判据见 `src/lib/home-layout.ts`）触发标签失效并在后台重建；读数、标题、进度这类内容变化交给 10 分钟一次的定时重建，纯心跳不触发重建。

因此，缓存页面负责首次展示，客户端负责追上当前状态；不要求每次设备变化都同步刷新整页 HTML。

### 推送、轮询与本地推算各有分工

切歌、前台应用切换、设备插拔等事件通过 WebSocket 推送。多数事件直接携带新数据并写入 SWR 缓存，避免每个访客收到通知后再发起一次相同查询。

功率曲线、累计用量等连续指标按需轮询，播放进度则根据时间锚点在浏览器本地推算。轮询也为实时推送提供兜底；客户端的新鲜度检查防止较旧的轮询结果覆盖已收到的新状态。

### 不同来源共享状态与故障边界

设备协议和第三方接口由各自的采集器适配，页面消费统一的公开状态模型，不直接依赖家庭内网服务。

状态读改写在 Durable Object 内串行合并并持久化。单个数据源不可用时，通过统一的状态响应让对应卡片降级，而不是让整页等待所有设备在线。

上报写入需要鉴权，公开查询只返回明确的展示模型，服务端凭据与公开状态分开处理。

### 窗口标题在上报之前先过一道判断

窗口标题是页面上唯一一项窗口内容，也是唯一一项不能靠规则穷举的内容：应用名就那么多个，标题却是此刻打开的文件、网页或聊天对象。所以它在离开 Mac 之前先过一道隐私判断，由 [TypeSafe](https://www.typesafe.ai/) 的 Jev 参与判断能不能公开，拿不准的留给本人在 Mac 上决定；只有放行的标题才进上报信封。站点这一侧不参与判断，只认信封里有没有标题。

### 根据活动与访问情况调整开销

部分采集器根据设备活动和访客连接情况调整上报频率；浏览器标签页不可见时暂停状态轮询。WebSocket 使用 Hibernation API，让连接在没有业务事件时保持而无需实例持续运行。

实时推送连接与可见访客计数分别维护：前者关注状态同步，后者关注此刻正在查看页面的人数。

### 图片按内容寻址，交付域由访客域名的边缘决定

海报和应用图标由上报器一次压好、以 `<sha256>.<ext>` 直传 R2，状态里只存对象键。Worker 和站点把对象键拼成同源路径 `/img/<对象键>`，页面、状态 API 和推送里都不出现交付域。

`lyjw.me` 上由 `next.config.ts` 的 rewrite 把 `/img/*` 代理到 R2 公开源（`R2_PUBLIC_BASE_URL`，只配在 Vercel）：Vercel 边缘转发并按 R2 的 `immutable` 头缓存，不进 Function。`lyjw131.com` 上由 ESA 按静态后缀缓存同一路径并回源，中国大陆访客不再直连 Cloudflare。对象带一年不可变缓存，地址即内容指纹，所以两层边缘都不需要主动刷新。

## 技术组成

| 层次 | 主要技术 |
| --- | --- |
| 页面与类型 | Next.js 16 App Router · React 19 · TypeScript |
| 样式与交互 | Tailwind CSS 4 · Motion · Number Flow · Geist |
| 客户端数据 | SWR · WebSocket |
| 状态与资源存储 | Cloudflare Workers · Durable Objects SQLite · KV · D1 · R2 |
| 活跃度评分 | TypeSafe System One（Jev） |
| 原生设备接入 | Swift / SwiftUI · HealthKit · BLE |
| 页面托管与分发 | Vercel · 阿里云 ESA |

## 从哪里读源码

| 想了解什么 | 阅读入口 |
| --- | --- |
| 首页如何组合各个模块 | [`src/app/page.tsx`](./src/app/page.tsx) · [`src/components/live/`](./src/components/live/) |
| 首屏如何读取和缓存状态 | [`src/lib/home-snapshot.ts`](./src/lib/home-snapshot.ts) |
| 状态视图在两侧如何登记 | [`src/lib/status-views.ts`](./src/lib/status-views.ts) · [`src/lib/status-loaders.ts`](./src/lib/status-loaders.ts) |
| 推送与轮询如何更新同一份客户端状态 | [`src/hooks/use-live-events.ts`](./src/hooks/use-live-events.ts) · [`src/hooks/use-status.ts`](./src/hooks/use-status.ts) · [`src/lib/status-reads.ts`](./src/lib/status-reads.ts) |
| 网页播放器与歌词如何工作 | [`src/hooks/use-web-player.ts`](./src/hooks/use-web-player.ts) · [`src/hooks/use-lyrics.ts`](./src/hooks/use-lyrics.ts) |
| 上报、状态存储与公开 API 如何组织 | [`workers/api/`](./workers/api/) |
| 各类设备与服务如何接入 | [`reporters/`](./reporters/) · [`workers/playstation-reporter/`](./workers/playstation-reporter/) |
| 在线访客如何统计 | [`workers/online-counter/`](./workers/online-counter/) · [`src/hooks/use-online-count.ts`](./src/hooks/use-online-count.ts) |

Mac 端采集器 [MacTelemetryHub](https://github.com/LYJW131/MacTelemetryHub) 独立维护，通过 Git submodule 接入 `reporters/mac-telemetry-hub/`。

## 进一步了解

[遥测与实时状态子系统](./docs/telemetry-subsystems.md) 记录各数据源的接入方式、通信协议与具体实现。

[Worker 数据后端与首屏缓存](./docs/state-storage.md) 说明状态持久化、公开数据边界、缓存失效与页面更新之间的关系；KV 读模型的发布与回源规则见 [KV 公开读模型](./docs/kv-read-model.md)。

iPhone 端采集器 [iPhone Telemetry Hub](./reporters/iphone-telemetry-hub/README.md)（iOS 27 原生 SwiftUI）上报活动圆环与最近 10 次训练，协议和部署顺序见其 README 与 [API Worker](./workers/api/README.md#最近训练)。
