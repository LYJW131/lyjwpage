# API 中枢

所有上报器直连此 Worker。它负责鉴权、解析、写 SQLite、广播 WebSocket 和通知 Vercel 缓存失效。
站点没有上报路由、rewrite、中继和事件发布逻辑。站点部署在 Vercel，腾讯云 EdgeOne 已退役。

## 代码职责

- `src/index.ts`：七个上报来源、两条 WebSocket 接入、人头数、定时刷新。
- `src/online-counter.ts`：「此刻在线」的房间，只数可见的页面，人数一变就广播给房间里所有连接。
- `src/stores/`：上报解析与状态写入；`src/phone-telemetry.ts`、`src/homepod-ingest.ts` 组合设备信封。
- `src/fanout.ts`：先确认写入成功，再后台广播和通知首屏 stale。
- `src/apple-music-recent.ts`：最近在听的拉取、写入和广播。
- `src/musickit-token.ts`：给「一起听」签 MusicKit developer token（ES256 JWT），按 origin 声明缓存、过半衰期重签。
- `src/origins.ts`：`ALLOWED_ORIGINS` 的解析、通配匹配和 CORS 头，两条 WebSocket、公开 API 和令牌签发共用。
- 根目录 `shared/`：读写共用的 SQLite 键、类型和状态计算；根目录 `src/lib/` 提供读取与通用工具。
- `src/storage-driver.ts`：通过 alias 接入 StateHub 的 SQLite 存储驱动。
- `src/r2-assets.ts`：R2 绑定 HEAD 检查，上报器仍直接上传图片。

## 端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/ingest/<来源>` | `mac`、`iphone`、`homepod`、`emby`、`playstation`、`server`、`agents` |
| GET | `/ws` | 浏览器接收事件推送的 WebSocket，页面开着就一直挂着；使用 `ALLOWED_ORIGINS` 校验来源 |
| GET | `/count` | `{ ok, connections }`：开着的页面数，供上报器判定中档 |
| GET | `/api/musickit/token` | `{ token, issuedAt, expiresAt }`：给「一起听」的 MusicKit developer token，同一份来源白名单；见下文 |
| GET | `/` | 一行存活；不碰 Durable Object，根路径被探针不停打 |

两个数是两个口径，分别位于两个 Worker 的 Durable Object：`LivePushRoom` 走休眠 API，静默 5 分钟不计数、
30 分钟才关，因为后台标签页的定时器会被浏览器节流；`OnlineCounterRoom` 把连接留在实例里，
静默三个心跳周期（90 秒）就踢，因为可见页面不会被节流，一条僵尸多活 5 分钟就把三个上报器
多钉在快档 5 分钟。心跳 30 秒定义在站点 `src/hooks/use-online-count.ts`，Worker 里那份是
手抄的副本，改一边必须改另一边。独立在线人数 Worker 的 `/ws` 按可见性反复重连，不触发 API 的最近在听刷新。

上报要求 `Authorization: Bearer <TELEMETRY_INGEST_SECRET>`，未配置密钥或 SQLite 返回 503，
鉴权失败返回 401，非法报文返回 400，成功返回 202。202 表示持久化完成，广播和缓存通知由 `waitUntil` 执行。
旧站点 `/api/ingest/*` 与 Worker `/publish` 均不存在。

Worker 在 SQLite 写入完成后，仅对展示变化在 `waitUntil` 后台任务中通知 Vercel：POST `${SITE_URL}/api/revalidate`，使用同一 Bearer，只传 `{ tags }`。按白名单将 `page:<tag>` 标 stale，先返回已有 HTML，后台重建。通知 5 秒超时，失败只记日志，不能让已落库的上报重发。纯心跳和没有标签的广播不触发缓存通知。

ESA 首页不走通知。`lyjw131.com` 以 `lyjw.me` 为源站与回源 Host，控制台缓存规则「首页遵循源站缓存」（主机名等于本站、URI 路径等于 `/`，排在 PWA 绕过规则之后）让边缘按源站 `Cache-Control: public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400`（根目录 `next.config.ts`）自行缓存：5 分钟内命中，之后先回旧 HTML、后台回源取新。带内容哈希的静态 JS 按源站一年 immutable 缓存，不随上报清理。需要立即生效时去控制台手动刷新一条 URL。

