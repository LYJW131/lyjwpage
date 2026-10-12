# Workers 原生 Git 部署

> 类型：reference

Worker 的运行时配置在各目录的 `wrangler.toml`，Workers Builds 的连接、命令和监视路径需在 Cloudflare 控制台设置。下表是与仓库代码配套的配置；已核对的远端状态见 [仓库外事实](./ops-facts.md)。接入 `ai` 及聊天命名空间切换按 [AI Worker 首次迁移](./ai-worker-migration.md) 执行，提交代码不会自动配置连接、Secret 或监视路径。

GitHub Actions 负责 lint、类型检查、单测与 CodeQL，Worker 发布由 Cloudflare GitHub App 触发，构建状态通过 GitHub check run 回传。站点由 `site` Worker（根目录 `wrangler.jsonc`）的 Workers Builds 发布；ESA 首页刷新与 `version` 通知由 `.github/workflows/purge-esa.yml` 在 `Workers Builds: site` 的成功检查或手动完整 SHA 上执行。GitHub Pages 保持原生集成与现有工作流。

## 构建配置

生产分支为 `main`，根目录均为 `/`；共享根目录的 `pnpm-lock.yaml` 与工作区，Wrangler 版本以各包为准。

在 `workers/<名>` 里调 wrangler 一律带 `-c wrangler.toml`：wrangler 向上找配置时按文件名优先，根目录 `site` 的 `wrangler.jsonc` 会压过同目录的 `wrangler.toml`，不带 `-c` 的部署、`secret put`、D1 迁移都会落到 `site` 上。

| Worker | 构建命令 | 生产部署命令 | 分支预览命令 |
| --- | --- | --- | --- |
| `api` | `pnpm --dir workers/api typecheck` | `pnpm --dir workers/api exec wrangler deploy -c wrangler.toml` | `node workers/api/scripts/deploy-preview.mjs --worker-name api` |
| `ai` | `pnpm --dir workers/ai typecheck` | `pnpm --dir workers/ai exec wrangler deploy -c wrangler.toml` | `node workers/api/scripts/deploy-preview.mjs --worker-name ai` |
| `site` | `pnpm build` | `pnpm exec wrangler deploy` | `pnpm preview:deploy` |
| `ingress` | `pnpm --dir workers/ingress typecheck` | `pnpm --dir workers/ingress exec wrangler deploy -c wrangler.toml` | 关闭 |
| `collector` | `pnpm --dir workers/collector typecheck` | `pnpm --dir workers/collector exec wrangler deploy -c wrangler.toml` | 关闭 |

`ingress` 和 `collector` 的分支预览及非生产分支构建保持关闭：它们的 `CORE` 指向生产状态核心，预览写入会影响生产。`workers/dev-router` 仅用于本地，不连接 Builds。

`api` 是现有公开 API 域名的入口，AI 路径由 `shared/ai-paths.ts#AI_HTTP_PATHS` 限定，经 `AI_SERVICE` 原样转发到 `ai`，不缓存或聚合流式正文。`ai` 不配置生产域名，关闭默认 `workers.dev` 地址；`preview_urls` 用于分支 Preview 的地址。`PUBLIC_STATUS` 只绑定 api 的 `PublicStatus`，不是含写操作和凭据方法的 `StateCore`。

`site` 在根目录 `wrangler.jsonc`：`SITE_ENV=production`，渲染 `RenderedSite`、状态快照 `StatusSnapshot`、图片 `ImageVariants` 三个带平台缓存的入口，默认入口分流 MCP 转发、Sentry `/relay`、`/image` 优化、`/img` R2 对象与静态资产。绑定含 `PUBLIC_STATUS`（→ api `PublicStatus`）、`IMAGES`、R2 `IMAGE_OBJECTS`（`lyjw-homepage`）与 `ASSETS`；Sentry DSN 写在 `[vars]`，构建期 `SENTRY_AUTH_TOKEN` 配在 Builds 环境变量里，仅用于上传 sourcemap。api 侧经 `SITE_CACHE`（→ site `RenderedSite`）做私有标签失效，见 `shared/site-cache.ts`。生产域名切换在 Builds 之外执行，见 [ops-facts](./ops-facts.md) 的待办行。

切换顺序（远端完成到哪一步见 [仓库外事实](./ops-facts.md)）：

