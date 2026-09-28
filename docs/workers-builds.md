# Workers 原生 Git 部署

仓库 `LYJW131/lyjwpage` 的三个 Worker（`api`、`ingress`、`collector`）连接 Cloudflare Workers Builds，生产分支均为 `main`。
GitHub Actions 负责 lint、类型检查、单测与 CodeQL；Worker 发布由 Cloudflare GitHub App 触发，
构建状态通过 GitHub check run 回传。Vercel 和 GitHub Pages 保持各自原生集成与现有工作流。

## 构建配置

| Worker | 根目录 | 构建命令 | 部署命令 |
| --- | --- | --- | --- |
| `api` | `/` | `pnpm --dir workers/api typecheck` | `pnpm --dir workers/api exec wrangler deploy` |
| `ingress` | `/` | `pnpm --dir workers/ingress typecheck` | `pnpm --dir workers/ingress exec wrangler deploy` |
| `collector` | `/` | `pnpm --dir workers/collector typecheck` | `pnpm --dir workers/collector exec wrangler deploy` |

Workers Builds 在构建命令之前安装依赖。四个都使用根目录 `pnpm-lock.yaml` 与工作区，Wrangler 使用对应包锁定的版本。
四个生产 Worker 均启用构建缓存，生产版本只从 `main` 用 `wrangler deploy` 发布。
`collector` 的分支预览构建和非生产分支构建都关掉：它的 `CORE` Service Binding 指向生产 `api`，
预览版一跑就会往生产状态里写；非生产分支的默认命令还会把版本传到生产脚本上。
`ingress` 同理，两项都关：它的 `CORE` 指向生产 `api`，预览版收下的上报会直接写进生产状态；
`wrangler.toml` 的 `[previews.vars]` 另设了 `PREVIEW_WORKER`，万一有预览版本跑起来也只会拒收（上报 403、部署通知 404）。
`ingress` 没有 secret，公开变量与绑定全在它的 `wrangler.toml`，自定义域名 `ingest.homepage.lyjw.llc` 也写在那里：
Workers Builds 里 `wrangler deploy` 会直接接管挂在别的 Worker 上的自定义域名，见 [上报入口 README](../workers/ingress/README.md)「上线与域名」。
`collector` 由原 `playstation-reporter` 脚本改名而来（沿用它的 `PSN_NPSSO` secret 和 KV）；
它原来的构建设置（根目录 `workers/playstation-reporter`、npm 命令、监视路径）要改成本文这一行，
那个目录已经删除，npm 的 `package-lock.json` 也不再有。

`workers/dev-router` 只给本地 `pnpm dev:worker` 用，没有 `package.json`，不连 Workers Builds。

## 分支预览

