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

`src/lib/cache.ts` 是共用缓存，带 TTL、in-flight 去重和 5 秒负缓存。**核心原则：前端轮询多快，回源频率都不变**，由各自的 TTL 决定。值存 Redis（进程重启和多实例共享），没配 `REDIS_URL` 就整体退回进程内存；in-flight 去重始终在进程内，它挡的是同一进程的并发穿透，Redis 代劳不了。

### 最近在看 — Emby

`GET {EMBY_URL}/emby/Users/{userId}/Items/Resume` 拿续播列表（缓存 60 秒）。

**「正在播放」不轮询，靠 Emby 的 webhook 推过来。** 在 Emby 后台「通知 → Webhooks」里指向 `/api/ingest/emby`，勾上播放相关事件即可。收到播放事件时顺便让续播列表缓存失效，列表顺序和进度立刻跟上。

webhook 只在开始/暂停/继续/停止各来一条，中间没有消息。但事件里带着**当时的播放位置和总时长**，所以未暂停时按真实时间往前推算即可 —— 进度条不轮询也能走。这同时兼作兜底：推算位置超过总时长说明播完了而「停止」事件没收到（客户端崩了、网络断了），此时按已结束处理，不会一直挂着。

各版本的事件名写法不一致（`playback.start` / `PlaybackStart` / …），接收端统一压成小写去掉分隔符再按子串判断，不和具体写法绑死；`unpause` 里也含 `pause`，必须先判 `unpause`。

剧集自身的 `Primary` 图是剧照而不是海报，所以竖版海报优先取所属剧的 `SeriesPrimaryImageTag`。

#### 图片代理

前端拿到的不是 Emby 直链，而是本站的 `/api/image/emby/<token>`。这样源站不外泄，页面套上 CDN 后图片能跟着一起被缓存（Emby 自己没套 CDN）。

- **token 是加密的，不是签名的**。参数若明文放在 URL 里（`?id=…&kind=…&tag=…`），任何人都能照着拼出 Emby 直链，代理就白做了 —— 签名只挡得住枚举，挡不住照抄。所以把 `id|kind|tag|height` 用 AES-256-GCM 整体加密成一个不透明 token。GCM 的 auth tag 同时承担完整性校验，不需要另附签名，改一个字节就解不开。密钥由 `IMAGE_PROXY_SECRET`（没配则 `EMBY_API_KEY`）派生，加密和派生 IV 用两把不同的子密钥。
- **必须是确定性加密**：IV 由明文 HMAC 推导而不是随机生成。随机 IV 会让同一张图每次渲染得到不同 URL，CDN 和浏览器缓存全部失效 —— 而缓存正是做这个代理的目的。GCM 的 nonce 复用之所以危险是「同一 nonce 加密不同明文」，这里 nonce 由明文推导，构造上排除了这种情况。
- **不设过期**：token 里带着 Emby 的 image tag，图片换了 tag 就换，所以这个地址天然不可变，可以 `max-age=31536000, immutable`。加过期时间反而会打断 CDN 缓存。
- **两级缓存**（`lib/image-cache.ts`）：和状态接口同一个原则 —— 前端打多快，回源频率都不变。进程内存做 L1（省掉每张图 200KB 的 Redis 往返），Redis 做 L2（重启和多实例共享），缓存 10 分钟。同一个 token 并发只回源一次；条件请求直接拿缓存里的 ETag 比对，命中回 304，不必再问 Emby。
  - 存二进制必须自己管住上界，否则 token 随 image tag 变化会无限堆积：**32 条 / 单张 2MB / 总量 16MB 上限，LRU 淘汰**。实际用量的上界是「续播列表 8 条 × (poster + backdrop) = 16 张」，实测一张约 200KB。

> 卡片的「在 Emby 里打开」跳转链接仍然指向 `EMBY_PUBLIC_URL`，源站地址会出现在页面 HTML 里 —— 这是有意为之，不用改：Emby 前面有认证网关，跳过去的人会撞到认证。
>
> **只有图片端点是不需要认证的**，这也正是它必须走代理的原因：它是唯一一处不套代理就会被匿名直取的资源。

