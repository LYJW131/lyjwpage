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
三个生产 Worker 均启用构建缓存，关闭非生产分支构建。`api` 的生产脚本继续只从 `main` 发布。

## 分支预览

`api` 使用 Durable Objects，Cloudflare 不会给它生成 Preview URL。非生产构建也不能对生产脚本执行 `wrangler deploy`，那会把分支代码发到 `api.homepage.lyjw.llc`。

另建一个 Workers Builds 项目，连同一个仓库，Worker 名用 `api-preview`。它不服务访客，只负责给每个非 `main` 分支发一个影子脚本。

| 项 | 值 |
| --- | --- |
| 根目录 | `/` |
| 生产分支 | `main` |
| 构建命令 | `pnpm --dir workers/api typecheck` |
| 生产部署命令 | `node -e "console.log('api-preview ignores main')"` |
| 非生产分支构建 | 开启 |
| 非生产部署命令 | `node workers/api/scripts/deploy-preview.mjs` |
| 监视路径 | 留空 |

留空监视路径是故意的：Vercel 预览对每个非 `main` 分支都改连影子地址，只改前端的分支也得有这份 Worker。生产 `api` 项目的监视路径不要放宽，否则无关的 `main` 提交也会重新发布生产脚本。

影子脚本的配置是 `workers/api/wrangler.preview.toml`。名字按分支算，例如 `feat/agent-status` 得到 `api-preview-feat-agent-status`，地址是 `https://api-preview-feat-agent-status.lyjw.workers.dev`。算法在 `scripts/preview-worker-name.mjs`，Vercel 预览构建用同一份。

这份 Worker 有自己的空 SQLite，不挂生产域名、cron、KV、D1、R2，也不复制 Secret。`UPSTREAM_API_URL` 指向生产 API：生产已经返回 `ok: true` 的端点用生产的，生产没有的端点用本分支的。上报和存储导入直接拒绝。MusicKit 令牌、歌词、动态封面转给生产，并带上浏览器的 `Origin`。空库第一次公开读取时只把初始化标记写成完成，不导入数据。WebSocket 转发生产房间的事件。

现有四个 PR 要包含这次提交（rebase 到更新后的 `main`）之后，预览才会连上影子 Worker。合进 `main` 之前先把上面的 Cloudflare 项目建好，否则新的 Vercel 预览会指向还不存在的地址。

PR 关闭时 `.github/workflows/preview-api-worker.yml` 删除对应脚本。仓库 Secret `CLOUDFLARE_API_TOKEN` 需要 Workers 脚本的编辑权限，并配上账号 `209f2c881b1c494fec50851c067b3266`。没配令牌时工作流跳过，脚本留在账号里。

改过已有端点、而生产仍返回 `ok: true` 的计算，预览页看到的还是生产结果。写入路径和表结构不会在影子库里发生，因为没有上报进来。

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