这条规则是必需的：`/` 没有文件后缀，不匹配任何默认缓存类型，没有规则覆盖时 ESA 直接判 DYNAMIC、每次回源——之前命中率归零的真正原因。`PurgeCaches` 链路（含 RAM 密钥、`esa-*` 模块、SQLite 冷却表）已随 SWR 上线删除；免费版没有预热额度、刷新本身也要 5~6 分钟才生效，不要加回来。

Vercel 仍采用后台重建，通知成功不代表新 HTML 已生成。ESA 后台回源可能取得 Vercel 仍在重建中的旧 HTML，下一轮刷新时收敛；这条链路不承诺两层缓存同步完成更新。首屏新鲜度不依赖这两层：浏览器挂载后直接向 Worker 取最新状态。

公开 API 为 `/api/status/*`、`/api/home`、`/api/lyrics`、`/api/motion-artwork`。浏览器挂载后直接访问这里，Vercel 只在首屏生成或重建时读取 `/api/home`。服务端凭据不进入任何公开响应，没有通用 HTTP 数据库端点。

## 最近在听

WebSocket 连接成功时检查一次。cron 每分钟检查连接数，有存活连接才刷新；无人连接时不拉 Apple。
SQLite `SET NX PX` 闸门与实例节流将真正的拉取限制为至少两分钟一次。
Mac 上报的 Apple Music 凭据保存在 SQLite，Worker 读取使用，不向外提供凭据端点。
状态读取不再触发拉取或广播。

## MusicKit 令牌

访客用自己的 Apple Music 订阅跟听之前，先得有一份 developer token 才能把 MusicKit JS 配起来。
这份令牌发给**任何一个访客**，和 SQLite 里 Mac 上报的那份私人凭据（带 music user token）
不是一回事、不共用路径。从前是单独的 musickit-token Worker，09-07 并进来。

`ALLOWED_ORIGINS` 一份名单，两道限制：

1. **谁能来要令牌** —— 比请求的 `Origin` 头，配了名单之后不带这个头一律拒绝。这道只是让
   「拿一份」不那么随手，Origin 头非浏览器伪造得了。
2. **令牌只在这些域上有效** —— 名单里写死的域签进 JWT 的 `origin` 声明，由 Apple 校验。
   通配项（`https://*.vercel.app`）Apple 不解析，匹配到的预览域名和 localhost **只签它自己一个**，
   不把生产域名一起捎上；否则任何人带一句 `Origin: http://localhost:3000` 就能要走一份在
   `lyjw.me` 上可用的令牌。

同一份 origin 声明的令牌在 isolate 里复用，过了「签发 → 到期」的中点才重签；`issuedAt` 和
`expiresAt` 一起给，站点用同一条半衰期规则决定何时再要。响应一律 `Cache-Control: no-store`。
出错时 `{ "error": "..." }`：403 来源不对、405 方法不对、500 变量没配或私钥坏（只有自己写死
的配置提示外带，运行时异常只进日志）。

