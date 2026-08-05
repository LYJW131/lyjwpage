# lyjwpage

个人主页。信息展示 + 三路实时状态：**最近在看**（Emby）、**最近在听**（Apple Music）、**充电头**（Anker Prime 160W）。

## 技术栈

| | |
|---|---|
| 框架 | Next.js 16 App Router（Turbopack） |
| UI | React 19 · Tailwind CSS v4（CSS-first，无 `tailwind.config`） |
| 动画 | `motion` · `@number-flow/react`（实时数字滚动） |
| 数据 | Route Handlers 代理 + SWR 轮询 |
| 字体 | Geist Sans / Geist Mono（本地字体包，构建不依赖网络） |

## 跑起来

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

填好 `.env.local` 后：

```bash
pnpm dev
```

## 三路状态是怎么接的

所有凭据只存在于服务端，浏览器只看得到 `/api/status/*` 返回的规范化数据。三个路由共用 `src/lib/api.ts` 的信封：上游挂掉时返回 `{ ok: false, error }` 而不是 5xx，让某一路数据源离线不至于把整页 SWR 打成错误态。

`src/lib/cache.ts` 是共用的进程内缓存，带 TTL、in-flight 去重和 5 秒负缓存 —— 前端 1Hz 轮询充电头时，真正打到上游的请求被压到每秒一次。

### 最近在看 — Emby

`GET {EMBY_URL}/emby/Users/{userId}/Items/Resume` 拿续播列表，再用 `GET /emby/Sessions` 匹配出**此刻真正在播放**的那一条，给它打上实时标记和跟手的进度。图片和跳转链接走 `EMBY_PUBLIC_URL`（浏览器能访问到的地址），取数走 `EMBY_URL`（内网直连更快）。

剧集自身的 `Primary` 图是剧照而不是海报，所以竖版海报优先取所属剧的 `SeriesPrimaryImageTag`。

### 最近在听 — Apple Music

两条独立凭据：

1. **Developer Token** —— 用 `.p8` 私钥签的 ES256 JWT，服务端可再生，缓存 12 小时（提前 5 分钟换新）。用 `jose` 签而不是 `node:crypto`，因为后者默认输出 DER 编码，而 JWT 要的是裸 r‖s（P1363）—— 这点搞错 Apple 会直接 401。
2. **Music-User-Token** —— MusicKit 授权后产出，服务端无法自助生成，过期只能重新获取。

拉 `/v1/me/recent/played/tracks?types=songs&limit=30`，按播放时间倒序原样展示（重复播放的同一首歌会重复出现，这正是「最近在听」要表达的），列表缓存 30 秒。

### 充电头 — Anker Prime 160W

上游是本机常驻的 a2687-telemetry 服务，通过 BLE 读充电器、以 HTTP 暴露快照。`GET /status` 一次拿到整机功率 + 三个 USB-C 口的电压/电流/功率/协议/线缆/设备识别。

几个上游的脾气：

- BLE 本身就是 ~1Hz 推流，轮询再快也拿不到新数据
- `connected`（BLE 链路）和 `mode`（某个口是否在输出）是两层状态，UI 要分开处理
- 上游把 `"N/A"` 当占位符大量返回，必须过滤，否则界面上会出现一堆 N/A
- `ports` 的 key 顺序不保证，必须按 key 取
- **没有温度字段**，也没有历史曲线 —— 卡片上那条功率曲线是客户端自己累积的最近约两分钟采样

## 改内容

文案、社交链接、项目、时间线全在 `src/lib/site.ts`，组件里不写死内容。标了 `占位` 的是示例文案。

## 设计约定

- 层次靠 1px 线条和表面色阶，不靠阴影；磨砂只用在吸顶导航
- 分隔线用 `screen-line-top/bottom`：内容居中，线横贯整个视口
- **整站只有实时状态区允许出现彩色**，其余全是灰阶 —— 眼睛会自动被实时数据吸走
- 全站 `tabular-nums slashed-zero`，实时数字跳动时不抖宽度
