# 页面在线人数

独立 Worker `online-counter`，域名 `https://online.homepage.lyjw.llc`。
入口只加载计数房间与来源检查，不加载 API 状态处理代码。

- `GET /ws`：WebSocket，立即广播 `{ online }`；来源须在 `ALLOWED_ORIGINS` 内。
- `GET /count`：公开返回 `{ ok: true, online }`，不缓存、不携带上报凭据。
- `GET /`：健康检查，不唤醒房间。

页面不可见时断开连接；可见时每 30 秒发送 ping，静默超过 90 秒清除。
连接计数为瞬时状态，部署后浏览器重连重新计数，不迁移业务数据。

站点配置 `NEXT_PUBLIC_ONLINE_COUNTER_URL=https://online.homepage.lyjw.llc`。
server、PlayStation、agent limits 上报器配置 `ONLINE_COUNTER_URL` 为同一源；
同时读取 API 的 `/count` 连接数，沿用可见、后台打开、无人三档。

```sh
pnpm --dir workers/online-counter types
pnpm --dir workers/online-counter typecheck
pnpm --dir workers/online-counter exec wrangler deploy --dry-run
node scripts/verify-online-counter.mjs
```

提交推送 main，由 Cloudflare Workers Builds 原生 Git 集成自动部署；[构建配置与监听路径](../../docs/workers-builds.md)包含共用的 `workers/api/src/origins.ts`。首次恢复应先发布此 Worker，确认域名和握手成功，
再发布站点、上报器及移除 API 旧计数房间；API 的删除迁移只清除原在线计数命名空间。
