# @lyjwpage/live-push

服务端 → 浏览器的实时推送。站点把事件 POST 到 `/publish`，这里广播给所有连在
`/ws` 上的浏览器。替代原来的 Pusher 协议服务（云 Pusher / 自部署 Sockudo）。

和隔壁 `online-counter` 分开：那个只数人头，谁连上谁断开就是全部输入；这个要接
站点的写入、要鉴权、要转发任意负载。

这里也数连接（`GET /count`），但和那边数的不是一回事：online-counter 的数是**此刻
可见**的页面（它在 `visibilitychange` 时整条连接关掉，那个数印在页面上给人看），
这里的数是**开着**的页面 —— 后台标签页、锁了屏的手机都算。两个上报器的调频门读的
是后者，见下面「谁在读 /count」。

## 接口

| 方法   | 路径       | 说明                                                             |
| ------ | ---------- | ---------------------------------------------------------------- |
| GET    | `/ws`      | 浏览器的 WebSocket 端点。按 `ALLOWED_ORIGINS` 校验来源           |
| POST   | `/publish` | 站点发布一条事件。`Authorization: Bearer <LIVE_PUSH_SECRET>`     |
| GET    | `/count`   | `{"connections": n}`，此刻挂着的连接数，回答前先清一次死连接。不鉴权 |
| GET    | `/`        | 一行存活文本。不碰 Durable Object                                |

`/publish` 的请求体就是站点那份 `LiveEvent`：

```json
{ "type": "listening-now", "payload": { "...": "..." } }
```

只校验 `type` 是非空字符串，`payload` 原样转发 —— 事件种类和字段是站点和它自己
前端之间的约定，在这里再抄一份就等于同一份契约维护两处。

响应 `{ "ok": true, "delivered": <收到的连接数> }`。

连接数从前挂在 `GET /` 上，现在搬到了 `/count`：根路径会被浏览器和各种探针一直打，
而取这个数要发一次 Durable Object 调用，等于每探测一次就把休眠的实例叫醒一回。

## 谁在读 /count

`playstation-reporter` 和 `apple-music-reporter` 靠它定上报节奏：这个数大于 0 就走
快档（两边都是 2 分钟一轮），否则退回各自的 15 分钟基线。改这条路径或返回形状要同步
改那两边；它们读不到时一律当 0，所以这个 worker 挂掉不会连累上报，只是不再加速。

**为什么不读 online-counter 的 `/count`。** 那条连接在页面进后台时是整条关掉的
（`src/hooks/use-online-count.ts` 的 `handleVisibilityChange`），所以它数的是「此刻
可见」：切个标签页、锁个屏就掉成 0，门跟着来回抖。上报该不该保持新鲜，取决于「有人
可能切回来看」——那正是这里这条连接还活着的含义。

不鉴权是故意的：上报器是服务端进程，不带 `Origin` 头，卡白名单等于把它们挡在外面；
而这个数本身没什么可藏的。字段叫 `connections` 不叫 online-counter 那个 `online`，
因为两者是不同的概念，不该共用一个名字。

## 死连接清理

对端没发 close 帧就消失（断网、设备休眠、进程被杀）时，`close` / `error` 事件一个
都不来，那条连接会永远留在 `ctx.getWebSockets()` 里。放着不管的话，一条僵尸就能把
上面两个上报器永久钉在快档上，而每条日志看着都合法 —— online-counter 当初栽的就是
这一下。

- 记「最近一次心跳」的不是实例字段，是运行时替我们记的那一枚：
  `ctx.getWebSocketAutoResponseTimestamp()`。休眠会清掉实例内存（见下面「休眠」那节），
  所以 online-counter 那份 `Map<WebSocket, number>` 在这里根本活不下来；而读运行时那枚
  不用把实例叫醒。刚接上、还没发出第一次 ping 的连接没有这个时间戳，用
  `serializeAttachment` 存的接入时刻兜底 —— attachment 同样活得过休眠。
- 阈值 **5 分钟**，**不是** online-counter 的 90 秒。那边挂着的只可能是前台可见的页面；
  这边故意把后台标签页留着，而后台页的 `setInterval` 会被浏览器节流到最多每分钟一响
  （Chrome 的 intensive throttling）。贴着 90 秒画线会把真实的后台连接成片误杀 ——
  按被节流后的 60 秒推三个周期，取 5 分钟。浏览器那侧的心跳间隔（30 秒）定义在
  `src/hooks/use-live-events.ts` 的 `HEARTBEAT_MS`，改那个数就回来重算这一条。
- 清扫**只**挂在 `/count` 被读的那一刻，没有定时闹钟。这和 online-counter 相反：那份
  计数印在页面上、必须自己收敛，而这一份只在被问到时才有意义，为它每分钟叫醒一次实例
  正好把休眠省下的东西抵消掉。
- 只做减法：两枚时刻都取不到、或者时钟往回跳算出负数，一律留着连接。

## 部署与域名

1. 域名路由在 `wrangler.toml` 的 `routes` 里配。推 main 时 CI 自动部署
   （见 .github/workflows/deploy-workers.yml），手动 `wrangler deploy` 也行。
2. 存进发布密钥：`pnpm --filter @lyjwpage/live-push exec wrangler secret put LIVE_PUSH_SECRET`
3. 部署后把 Worker 地址（如 `https://live.example.com`）填进站点的
   `NEXT_PUBLIC_LIVE_PUSH_URL`，站点自己拼 `/ws` 和 `/publish`。
4. 同一个地址还要填进两个上报器的 `LIVE_PUSH_URL`
   （`workers/playstation-reporter/wrangler.toml`、apple-music 上报器的环境变量），
   它们自己拼 `/count`。少配不会让上报停摆，只是永远走 15 分钟的基线节奏。

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