Apple Music 的封面没有代理，仍走 `mzstatic.com` 直链 —— 那本来就是公开 CDN，套一层反而多一跳。

### 最近在听 — Apple Music

两条独立凭据：

1. **Developer Token** —— 用 `.p8` 私钥签的 ES256 JWT，服务端可再生，缓存 12 小时（提前 5 分钟换新）。用 `jose` 签而不是 `node:crypto`，因为后者默认输出 DER 编码，而 JWT 要的是裸 r‖s（P1363）—— 这点搞错 Apple 会直接 401。
2. **Music-User-Token** —— MusicKit 授权后产出，服务端无法自助生成，过期只能重新获取。

拉 `/v1/me/recent/played?limit=10`。注意这个端点返回的是**专辑、歌单、电台这类容器**，不是单曲：专辑给 `artistName`、歌单给 `curatorName`，没有 `durationInMillis`，`limit` 上限是 10。列表缓存 30 秒。

「正在播放」是推断出来的，Apple 没有服务端可查的当前播放接口，也不返回播放时间戳：观测排第一的容器何时「变成第一」，再顺着它的 `href` 查一次曲目把时长加起来（缓存 24 小时），在总时长内就认为还在听。冷启动时看到的第一项无从分辨是刚开始还是早就播完，一律不算在听。

### 充电头 — Anker Prime 160W

数据来自 a2687-telemetry，它通过 BLE 读充电器、以 HTTP 暴露快照。`GET /status` 一次拿到整机功率 + 三个 USB-C 口的电压/电流/功率/协议/线缆/设备识别。

**本站不轮询充电头，只接收推送。** 遥测服务在对方机器上、只在 Tailscale 内可达，本来也拉不到。那台机器把 `/status` 原样 POST 到 `/api/ingest/charger`，用 a2687 自带的上报器即可：

```
A2687_POST_URL=http://<本站>/api/ingest/charger
A2687_POST_INTERVAL=30
```

该端点**无认证**：按约定不对公网暴露，访问控制交给网络层。（a2687 自带的上报器只发 `Content-Type` 和 `User-Agent`，本来也没法带认证头。）

**总功率历史存在服务端**（`lib/charger-store.ts`，Redis）。客户端自己累积的话页面一刷新曲线就没了、还要攒很久才有形状。环形缓冲 180 点，两点之间有最小间隔 `MIN_SAMPLE_GAP_MS`（当前 5 秒）——实测推送间隔约 5.3 秒，所以曲线覆盖约 24 分钟；要拉长跨度就调大这个值。

曲线的横坐标**按时间戳映射**而不是按序号等距铺开 —— 漏推一次就会有空档，等距会把那段画得和正常间隔一样宽。

超过 3 倍推送间隔（且至少 90 秒）没收到新数据就标记为断流，此时不再声称充电器在线，否则页面会一直显示旧的瓦数。

几个上游的脾气：

- `connected`（BLE 链路）和 `mode`（某个口是否在输出）是两层状态，UI 要分开处理
- 上游把 `"N/A"` 当占位符大量返回，必须过滤，否则界面上会出现一堆 N/A
- `ports` 的 key 顺序不保证，必须按 key 取
- 设备名靠 (VID, PID) 查表，表是逐条实机观察积累的。查不到时显示 `Unknown`（口空着才显示 `—`）
- **没有温度字段，上游也不给历史** —— 曲线是本站自己攒的

## 改内容

文案、社交链接、项目、时间线全在 `src/lib/site.ts`，组件里不写死内容。标了 `占位` 的是示例文案。

## 设计约定

- 层次靠 1px 线条和表面色阶，不靠阴影；磨砂只用在吸顶导航
- 分隔线用 `screen-line-top/bottom`：内容居中，线横贯整个视口
- **整站只有实时状态区允许出现彩色**，其余全是灰阶 —— 眼睛会自动被实时数据吸走
- 全站 `tabular-nums slashed-zero`，实时数字跳动时不抖宽度
