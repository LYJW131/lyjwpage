# @lyjwpage/online-counter

基于 Cloudflare Workers + Durable Objects 实现的轻量级全站实时在线人数统计服务。

## 部署与域名

1. 域名路由在 `wrangler.toml` 的 `routes` 里配。推 main 时 CI 自动部署
   （见 .github/workflows/deploy-workers.yml），手动 `wrangler deploy` 也行。
2. 部署成功后，把 Worker 的**源**（如 `https://online.example.com`）填入站点的
   `NEXT_PUBLIC_ONLINE_COUNTER_URL`。路径由站点自己拼 —— 浏览器连 `/ws`，
   `/count` 留给调试。站点侧几个 Worker 的地址变量都是这个形状
   （`NEXT_PUBLIC_LIVE_PUSH_URL` / `NEXT_PUBLIC_ONLINE_COUNTER_URL` /
   `NEXT_PUBLIC_MOTION_ARTWORK_URL` / `NEXT_PUBLIC_MUSICKIT_TOKEN_URL`；
   `cache-warmup` 没有，它是站点的调用方而不是被调方）。

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

  名单和 `live-push` / `musickit-token` / `am-motion-artwork` 那三个 worker 是
  同一份，加域名时四个都要改、都要重新部署。

## 命令

```bash
# 本地开发
pnpm --filter @lyjwpage/online-counter dev

# 类型检查
pnpm --filter @lyjwpage/online-counter typecheck

# 部署至 Cloudflare
pnpm --filter @lyjwpage/online-counter run deploy
```
