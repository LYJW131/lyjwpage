# Workers 原生 Git 部署

仓库 `LYJW131/lyjwpage` 的三个 Worker 连接 Cloudflare Workers Builds，生产分支均为 `main`。
GitHub Actions 负责 lint、类型检查、单测与 CodeQL；Worker 发布由 Cloudflare GitHub App 触发，
构建状态通过 GitHub check run 回传。Vercel 和 GitHub Pages 保持各自原生集成与现有工作流。

## 构建配置

| Worker | 根目录 | 构建命令 | 部署命令 |
| --- | --- | --- | --- |
| `api` | `/` | `pnpm --dir workers/api typecheck` | `pnpm --dir workers/api exec wrangler deploy` |
| `online-counter` | `/` | `pnpm --dir workers/online-counter typecheck` | `pnpm --dir workers/online-counter exec wrangler deploy` |
| `playstation-reporter` | `workers/playstation-reporter` | `npm run typecheck` | `npm run deploy` |

Workers Builds 在构建命令之前安装依赖。前两个使用根目录 `pnpm-lock.yaml` 与工作区；
PlayStation 保留独立 `package-lock.json`。Wrangler 使用对应包锁定的版本。
三个生产 Worker 均启用构建缓存。`api`、`online-counter`、`playstation-reporter` 的生产版本只从 `main` 用 `wrangler deploy` 发布。

## 分支预览

`api` 的非生产构建使用 [Worker Previews](https://developers.cloudflare.com/workers/previews/)（Wrangler 4.135.0 起）。`wrangler preview` 在同一个 `api` Worker 下按分支开一份隔离环境，不替换 `api.homepage.lyjw.llc` 上的生产版本。Durable Object 每个 Preview 自动有自己的空库。

Preview 命令需要 Wrangler `4.135.0`。生产 `wrangler deploy` 继续用 3.109：4.135 会拒绝这份已经生效的 `deleted_classes` 迁移。4.135 放在 `workers/api/preview-wrangler`，不挂到 `wrangler` 这个命令名上，避免生产部署误用它。

| 项 | 值 |
| --- | --- |
| 跑在哪个 Worker | 生产 `api`。另建的 `api-preview` 项目如果还在，停掉它的非生产构建，避免再发旧的独立脚本 |
| 非生产分支构建 | 在 `api` 上开启。已有构建连接要在设置里一次性切到 Worker Previews，预览命令改成下面这一条 |
| 预览命令 | `node workers/api/scripts/deploy-preview.mjs` |
| 生产部署命令 | 保持 `pnpm --dir workers/api exec wrangler deploy`，不要改成 `wrangler preview` |

`feat/agent-status` 的地址是 `https://feat-agent-status-api.lyjw.workers.dev`。算法在 `scripts/preview-worker-name.mjs`，Vercel 预览构建用同一份。Preview 配置在 `workers/api/wrangler.toml` 的 `[previews.vars]`：`UPSTREAM_API_URL` 指向生产 API，生产已经返回 `ok: true` 的端点用生产的，生产没有的端点用本分支的。不挂 cron、生产域名、KV、D1、R2，也不复制 Secret。上报和存储导入直接拒绝。MusicKit 令牌、歌词、动态封面转给生产，并带上浏览器的 `Origin`。空库第一次公开读取时只把初始化标记写成完成。WebSocket 转发生产房间的事件。

`api` 的监视路径不放宽，否则无关的 `main` 提交也会重新发布生产版本。只改了监视路径以外的文件的分支不会触发 Preview 构建，Vercel 仍会连这个地址，要等一次会触发构建的提交。

PR 关闭时 `.github/workflows/preview-api-worker.yml` 执行 `wrangler preview delete`。仓库 Secret `CLOUDFLARE_API_TOKEN` 需要能管理这个 Worker 的 Preview。没配令牌时工作流跳过。

改过已有端点、而生产仍返回 `ok: true` 的计算，预览页看到的还是生产结果。写入路径不会在 Preview 的空库里发生，因为没有上报进来。

## 构建监视路径

路径相对于 Git 仓库根目录。Cloudflare 的末尾 `*` 覆盖该目录下的所有文件，包含子目录；排除路径均为空。

- `api`：`workers/api/*`、`src/lib/*`、`shared/*`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`。
- `online-counter`：`workers/online-counter/*`、`workers/api/src/origins.ts`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`。
- `playstation-reporter`：`workers/playstation-reporter/*`。

API 的共享状态代码变化必须触发发布；来源白名单由 API 与在线人数共用，修改时必须同时发布两者。
增加共享依赖或移动文件时，同步调整 Cloudflare 的监视路径与本文。

## 配置与验收

连接、命令和监视路径保存在 Cloudflare 控制台的 Worker → 设置 → 构建。
运行时 Secret、Durable Objects、KV、R2、域名和 Cron 沿用现有 Worker 配置，构建不复制运行时 Secret。
Wrangler 文件仍是公开变量与绑定的配置来源。

发布后检查对应提交的 Cloudflare check run，并在 Worker 的构建历史中确认成功和提交 SHA。
然后检查受影响的生产状态 API、WebSocket 或定时上报。仅推送成功或构建通过不代表业务验收完成。
不重新启用另一条自动发布流水线向同一个 Worker 重复发布。

官方参考：[GitHub 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)、
[构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、
[监视路径](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)。