1. 合并前：`site` 先存在。按「禁区」的跨 Worker 契约例外，从 PR 分支手动 `wrangler deploy` 一次 `site`（`wrangler.jsonc` 不带路由、`workers_dev = false`，不接流量也不抢域名），api 的 `SITE_CACHE` 才能在合并后发布成功。再连 `site` 的 Workers Builds、设好构建环境变量，把 site 的 tag 与两站 Web Analytics 映射写进 `workers/collector/wrangler.toml` 的 `SITE_WORKER_TAG` / `SITE_ANALYTICS_SITES`。
2. 合并：api、ai、collector、ingress、site 由 Workers Builds 并行发布，此时 `lyjw.me` 仍是 Vercel 上合并前的最后一次生产部署；根目录 `vercel.json` 关掉 Vercel 的 Git 部署，合并后的提交不再在 Vercel 构建。并行发布的错代窗口是暂时的：新 ingress 早于新 collector 时部署通知回 `unknown job`（只记日志），旧前端请求已改名的部署端点得到 404，`page:<tag>` 失效打到还没接流量的 `site`。
3. 四个 Worker 与 `site` 的生产构建都成功后切域名：`wrangler.jsonc` 加 `lyjw.me` 的 `custom_domain` 路由推上 main，`site` 的 Builds 部署时由 wrangler 接管根记录（非交互部署直接覆盖指向 Vercel 的 CNAME；接管失败则部署失败，CNAME 原样留着）。ESA 回源仍是 `lyjw.me`，不用改。`purge-esa.yml` 会等 `/api/version` 变成合并提交；切换晚于它的等待上限时手动 `workflow_dispatch` 重跑。
4. 验收：两个域名的首页、`/api/version`、`/img` 的 Range、首屏缓存 HIT 与布局失效、部署卡片和访问量。回滚是从 `wrangler.jsonc` 撤掉路由、在控制台摘掉 `site` 的自定义域名，再把根 CNAME 改回 Vercel；Vercel 项目在验收前不删，待删清单见「待手工清理」。

无状态 DO 迁移。Worker 发布与平台缓存生效不原子，验收要看线上响应头，不能只看构建成功。

## 分支预览