`api` 已按 [Worker Previews](https://developers.cloudflare.com/workers/previews/) 的文档切过去：设置 → 构建里打开了 Worker 预览的构建。推 `main` 仍执行 `pnpm --dir workers/api exec wrangler deploy`，不换 `api.homepage.lyjw.llc`。其他分支执行预览命令 `node workers/api/scripts/deploy-preview.mjs`，里面跑的是 `wrangler preview`。Durable Object 每个 Preview 自动有自己的空库。

分支名里的 `/` 会收成短横线后再传给 `--name`，这样地址和 Vercel 预览写进页面的一致。文档允许自定义预览命令，只要实际执行的是 `wrangler preview`。

预览命令不直接读 `wrangler.toml`，而是按它生成一份临时的 `wrangler.preview.json`，交给 `wrangler preview --config`，跑完即删。与生产只差两处：

- 迁移：每个 Preview 的 Durable Object 是空库，wrangler 会把全部迁移从头上传。v1、v2 是从旧 `ingest` 搬数据的历史步骤，v1 里 `OnlineCounterRoom` 既是新建目标又是转移目标，从头执行会被拒（10021）。Preview 把这两步折成一步，直接新建 `LivePushRoom`、`StateHub`，标签仍用 `v2-split-online-counter`，之后新增的迁移原样追加。
- 兼容开关：多加 `global_fetch_strictly_public`。同账号 zone 上的域名默认绕过其上的 Worker 直连源站，`api.homepage.lyjw.llc` 是自定义域、没有源站，不加这个开关，`UPSTREAM_API_URL` 的请求一律 522，Preview 取不到生产数据。

`workers/api` 用 Wrangler `4.136.2`。v1 迁移里补了 `OnlineCounterRoom` 的 `new_sqlite_classes`，Wrangler 4 才能接受后面那条已经生效的删除；这个标签不会再次执行。单独的 `api-preview` Worker 已删除。

`feat/agent-status` 的地址是 `https://feat-agent-status-api.lyjw.workers.dev`。算法在 `scripts/preview-worker-name.mjs`，Vercel 预览构建用同一份。Preview 配置在 `workers/api/wrangler.toml` 的 `[previews.vars]`：`UPSTREAM_API_URL` 指向生产 API，生产已经返回 `ok: true` 的端点用生产的，生产没有的端点用本分支的。不挂 cron、生产域名、KV、D1，也不复制 Secret。存储导入直接拒绝；上报不经过 `api`（在 `ingress`，它不开预览）。MusicKit 令牌、歌词、动态封面转给生产，并带上浏览器的 `Origin`。空库第一次公开读取时只把初始化标记写成完成。WebSocket 转发生产房间的事件。

`api` 的监视路径不放宽，否则无关的 `main` 提交也会重新发布生产版本。只改了监视路径以外的文件的分支不会触发 Preview 构建。

Vercel 与 Workers Builds 并行，新分支第一次推送时 Vercel 常常先到。`pnpm build`（`scripts/build.mjs`）在 Vercel 预览构建里先轮询本分支 Preview 的 `/api/status/listening/now`，最多等 3 分钟：就绪就连它；等不到（Preview 还没发出来，或这个分支从没触发过 Preview 构建）这次构建连生产，页面和浏览器都用生产 API，下一次推送再重新判断。结果经 `PREVIEW_BACKEND_URL` 交给 `next.config.ts`，配置文件里不做网络等待。

PR 关闭时 `.github/workflows/preview-api-worker.yml` 执行 `wrangler preview delete`。仓库 Secret `CLOUDFLARE_API_TOKEN` 需要能管理这个 Worker 的 Preview。没配令牌时工作流跳过。

改过已有端点、而生产仍返回 `ok: true` 的计算，预览页看到的还是生产结果。写入路径不会在 Preview 的空库里发生，因为没有上报进来。

## 构建监视路径

路径相对于 Git 仓库根目录。Cloudflare 的末尾 `*` 覆盖该目录下的所有文件，包含子目录；除 `api` 外排除路径均为空。

- `api`：`workers/api/*`、`src/lib/*`、`shared/*`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`；排除 `shared/ingest/*`。
- `ingress`：`workers/ingress/*`、`shared/*`、`src/lib/*`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.json`。
- `collector`：`workers/collector/*`、`shared/*`、`src/lib/*`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.json`。

API 的共享状态代码变化必须触发发布。在线人数 Worker `online-counter` 2026-09-29 并回 api 的推送房间，仓库里已删；它的构建项目待在控制台手工删除，删之前每次推送都会留一条失败的构建。
上报的校验与收敛（`shared/ingest/`）只打包进 `ingress` 和 `collector`（后者只用 PlayStation 那一份）：`api` 的运行时只
`import type` 这里的命令类型（`eslint.config.mjs` 按规则挡住值导入），所以 `api` 排除这个目录，改校验不重新发布带
Durable Object 的 `api`、不断开页面的 WebSocket。命令的形状变了（新字段、新模块）要同时改 `workers/api/src/stores/` 的
commit 那一半，`api` 照样会因为自己的目录变化而发布；上线顺序是 `api` 先、`ingress` 后，契约只能加不能改，见 `shared/state-core.ts`。
上报入口还打包 `src/lib` 的收敛工具（`json`、`vibecoding-parse`、`trophies` 等）和 `shared/` 的契约（`state-core.ts`、`lag.ts`、
`credentials.ts`、`history-ingest.ts`），这些变化要触发它的发布。
采集 Worker 直接打包 `src/lib` 的取数模块和 `shared/` 的契约（`state-core.ts`、`lag.ts`、`collector.ts`），
这些变化同样要触发它的发布；D1 表结构归 `workers/api/migrations`，新表先在 api 那边 apply 再发布它。
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
