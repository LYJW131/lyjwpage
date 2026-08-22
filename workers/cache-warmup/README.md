# @lyjwpage/cache-warmup

定时 GET 两份生产的首页，让 Next `'use cache'` 在没人访问时也不走到 expire 的同步重算。

首屏寿命是 revalidate 10 分钟 / expire 2 小时（`lib/status-cache`）。这个 Worker 每小时打一次 `/`，漏一轮还有大约一小时余量。打的是整页 GET，不是 `/api/status/*`：国内那份状态接口关掉了缓存，暖不到首屏 HTML。

## 环境变量

- `WARMUP_ORIGINS`：逗号分隔的源，只取每个源的 `/`。源码里不写死域名。

  生产那份填 `https://lyjw.me,https://lyjw131.com`。预览站不要写进来。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| （cron） | — | 每小时整点 UTC。日志一行 JSON：`{ event, results }` |
| GET | `/` | 立刻跑一轮，方便部署后验。返回 `{ ok, results }` |

自定义域名写在 `wrangler.toml` 的 `routes` 里，和另外几个 Worker 一样挂 `*.homepage.lyjw.llc`。推 main 时 CI 自动部署（见 .github/workflows/deploy-workers.yml），手动 `wrangler deploy` 也行。

谁 GET 都会触发一轮，两次公开首页，没有密钥 —— 打的是自家写死在 `[vars]` 里的域名，不是 SSRF，但它确实是个便宜的放大器。要收的话给 `fetch` 那条加把密钥，或者干脆只留 `scheduled`。

## 命令

```bash
# 本地（cron 用 /__scheduled 触发）
pnpm --filter @lyjwpage/cache-warmup dev

# 类型检查
pnpm --filter @lyjwpage/cache-warmup typecheck

# 部署
pnpm --filter @lyjwpage/cache-warmup run deploy
```
