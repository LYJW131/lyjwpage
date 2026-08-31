# @lyjwpage/live-push

服务端 → 浏览器的实时推送。站点把事件 POST 到 `/publish`，这里广播给所有连在
`/ws` 上的浏览器。替代原来的 Pusher 协议服务（云 Pusher / 自部署 Sockudo）。

和隔壁 `online-counter` 分开：那个只数人头，谁连上谁断开就是全部输入；这个要接
站点的写入、要鉴权、要转发任意负载。

## 接口

| 方法   | 路径       | 说明                                                             |
| ------ | ---------- | ---------------------------------------------------------------- |
| GET    | `/ws`      | 浏览器的 WebSocket 端点。按 `ALLOWED_ORIGINS` 校验来源           |
| POST   | `/publish` | 站点发布一条事件。`Authorization: Bearer <LIVE_PUSH_SECRET>`     |
| GET    | `/count`   | `{"connections": n}`，此刻**开着**本站的页面数。上报器调频用，不鉴权 |
| GET    | `/`        | 健康检查，返回当前连接数                                         |

`/count` 不只是调试口，**`server-reporter` 靠它定中间那一档**：那个上报器每轮
收尾先问 online-counter 有没有**可见**的页面（有就 30 秒一轮），没有就问这里还
有没有**开着**的页面（有就 2 分钟一轮，没有才睡 10 分钟）。两个数是两个口径 ——
站点侧 `use-online-count` 在页面不可见时把连接整条关掉，`use-live-events` 不关，
所以后台标签页和锁了屏的手机只在这个数里。字段因此叫 `connections` 不叫 `online`。
改路径或返回形状要同步改 `reporters/server-reporter`；它读不到时会退回慢档，
所以这里挂掉不会连累上报，只是不再有中间那档。

数人头时会跳过静默超过 5 分钟的连接：对端消失却没发过 close 帧的连接会一直挂在
列表里，一条这样的僵尸就足以把上报器永远钉在中档。判据是运行时替我们记的
ping 自动回复时刻（浏览器每 30 秒发一个），阈值取 5 分钟而不是贴着心跳画线 ——
后台标签页的定时器会被浏览器节流到最多每分钟一响，而后台标签页恰恰是这个数
存在的理由。只是不计数，不关连接。

`/publish` 的请求体就是站点那份 `LiveEvent`：

```json
{ "type": "listening-now", "payload": { "...": "..." } }
```

只校验 `type` 是非空字符串，`payload` 原样转发 —— 事件种类和字段是站点和它自己
前端之间的约定，在这里再抄一份就等于同一份契约维护两处。

响应 `{ "ok": true, "delivered": <收到的连接数> }`。

## 部署与域名

1. 域名路由在 `wrangler.toml` 的 `routes` 里配。推 main 时 CI 自动部署
   （见 .github/workflows/deploy-workers.yml），手动 `wrangler deploy` 也行。
2. 存进发布密钥：`pnpm --filter @lyjwpage/live-push exec wrangler secret put LIVE_PUSH_SECRET`
3. 部署后把 Worker 地址（如 `https://live.example.com`）填进站点的
   `NEXT_PUBLIC_LIVE_PUSH_URL`，站点自己拼 `/ws` 和 `/publish`；misaka-jp 上
   `server-reporter` 的 `LIVE_PUSH_URL` 填同一个源，它自己拼 `/count`。
   live-push 一份生产一个，上报器读的是 Vercel 那一份。

## 环境变量

- `ALLOWED_ORIGINS`：`/ws` 的来源白名单，逗号分隔。支持 `https://*.vercel.app`
  这样的后缀通配 —— 预览域名每次部署都换一个。**留空 = 不限来源**
  （只为 `wrangler dev` 留的，公网那份必须配；localhost 始终放行）。
  配上之后**不带 `Origin` 头的请求一律拒绝** —— 浏览器握手时一定带这个头，
  用 curl 验证时要自己加 `-H "Origin: https://…"`。
  名单和 `online-counter` / `musickit-token` 那两个 worker 是同一份，
  加域名时三个都要改、都要重新部署。
- `LIVE_PUSH_SECRET`（**必填**，走 `wrangler secret put`）：`/publish` 的密钥。
  **没配的话 `/publish` 一律 503。** 和 `/ws` 的白名单反着来是故意的：那边放开
  顶多是别的站点蹭一份本来就公开的广播，这边放开等于让任何人往所有访客的页面
  里塞任意内容。

## 命令

```bash
# 本地开发
pnpm --filter @lyjwpage/live-push dev

# 类型检查
pnpm --filter @lyjwpage/live-push typecheck

# 部署至 Cloudflare
pnpm --filter @lyjwpage/live-push run deploy
```

## 休眠

连接走 `ctx.acceptWebSocket()` 而不是 `ws.accept()`：这些连接绝大多数时间空转
（上报器几十秒才来一条），休眠之后实例可以被回收、连接照样挂着。心跳用
`setWebSocketAutoResponse` 由运行时直接回，不唤醒实例。

代价是**不能把连接存在实例字段里** —— 休眠会清掉内存，醒来时构造函数重跑，
那个 Set 就空了。连接列表一律现问 `ctx.getWebSockets()`。

同一条理由的反面：`setWebSocketAutoResponse` **必须登记在构造函数里**，不能挪回
`/ws` 那条接入路径上。醒来那一次没有人走接入路径，登记就丢了；此后的 ping 落到
空的 `webSocketMessage`，自动回复时间戳不再走动 —— 而 `connectionCount` 正是拿
那个时刻判活的，还开着的后台页面会被一条条算成死连接，`server-reporter` 的中间
那档就再也进不去了。
