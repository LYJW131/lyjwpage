# @lyjwpage/online-counter

基于 Cloudflare Workers + Durable Objects 实现的轻量级全站实时在线人数统计服务。

## 部署与域名

1. 复制 `wrangler.toml.example` 为 `wrangler.toml`，按需配置你的自定义域名路由。
2. 部署成功后，将生成的 WebSocket 端点地址（如 `wss://online.example.com/ws`）填入站点的 `NEXT_PUBLIC_ONLINE_WS_URL` 环境变量。

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

  名单和 `live-push` 那个 worker 是同一份，加域名时两个都要改、都要重新部署。

## 命令

```bash
# 本地开发
pnpm --filter @lyjwpage/online-counter dev

# 类型检查
pnpm --filter @lyjwpage/online-counter typecheck

# 部署至 Cloudflare
pnpm --filter @lyjwpage/online-counter run deploy
```
