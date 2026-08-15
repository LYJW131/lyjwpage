# @lyjwpage/online-counter

基于 Cloudflare Workers + Durable Objects 实现的轻量级全站实时在线人数统计服务。

## 部署与域名

1. 复制 `wrangler.toml.example` 为 `wrangler.toml`，按需配置你的自定义域名路由。
2. 部署成功后，将生成的 WebSocket 端点地址（如 `wss://online.example.com/ws`）填入站点的 `NEXT_PUBLIC_ONLINE_WS_URL` 环境变量。

## 环境变量

- `ALLOWED_ORIGINS`（选填）：跨域允许来源列表，逗号分隔，如 `https://example.com,https://homepage.example.com`。留空或未配置则默认允许所有来源（本地开发 localhost 始终放行）。

## 命令

```bash
# 本地开发
pnpm --filter @lyjwpage/online-counter dev

# 类型检查
pnpm --filter @lyjwpage/online-counter typecheck

# 部署至 Cloudflare
pnpm --filter @lyjwpage/online-counter deploy
```
