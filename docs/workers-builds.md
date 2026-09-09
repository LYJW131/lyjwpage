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
三个 Worker 均启用构建缓存，关闭非生产分支构建；目前没有独立的预览数据绑定。

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