[Cloudflare Preview 的 Service Binding 指向目标 Worker 的生产部署](https://developers.cloudflare.com/workers/previews/resources/#service-bindings)，不能用生产 Service Binding 配置连接同名分支。因此预览采用专用组合入口 `workers/api/src/preview-entry.ts`，在一个 Preview 内运行 api 与 ai，并注入本实例内的状态读取和请求转发。生产入口不导入这个组合模块。

api 和 ai 的 Builds 都调用同一个预览脚本，各自发布到自己的 parent Worker。无论哪个触发，Preview 都包含本提交的状态与 AI 代码。它们的命名与地址算法在 `scripts/preview-worker-name.mjs`；分支名中的 `/` 收成短横线，过长时截断并带 hash。

`deploy-preview.mjs` 读取 api 的 `wrangler.toml`，生成临时 `workers/api/wrangler.preview.json`，执行 `wrangler preview` 后删除。它明确设置：

- `main` 为组合入口，parent 名为命令的 `--worker-name`；普通与预览的 `services` 都清空，不连生产 Service Binding。
- 空库迁移由 `scripts/preview-migrations.mjs#previewMigrations` 折叠生产转移；Preview 专属迁移按 `PREVIEW_MIGRATIONS` 声明的位置插入，后续 api 迁移追加在已发布 tag 之后。
- `global_fetch_strictly_public`：让 `UPSTREAM_API_URL` 能访问同账号的生产自定义域，避免绕过 Worker 后返回 522。
- `PREVIEW_COMMIT_SHA` 为 Builds 当前提交；组合入口仅在 `PREVIEW_WORKER=true` 时工作，并提供 `PREVIEW_REVISION_PATH` 供构建校验。

预览绑定由 api 配置的 `[previews]` 段提供，状态、聊天与构建 DO 都是隔离空库，不挂生产域名、cron、KV 或 D1，也不复制 Secret。状态只读允许经 `UPSTREAM_API_URL` 按端点整份补缺，生产有 `ok:true` 的端点仍整份取生产；写入和存储导入被隔离，上报入口不参加预览。测已有端点的新字段仍需本地注入夹具。

`scripts/build.mjs` 在预览构建里等待本分支 api、ai 两个候选地址，`scripts/preview-backend.mjs#findMatchingPreview` 只接受 revision 与 `WORKERS_CI_COMMIT_SHA` 一致且状态读取就绪的候选；两份都是本提交时固定选 api：ai 先就绪时，在 `PREFERRED_GRACE_MS` 内反复重查 api（它常常晚到，之前还挂着旧提交）。只改了 AI 代码的分支没有 api 的新 Preview，会多等这一段再用 ai。等待上限见 `WAIT_MS`；等不到匹配时构建直接失败，预览构建永不回退生产后端。选中的地址既是构建期的 `PREVIEW_BACKEND_URL`，也是运行时的预览后端，构建成功后冻结在 `build/site-preview.json`；`scripts/deploy-site-preview.mjs`（`pnpm preview:deploy`）只按这份冻结记录发布 `site` 的 Preview，不重查后端。预览构建强制清空 `SENTRY_AUTH_TOKEN`、`GITHUB_TOKEN`、`PUBLIC_CF_WEB_ANALYTICS_TOKENS`，不上传 sourcemap、不带生产凭据。

为了让只改前端的分支也有同提交后端可用，api 的非生产分支构建（Builds 配置里的 `previews_base_config`）另配包含路径：包含路径同时覆盖前端与后端依赖（`src/*`、`shared/*`、`workers/api/*`、`workers/ai/*`、`workers/site/*`、`scripts/*`、`public/*`、`docs/explainer/v2/*`、根配置清单）；生产配置的监视路径不变。

站点 Preview 由 Cloudflare Access 保护：操作者在控制台 Workers & Pages → `site` → Access → Protect this Worker → Previews only 开启，或在 Access 应用的目的地里配 `{ type: "preview_worker", worker_id: <site Worker ID> }`，身份提供方按批准的名单配置；访问者打开预览链接要先登录，没有免登录分享链接。只保护 `site` 的 Preview，不要开账号级保护以免挡住 api/ai 预览的构建就绪检查。之后在 site 的非生产 Builds 里启用 Preview URL 并把 `SITE_PREVIEW_ACCESS_READY` 设为 `true`，`preview:deploy` 才会执行。这些全部是发布前待办，未在远端配置。

AI 端点需要的 Secret 只设在实际使用的 parent 的本分支 Preview；例如 api parent：

```sh
pnpm --dir workers/api exec wrangler preview secret put CHAT_HISTORY_SECRET -c wrangler.toml --name <预览名> --worker-name api
```

ai parent 使用 `--worker-name ai`，其他所需变量见 `workers/ai/.dev.vars.example`。值从标准输入输入，不复制生产凭据；缺少密钥的聊天端点返回 503，MCP 公开状态工具仍可验证。分支要试付费对话时把 Secret 设在 api parent 上：两份候选都在时预览选它；只改 AI 代码的分支没有 api 那份，Secret 设在 ai parent。

PR 关闭时 `.github/workflows/preview-api-worker.yml` 检出默认分支，用那里的 `workers/api/scripts/delete-preview.mjs` 清理 `api`、`ai`、`site` 三个 parent 的分支 Preview，不执行 PR 里的代码。仓库 Secret `CLOUDFLARE_API_TOKEN` 需要能管理这三个 Worker 的 Preview；不存在的候选跳过，未配置令牌时不执行。分支删除只清理 Preview，不改生产 Worker。

## 构建监视路径

路径相对于仓库根目录，Cloudflare 的目录末尾 `*` 包含子目录。监视路径跟随生产运行依赖；组合 Preview 不要求两个 Worker 互相监视实现目录。

| Worker | 包含路径 | 排除路径 |
| --- | --- | --- |
| `api` | `workers/api/*`、`src/lib/*`、`shared/*`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`scripts/preview-*` | `shared/ingest/*`、`shared/god-chat.ts`、`shared/god-chat-tiers.ts`、`shared/github-issue.ts`、`shared/build-routine.ts`、`shared/mcp.ts` |
| `ai` | `workers/ai/*`、`shared/ai-paths.ts`、`shared/god-chat.ts`、`shared/god-chat-tiers.ts`、`shared/github-issue.ts`、`shared/build-routine.ts`、`shared/mcp.ts`、`shared/http-origins.ts`、`shared/public-status.ts`、`src/lib/status-views.ts`、`src/lib/site.ts`、`src/lib/asset-url.ts`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`scripts/preview-*` | 无 |
| `site` | `src/*`、`shared/*`、`workers/site/*`、`scripts/*`、`public/*`、`docs/explainer/v2/*`、`.github/github-avatar.sha256`、`wrangler.jsonc`、`vite.config.ts`、`react-router.config.ts`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` | 无 |
| `ingress` | `workers/ingress/*`、`shared/*`、`src/lib/*`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.json` | `shared/god-chat.ts`、`shared/god-chat-tiers.ts`、`shared/github-issue.ts`、`shared/build-routine.ts`、`shared/mcp.ts` |
| `collector` | `workers/collector/*`、`shared/*`、`src/lib/*`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.json` | `shared/god-chat.ts`、`shared/god-chat-tiers.ts`、`shared/github-issue.ts`、`shared/build-routine.ts`、`shared/mcp.ts` |

AI 的提示词、SDK 使用和工具编排留在 `workers/ai`，仅面向浏览器的对话契约保留在所排除的共享文件。公开路径单独定义在 `shared/ai-paths.ts`，路径变化仍触发 api；其他文件只重导出这些路径。eslint 阻止 api 的生产实现导入 AI 业务契约或运行时，防止排除路径后悄悄漏发。

共享状态代码变化仍要发布 api。`shared/ingest/` 的校验只打包进 ingress，api 只能 type-import；命令形状变更要同时改 api 提交阶段，按被调用方先发布的顺序执行。增加共享依赖或移动文件时，同步核对包含与排除规则。

## 配置与验收

发布后核对该提交的 Cloudflare check run 与构建历史，再验证受影响的生产状态 API、WebSocket 或 AI 入口。构建成功不代表业务验收完成，不另加 GitHub Actions 发布同一个 Worker。

官方参考：[GitHub 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)、[构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[监视路径](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)。