三样东西来自 [Apple Developer](https://developer.apple.com/account/resources/authkeys/list) 勾了
**MusicKit** 的密钥：`APPLE_MUSIC_TEAM_ID`、`APPLE_MUSIC_KEY_ID` 放 `[vars]`，
`APPLE_MUSIC_PRIVATE_KEY`（`.p8` 全文，带不带 PEM 头尾、换行是真的还是 `\n` 都吃）走 secret。
有效期 `MUSICKIT_TOKEN_TTL_SECONDS` 不填按 7 天，上限半年；不取上限是因为令牌一旦被复制走，
域名限制之外就只剩有效期这一道闸。

## 配置与部署

生产发布走 Cloudflare Workers Builds 原生 Git 集成，推送 `main` 且本 Worker 或共享代码变化时触发。构建命令、监视路径与验收流程见 [原生部署配置](../../docs/workers-builds.md)。

`wrangler.toml` 中配置公开变量 `SITE_URL`、`STORAGE_PREFIX`、`R2_PUBLIC_BASE_URL`、
`EMBY_PUBLIC_URL`、`APPLE_MUSIC_STOREFRONT`、`ALLOWED_ORIGINS`、`APPLE_MUSIC_TEAM_ID`、
`APPLE_MUSIC_KEY_ID`，`IMAGES` 桶绑定，
以及 `LIVE_PUSH` 与 `STATE` 两个 Durable Object 绑定（迁移只追加新 tag，不改旧的）。
状态和凭据只存于 Worker 的 StateHub，Vercel 不连接数据库。秘密通过以下命令配置：

```sh
pnpm --dir workers/api exec wrangler secret put GITHUB_TOKEN
pnpm --dir workers/api exec wrangler secret put TELEMETRY_INGEST_SECRET
pnpm --dir workers/api exec wrangler secret put APPLE_MUSIC_PRIVATE_KEY < AuthKey_XXXXXXXXXX.p8
```

Worker 不再调用阿里云 OpenAPI。旧的 `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`
Secrets 与专用 RAM 用户已无用，在 Cloudflare 控制台和阿里云 RAM 控制台删掉即可。

站点配置 `NEXT_PUBLIC_BACKEND_URL=https://api.homepage.lyjw.llc` 与相同的
`TELEMETRY_INGEST_SECRET`；浏览器由这一个源拼 `/ws` 和 `/api/musickit/token`。所有上报器的目标为
这个 Worker 的 `/api/ingest/<来源>`，不经过站点，调频同时读取此源 `/count` 的 `connections` 与 `ONLINE_COUNTER_URL/count` 的 `online`。实例清单见 [端点核验记录](../../docs/reporter-endpoints.md)。

提交并推送 main，由 Cloudflare Workers Builds 原生 Git 集成自动部署。
`shared/`、共用 `src/lib/`、根依赖及路径配置变化也触发 api 部署。

## 本地开发

```sh
cp .dev.vars.example .dev.vars      # 填 GITHUB_TOKEN；STATE_IMPORT_SECRET 本地随便填
pnpm dev:worker                     # 仓库根目录执行；http://localhost:8788
pnpm dev:worker:init                # 只需一次，初始化空的 StateHub
pnpm dev:local                      # 站点指向本地 Worker
```

本地用 `wrangler.test.toml`：生产配置里的 `deleted_classes` 迁移在空环境下起不来，测试配置有从头开始的迁移链，且没有生产域名和 cron。
状态持久化在 `.wrangler/dev-state`，重装或想清库就删它，再跑一次 init。

本地是空库。`.dev.vars` 里的 `UPSTREAM_API_URL` 让 `publicResponse` 把本地 `ok:false` 的快照字段和端点用生产的顶上（只读、不上报）；
生产的 wrangler.toml 不配它。要测上报链路，直接往 `http://localhost:8788/api/ingest/<来源>` 推，鉴权用 `.dev.vars` 里的 `TELEMETRY_INGEST_SECRET`。

## 验证

```sh
pnpm --dir workers/api typecheck
pnpm --dir workers/api test
pnpm build
node scripts/verify-api-worker.mjs
```

集成脚本启动隔离 SQLite、Worker 和缓存通知测试服务器，检查鉴权、404、写入、缓存失效、两条真实 WebSocket
和 `/count` 的两个数，退出时清理临时状态。不要在本地开发配置中使用生产 SQLite。

SQLite 初始化、迁移与权限见 [后端架构](../../docs/state-storage.md)。

## Worker 更名

生产服务为 `api`，域名 `api.homepage.lyjw.llc`。`v1-transfer-from-ingest` 将旧 Worker 的三个 SQLite Durable Object 命名空间整体转移，保持 ID 与数据不变；后续部署保留这条迁移记录。不要对这些类另加创建或删除迁移。
