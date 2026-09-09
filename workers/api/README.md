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

Worker 在 SQLite 写入完成后，仅对展示变化在同一个 `waitUntil` 任务中并行通知两层缓存：

- Vercel：POST `${SITE_URL}/api/revalidate`，使用同一 Bearer，只传 `{ tags }`。按白名单将 `page:<tag>` 标 stale，先返回已有 HTML，后台重建。
- ESA：调用杭州端点的 `PurgeCaches`（2024-09-10），以 `Type=cachekey` 刷新 `https://lyjw131.com/`，站点 ID 为 `1113300533463584`。`lyjw131.com` 以 `lyjw.me` 为源站与回源 Host，缓存首页 HTML 和静态 JS；业务状态变化只清首页缓存键，带内容哈希的静态 JS 不随上报清理。

ESA 刷新由全站唯一 StateHub 的 SQLite 保存 120 秒冷却状态：首次立即发送，冷却内的变化合并为一次待刷新，在冷却结束后由 Durable Object alarm 补发，不依赖下一次上报。重启或重新部署保留间隔；失败尝试也占用本次窗口，Vercel 标签失效不受该冷却影响。alarm 可能延迟，因此保证的是最快 120 秒一次，而非精确每 120 秒执行。

两路各有 5 秒超时，失败独立记录日志，不能让已落库的上报重发。ESA 成功日志中的 TaskId 表示刷新任务已受理；可在控制台“刷新缓存”记录中确认完成。纯心跳和没有标签的广播不触发任何缓存通知。本地与测试环境不设置 ESA 变量，避免刷新生产。

Vercel 仍采用后台重建，刷新通知成功不代表新 HTML 已生成。两路并行存在 ESA 回源仍取得旧 HTML 的窗口，ESA 的缓存 TTL 继续约束这段陈旧时间；这条链路不承诺两层缓存同步完成更新。

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
`APPLE_MUSIC_KEY_ID`、`ESA_SITE_ID`、`ESA_CACHE_URL`，`IMAGES` 桶绑定，
以及 `LIVE_PUSH` 与 `STATE` 两个 Durable Object 绑定（迁移只追加新 tag，不改旧的）。
状态和凭据只存于 Worker 的 StateHub，Vercel 不连接数据库。秘密通过以下命令配置：

```sh
pnpm --dir workers/api exec wrangler secret put GITHUB_TOKEN
pnpm --dir workers/api exec wrangler secret put TELEMETRY_INGEST_SECRET
pnpm --dir workers/api exec wrangler secret put APPLE_MUSIC_PRIVATE_KEY < AuthKey_XXXXXXXXXX.p8
pnpm --dir workers/api exec wrangler secret put ALIYUN_ACCESS_KEY_ID
pnpm --dir workers/api exec wrangler secret put ALIYUN_ACCESS_KEY_SECRET
```

ESA 使用独立 RAM 用户的 AccessKey。权限仅授予
`esa:PurgeCaches`，资源限定到站点 `1113300533463584`，不使用主账号密钥。
签名采用阿里云 ACS3-HMAC-SHA256，通过 Worker 原生 HTTP 发送与控制台 TypeScript 示例相同的参数；
密钥仅放 Worker Secrets，不进入 Vercel、前端、仓库或日志。

站点配置 `NEXT_PUBLIC_BACKEND_URL=https://api.homepage.lyjw.llc` 与相同的
`TELEMETRY_INGEST_SECRET`；浏览器由这一个源拼 `/ws` 和 `/api/musickit/token`。所有上报器的目标为
这个 Worker 的 `/api/ingest/<来源>`，不经过站点，调频同时读取此源 `/count` 的 `connections` 与 `ONLINE_COUNTER_URL/count` 的 `online`。实例清单见 [端点核验记录](../../docs/reporter-endpoints.md)。

提交并推送 main，由 Cloudflare Workers Builds 原生 Git 集成自动部署。
`shared/`、共用 `src/lib/`、根依赖及路径配置变化也触发 api 部署。

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
