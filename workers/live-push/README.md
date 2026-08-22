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
| GET    | `/`        | 健康检查，返回当前连接数                                         |

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
   `NEXT_PUBLIC_LIVE_PUSH_URL`，站点自己拼 `/ws` 和 `/publish`。

## 环境变量

- `ALLOWED_ORIGINS`：`/ws` 的来源白名单，逗号分隔。支持 `https://*.vercel.app`
  这样的后缀通配 —— 预览域名每次部署都换一个。**留空 = 不限来源**
  （只为 `wrangler dev` 留的，公网那份必须配；localhost 始终放行）。
  配上之后**不带 `Origin` 头的请求一律拒绝** —— 浏览器握手时一定带这个头，
  用 curl 验证时要自己加 `-H "Origin: https://…"`。
  名单和 `online-counter` 那个 worker 是同一份，加域名时两个都要改、都要重新部署。
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
