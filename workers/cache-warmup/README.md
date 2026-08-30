# @lyjwpage/cache-warmup

定时先失效、再 GET 两份生产的首页。GET `/` 单独打不掉 Vercel 上已经 prerender
好的 STALE 壳（`cacheComponents` 下嵌套 `cacheLife` 不是定时器；
`revalidateTag(tag, "max")` 是 SWR，下一个 GET `/` 仍可能吐旧 HTML）。

流程：对每个源 `POST /api/cron/revalidate-home`（立刻 expire 首屏 tag），
再 `GET /` 丢掉正文，让源站把新壳填上。打的是整页，不是 `/api/status/*`：
国内那份状态接口关掉了缓存，暖不到首屏 HTML。

cron 每 10 分钟一轮，对齐 `STATUS_LIFE.revalidate`。上报器开口时 ingest 仍会
刷 tag；它们沉默时这条是拖底。漏一轮还有大约一小时余量才到 expire（2 小时）。

## 环境变量

- `WARMUP_ORIGINS`：逗号分隔的源。源码里不写死域名。

  生产那份填 `https://lyjw.me,https://lyjw131.com`。预览站不要写进来。

- `TELEMETRY_INGEST_SECRET`：和站点同名变量对上。两处用：失效口的 Bearer，
  以及本 Worker `GET /` 手动触发的鉴权。**wrangler secret，不要写进
  `wrangler.toml` 的 `[vars]`。** CI 不注入 worker secret（见
  `.github/workflows/deploy-workers.yml`）。

  ```bash
  wrangler secret put TELEMETRY_INGEST_SECRET
  ```

  站点没配密钥时失效口放行；站点配了而这边没配，POST 会 401，Worker 仍会
  接着 GET `/`，两边都写进结果。Worker 自己配了密钥时，手动 `GET /` 也要
  带同一把 Bearer；cron 不走 `fetch`，不受这一层管。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| （cron） | — | 每 10 分钟 UTC。日志一行 JSON：`{ event, results }` |
| GET | `/` | 立刻跑一轮，方便部署后验。配了密钥要带 `Authorization: Bearer`。返回 `{ ok, results }` |

`results[]` 带 `invalidate`（POST 失效口）和 `get`（GET `/`）。任一步
非 2xx 都算这个源失败；EdgeOne 的 GET `/` 曾经 500，不要藏。

自定义域名写在 `wrangler.toml` 的 `routes` 里，和另外几个 Worker 一样挂 `*.homepage.lyjw.llc`。推 main 时 CI 自动部署（见 .github/workflows/deploy-workers.yml），手动 `wrangler deploy` 也行。

手动 `GET /` 仍在，但配了 `TELEMETRY_INGEST_SECRET` 之后必须带同一把 Bearer：
这条路径现在会 expire 两边生产的首屏 tag，再强制渲染，不能再匿名打。没配密钥
时放行，和站点 ingest 同一口径。cron 不经过 `fetch`。

EdgeOne 那份首屏 tag 失效仍只刷到接到 POST 的那一个 SCF 实例（见
`lib/live-events` 的 expireStatus）。GET 落到另一实例暖不到那份。这不是这条
路由新引入的，ingest 也一样；共享 `cacheHandlers` 才能跨实例。EdgeOne 的
`GET /` 曾经 500，结果里原样报。

## 命令

```bash
# 本地（cron 用 /__scheduled 触发）
pnpm --filter @lyjwpage/cache-warmup dev

# 类型检查
pnpm --filter @lyjwpage/cache-warmup typecheck

# 部署
pnpm --filter @lyjwpage/cache-warmup run deploy
```
