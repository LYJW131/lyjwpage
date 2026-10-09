# Workers 原生 Git 部署

> 类型：reference

Worker 的运行时配置在各目录的 `wrangler.toml`，Workers Builds 的连接、命令和监视路径需在 Cloudflare 控制台设置。下表是与仓库代码配套的配置；已核对的远端状态见 [仓库外事实](./ops-facts.md)。接入 `ai` 及聊天命名空间切换按 [AI Worker 首次迁移](./ai-worker-migration.md) 执行，提交代码不会自动配置连接、Secret 或监视路径。

GitHub Actions 负责 lint、类型检查、单测与 CodeQL，Worker 发布由 Cloudflare GitHub App 触发，构建状态通过 GitHub check run 回传。Vercel 和 GitHub Pages 保持各自原生集成与现有工作流。

## 构建配置

生产分支为 `main`，根目录均为 `/`；共享根目录的 `pnpm-lock.yaml` 与工作区，Wrangler 版本以各包为准。

| Worker | 构建命令 | 生产部署命令 | 分支预览命令 |
| --- | --- | --- | --- |
| `api` | `pnpm --dir workers/api typecheck` | `pnpm --dir workers/api exec wrangler deploy` | `node workers/api/scripts/deploy-preview.mjs --worker-name api` |
| `ai` | `pnpm --dir workers/ai typecheck` | `pnpm --dir workers/ai exec wrangler deploy` | `node workers/api/scripts/deploy-preview.mjs --worker-name ai` |
| `ingress` | `pnpm --dir workers/ingress typecheck` | `pnpm --dir workers/ingress exec wrangler deploy` | 关闭 |
| `collector` | `pnpm --dir workers/collector typecheck` | `pnpm --dir workers/collector exec wrangler deploy` | 关闭 |

`ingress` 和 `collector` 的分支预览及非生产分支构建保持关闭：它们的 `CORE` 指向生产状态核心，预览写入会影响生产。`workers/dev-router` 仅用于本地，不连接 Builds。

`api` 是现有公开 API 域名的入口，AI 路径由 `shared/ai-paths.ts#AI_HTTP_PATHS` 限定，经 `AI_SERVICE` 原样转发到 `ai`，不缓存或聚合流式正文。`ai` 不配置生产域名，关闭默认 `workers.dev` 地址；`preview_urls` 用于分支 Preview 的地址。`PUBLIC_STATUS` 只绑定 api 的 `PublicStatus`，不是含写操作和凭据方法的 `StateCore`。

## 分支预览

