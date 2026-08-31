# @lyjwpage/online-counter

基于 Cloudflare Workers + Durable Objects 实现的轻量级全站实时在线人数统计服务。

## 部署与域名

1. 域名路由在 `wrangler.toml` 的 `routes` 里配。推 main 时 CI 自动部署
   （见 .github/workflows/deploy-workers.yml），手动 `wrangler deploy` 也行。
2. 部署成功后，把 Worker 的**源**（如 `https://online.example.com`）填入站点的
   `NEXT_PUBLIC_ONLINE_COUNTER_URL`。路径由站点自己拼 —— 浏览器连 `/ws`。
   站点侧几个 Worker 的地址变量都是这个形状
   （`NEXT_PUBLIC_LIVE_PUSH_URL` / `NEXT_PUBLIC_ONLINE_COUNTER_URL` /
   `NEXT_PUBLIC_MUSICKIT_TOKEN_URL`）。

## 路由

| 路径 | 用途 |
| --- | --- |
| `GET /ws` | WebSocket 升级，浏览器连这条。受 `ALLOWED_ORIGINS` 白名单管 |
| `GET /count` | `{"online": n}`，此刻的连接数，回答前先清一次死连接（见下）。不鉴权 |
| `GET /` | 一行存活文本。不碰 Durable Object |

`/count` 不只是调试口，**三个上报器靠它定节奏**：`playstation-reporter` 每分钟
看一次这个数，`apple-music-reporter` 和 `server-reporter` 每轮收尾各问一次。三家
都是同一套三档 —— 这个数大于 0（有页面**可见**）走 60 秒，否则再问 live-push 的
`/count`（有页面**开着**，含后台标签页）走 2 分钟，两个都是 0 才走 15 分钟。改这条
路径或返回形状要同步改那三处；它们读不到时一律往慢里退，所以这里挂掉不会连累上报，
只是不再加速。

不鉴权是故意的：这个数本来就印在站点页面上。也正因为它公开，别把贵操作挂到
`GET /` —— 浏览器和各种探针会一直打根路径。

## 死连接清理

只靠 `close` / `error` 事件收连接是不够的：对端没发 close 帧就消失（断网、
设备休眠、进程被杀）时，这两个事件一个都不来，那条连接会永远留在房间里把人数
顶高。虚高的代价不只是页面上难看 —— 上面那条 `playstation-reporter` 的门控会被
一个僵尸连接永久钉在 60 秒一轮，而每条日志看着都合法。

所以每条连接记一个「最近收到消息的时刻」（收到任何帧都刷新，浏览器目前只发
`"ping"`），静默超过 **三个心跳周期** 就主动 close 并移出名单：

- 心跳间隔 30 秒，定义在站点侧 `src/hooks/use-online-count.ts` 的 `heartbeatTimer`，
  worker 里的 `HEARTBEAT_INTERVAL_MS` 是它的副本 —— **改一边就得改另一边**。
  阈值取三个周期（90 秒）是留出丢两次 ping 的余量：贴着心跳间隔画线，网络抖一下
  就会误杀活人，而客户端断线后会立刻重连，于是踢一次、重连一次地抖成死循环。
- 页面隐藏时客户端是**整条连接关掉**（`visibilitychange` / `pagehide` 都走
  `cleanupSocket`），不是留着连接停心跳。所以「活着但不发心跳」这种连接不存在，
  能撞到 90 秒这条线的只有真的已经断了的。这也是这套清理不需要动站点侧的原因。
- 清扫由 Durable Object 的闹钟驱动，每 30 秒一次，房间里还有人就续订、人走光了
  自然停。**不用**在每次断开时 `deleteAlarm`：那是每断一条就多一次写，而多转的
  那一圈闹钟什么也不做。
- `GET /count` 会先清扫再回答，所以 PSN 那侧读到的是读的那一刻的准数，不用等
  下一次闹钟。只靠这条惰性清扫是不行的：它的触发源在别人的 cron 里，自家计数的
  正确性不能押在那上面。

方向是单向的：清理只会让计数变小、变准。时钟往回跳这类算不出正数的情况一律留着
连接 —— 宁可多数一个人，也别把还在看页面的访客踢下线。

## 环境变量

- `ALLOWED_ORIGINS`：`/ws` 的来源白名单，逗号分隔。支持 `https://*.vercel.app`
  这样的后缀通配 —— 预览域名每次部署都换一个，全等匹配收不住。

  **⚠️ 留空或整段不配 = 谁都能连**，任何站点都可以把这条 WebSocket 嵌进自己的
  页面、白蹭 Durable Object 的连接并把在线人数刷上去。这个 worker 早期就是这么
  裸奔的：代码里有校验，`wrangler.toml` 里没配变量，于是校验整段短路。
  留这个默认只是为了 `wrangler dev` 不配也能跑（localhost 始终放行），
  **部署到公网的那份必须配**。

  配上之后**不带 `Origin` 头的请求一律拒绝**：浏览器发 WebSocket 握手时一定带
  这个头，所以对真实访客零代价，但 `curl` 不带头就绕过白名单这条路被堵上了。
  用 curl 验证时记得自己加 `-H "Origin: https://…"`。

  名单和 `live-push` / `musickit-token` 那两个 worker 是同一份，
  加域名时三个都要改、都要重新部署。

## 命令

```bash
# 本地开发
pnpm --filter @lyjwpage/online-counter dev

# 类型检查
pnpm --filter @lyjwpage/online-counter typecheck

# 部署至 Cloudflare
pnpm --filter @lyjwpage/online-counter run deploy
```