[Cloudflare Preview 的 Service Binding 指向目标 Worker 的生产部署](https://developers.cloudflare.com/workers/previews/resources/#service-bindings)，不能用生产 Service Binding 配置连接同名分支。因此预览采用专用组合入口 `workers/api/src/preview-entry.ts`，在一个 Preview 内运行 api 与 ai，并注入本实例内的状态读取和请求转发。生产入口不导入这个组合模块。

api 和 ai 的 Builds 都调用同一个预览脚本，各自发布到自己的 parent Worker。无论哪个触发，Preview 都包含本提交的状态与 AI 代码。它们的命名与地址算法在 `scripts/preview-worker-name.mjs`；分支名中的 `/` 收成短横线，过长时截断并带 hash。

`deploy-preview.mjs` 读取 api 的 `wrangler.toml`，生成临时 `workers/api/wrangler.preview.json`，执行 `wrangler preview` 后删除。它明确设置：

- `main` 为组合入口，parent 名为命令的 `--worker-name`；普通与预览的 `services` 都清空，不连生产 Service Binding。
- 空库迁移从 `PREVIEW_BASELINE` 开始，再创建聊天 DO；不重放生产的命名空间转移。
- `global_fetch_strictly_public`：让 `UPSTREAM_API_URL` 能访问同账号的生产自定义域，避免绕过 Worker 后返回 522。
- `PREVIEW_COMMIT_SHA` 为 Builds 当前提交；组合入口仅在 `PREVIEW_WORKER=true` 时工作，并提供 `PREVIEW_REVISION_PATH` 供构建校验。

预览绑定由 api 配置的 `[previews]` 段提供，状态与聊天 DO 都是隔离空库，不挂生产域名、cron、KV 或 D1，也不复制 Secret。状态只读允许经 `UPSTREAM_API_URL` 按端点整份补缺，生产有 `ok:true` 的端点仍整份取生产；写入和存储导入被隔离，上报入口不参加预览。测已有端点的新字段仍需本地注入夹具。

Vercel 和 Worker 构建并行。`scripts/build.mjs` 在预览构建里等待本分支 api、ai 两个候选地址，`scripts/preview-backend.mjs#findMatchingPreview` 只接受 revision 与 `VERCEL_GIT_COMMIT_SHA` 一致且状态读取就绪的候选。等待上限见 `WAIT_MS`；没有匹配时这次构建用生产，不能误用旧提交的 Preview。结果通过 `PREVIEW_BACKEND_URL` 传给 Next 配置。

AI 端点需要的 Secret 只设在实际使用的 parent 的本分支 Preview；例如 api parent：

```sh
pnpm --dir workers/api exec wrangler preview secret put CHAT_HISTORY_SECRET --name <预览名> --worker-name api
```

ai parent 使用 `--worker-name ai`，其他所需变量见 `workers/ai/.dev.vars.example`。值从标准输入输入，不复制生产凭据；缺少密钥的聊天端点返回 503，MCP 公开状态工具仍可验证。两个候选都存在时，要验证付费对话，直接使用已配置 Secret 的候选，或分别配置两份隔离密钥。

PR 关闭时 `.github/workflows/preview-api-worker.yml` 调 `delete-preview.mjs` 清理两个 parent 的分支 Preview；不存在的候选跳过，未配置清理令牌时不执行。分支删除只清理 Preview，不改生产 Worker。

## 构建监视路径

路径相对于仓库根目录，Cloudflare 的目录末尾 `*` 包含子目录。监视路径跟随生产运行依赖；组合 Preview 不要求两个 Worker 互相监视实现目录。

| Worker | 包含路径 | 排除路径 |
| --- | --- | --- |
| `api` | `workers/api/*`、`src/lib/*`、`shared/*`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`scripts/preview-*` | `shared/ingest/*`、`shared/god-chat.ts`、`shared/god-chat-tiers.ts`、`shared/github-issue.ts`、`shared/mcp.ts` |
| `ai` | `workers/ai/*`、`shared/ai-paths.ts`、`shared/god-chat.ts`、`shared/god-chat-tiers.ts`、`shared/github-issue.ts`、`shared/mcp.ts`、`shared/http-origins.ts`、`shared/public-status.ts`、`src/lib/status-views.ts`、`src/lib/site.ts`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`scripts/preview-*` | 无 |
| `ingress` | `workers/ingress/*`、`shared/*`、`src/lib/*`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.json` | `shared/god-chat.ts`、`shared/god-chat-tiers.ts`、`shared/github-issue.ts`、`shared/mcp.ts` |
| `collector` | `workers/collector/*`、`shared/*`、`src/lib/*`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.json` | `shared/god-chat.ts`、`shared/god-chat-tiers.ts`、`shared/github-issue.ts`、`shared/mcp.ts` |

AI 的提示词、SDK 使用和工具编排留在 `workers/ai`，仅面向浏览器的对话契约保留在所排除的共享文件。公开路径单独定义在 `shared/ai-paths.ts`，路径变化仍触发 api；其他文件只重导出这些路径。eslint 阻止 api 的生产实现导入 AI 业务契约或运行时，防止排除路径后悄悄漏发。

共享状态代码变化仍要发布 api。`shared/ingest/` 的校验只打包进 ingress，api 只能 type-import；命令形状变更要同时改 api 提交阶段，按被调用方先发布的顺序执行。增加共享依赖或移动文件时，同步核对包含与排除规则。

## 配置与验收

发布后核对该提交的 Cloudflare check run 与构建历史，再验证受影响的生产状态 API、WebSocket 或 AI 入口。构建成功不代表业务验收完成，不另加 GitHub Actions 发布同一个 Worker。

官方参考：[GitHub 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)、[构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[监视路径](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)。
