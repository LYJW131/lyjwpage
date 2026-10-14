# Workers 原生 Git 部署

> 类型：reference

Worker 的运行时配置在各目录的 `wrangler.toml`，Workers Builds 的连接、命令和监视路径需在 Cloudflare 控制台设置。下表是与仓库代码配套的配置；已核对的远端状态见 [仓库外事实](./ops-facts.md)。接入 `ai` 及聊天命名空间切换按 [AI Worker 首次迁移](./ai-worker-migration.md) 执行，提交代码不会自动配置连接、Secret 或监视路径。

GitHub Actions 负责 lint、类型检查、单测与 CodeQL，Worker 发布由 Cloudflare GitHub App 触发，构建状态通过 GitHub check run 回传。站点由 `site` Worker（根目录 `wrangler.jsonc`）的 Workers Builds 发布；ESA 首页刷新与 `version` 通知由 `.github/workflows/purge-esa.yml` 在 `Workers Builds: site` 的成功检查或手动完整 SHA 上执行。GitHub Pages 保持原生集成与现有工作流。

## 构建配置

生产分支为 `main`，根目录均为 `/`；共享根目录的 `pnpm-lock.yaml` 与工作区，Wrangler 版本以各包为准。

在 `workers/<名>` 里调 wrangler 一律带 `-c wrangler.toml`：wrangler 向上找配置时按文件名优先，根目录 `site` 的 `wrangler.jsonc` 会压过同目录的 `wrangler.toml`，不带 `-c` 的部署、`secret put`、D1 迁移都会落到 `site` 上。

| Worker | 构建命令 | 生产部署命令 | 分支预览命令 |
| --- | --- | --- | --- |
| `core` | `pnpm --dir workers/core typecheck` | `pnpm --dir workers/core exec wrangler deploy -c wrangler.toml` | `node workers/core/scripts/deploy-preview.mjs` |
| `ai` | `pnpm --dir workers/ai typecheck` | `pnpm --dir workers/ai exec wrangler deploy -c wrangler.toml` | 关闭 |
| `site` | `pnpm build` | `pnpm exec wrangler deploy` | `pnpm preview:deploy` |
| `ingress` | `pnpm --dir workers/ingress typecheck` | `pnpm --dir workers/ingress exec wrangler deploy -c wrangler.toml` | 关闭 |
| `collector` | `pnpm --dir workers/collector typecheck` | `pnpm --dir workers/collector exec wrangler deploy -c wrangler.toml` | 关闭 |

`ingress` 和 `collector` 的分支预览及非生产分支构建保持关闭：它们的 `CORE` 指向生产状态核心，预览写入会影响生产。`ai` 的也关闭：分支的 AI 代码随 core 的组合 Preview 一起发布，见「分支预览」。`workers/dev-router` 仅用于本地，不连接 Builds。

`core` 没有公开地址：不挂域名、关闭 `workers.dev`，`preview_urls` 保持打开给分支 Preview；生产请求只经 site 等 Worker 的 Service Binding 进来。AI 路径由 `shared/ai-paths.ts#AI_HTTP_PATHS` 限定，生产里由 site 经自己的 `AI_SERVICE` 原样转发到 `ai`，不缓存或聚合流式正文；core 的 `AI_SERVICE` 转发只在分支 Preview 与本地 `pnpm dev:worker` 里用到。`ai` 不配置生产域名，关闭默认 `workers.dev` 地址与 `preview_urls`。`PUBLIC_STATUS` 只绑定 core 的 `PublicStatus`，不是含写操作和凭据方法的 `StateCore`。

`site` 在根目录 `wrangler.jsonc`：`SITE_ENV=production`，渲染 `RenderedSite`、状态快照 `StatusSnapshot`、图片 `ImageVariants` 三个带平台缓存的入口，默认入口按 `src/lib/site-policy.ts#classifyGatewayRequest` 分流：`/api/*` 里的可滞后视图直接读 `LAG` KV（`shared/lag-views.ts`），Apple Music 的三条路径（`shared/apple-music-paths.ts#APPLE_MUSIC_HTTP_PATHS`）经 `COLLECTOR_SERVICE`、其余 `/api/*`（站点自己的 `/api/version` 除外）与 `/ws` 经 `CORE_SERVICE`、AI 路径与 `/mcp` 经 `AI_SERVICE` 原样转交，另有浏览器错误中转 `/relay`、`/image` 优化、`/img` R2 对象与静态资产；当前版本缺的 `/assets/*` 从 R2 存档读（`ASSET_ARCHIVE`，`src/lib/asset-archive.ts`），存档由 `scripts/build.mjs` 在 Workers Builds 里（`WORKERS_CI=1`）调 `scripts/archive-site-assets.mjs` 用构建令牌上传，没有令牌或上传失败只告警、不让构建失败。转交和直读只在 `SITE_ENV=production` 时进行：分支 Preview 去掉了 Service Binding 与 KV（`scripts/site-preview.mjs#sitePreviewConfig`），这些路径 307 到 `PUBLIC_BACKEND_URL` 的后端。绑定含 `PUBLIC_STATUS`（→ core `PublicStatus`）、`CORE_SERVICE`（→ core 默认入口）、`AI_SERVICE`（→ ai）、`COLLECTOR_SERVICE`（→ collector 默认入口）、KV `LAG`、`IMAGES`、R2 `IMAGE_OBJECTS` 与 `ASSET_ARCHIVE`（同一个桶 `lyjw-homepage`，存档在 `site-assets/` 前缀下，过期规则见 [仓库外事实](./ops-facts.md)）、`ASSETS` 与给 `/relay` 按 IP 限流的 `RELAY_LIMIT`；`upload_source_maps` 只上传 Worker 包的 source map（`vite.config.ts` 只给 ssr 环境出 map），浏览器包不出 map。core 侧经 `SITE_CACHE`（→ site `RenderedSite`）做私有标签失效，见 `shared/site-cache.ts`。生产域名切换在 Builds 之外执行，见 [ops-facts](./ops-facts.md) 的待办行。

切换顺序（远端完成到哪一步见 [仓库外事实](./ops-facts.md)）：

1. 合并前：`site` 先存在。按「禁区」的跨 Worker 契约例外，从 PR 分支手动 `wrangler deploy` 一次 `site`（`wrangler.jsonc` 不带路由、`workers_dev = false`，不接流量也不抢域名），core 的 `SITE_CACHE` 才能在合并后发布成功。再连 `site` 的 Workers Builds、设好构建环境变量，把 site 的 tag 与两站 Web Analytics 映射写进 `workers/collector/wrangler.toml` 的 `SITE_WORKER_TAG` / `SITE_ANALYTICS_SITES`。
2. 合并：core、ai、collector、ingress、site 由 Workers Builds 并行发布，此时 `lyjw.me` 仍是 Vercel 上合并前的最后一次生产部署；根目录 `vercel.json` 关掉 Vercel 的 Git 部署，合并后的提交不再在 Vercel 构建。并行发布的错代窗口是暂时的：新 ingress 早于新 collector 时部署通知回 `unknown job`（只记日志），旧前端请求已改名的部署端点得到 404，`page:<tag>` 失效打到还没接流量的 `site`。
3. 四个 Worker 与 `site` 的生产构建都成功后切域名：`wrangler.jsonc` 加 `lyjw.me` 的 `custom_domain` 路由推上 main，`site` 的 Builds 部署时由 wrangler 接管根记录（非交互部署直接覆盖指向 Vercel 的 CNAME；接管失败则部署失败，CNAME 原样留着）。ESA 回源仍是 `lyjw.me`，不用改。`purge-esa.yml` 会等 `/api/version` 变成合并提交；切换晚于它的等待上限时手动 `workflow_dispatch` 重跑。
4. 验收：两个域名的首页、`/api/version`、`/img` 的 Range、首屏缓存 HIT 与布局失效、部署卡片和访问量。回滚是从 `wrangler.jsonc` 撤掉路由、在控制台摘掉 `site` 的自定义域名，再把根 CNAME 改回 Vercel；Vercel 项目在验收前不删，待删清单见「待手工清理」。

无状态 DO 迁移。Worker 发布与平台缓存生效不原子，验收要看线上响应头，不能只看构建成功。

## 分支预览

[Cloudflare Preview 的 Service Binding 指向目标 Worker 的生产部署](https://developers.cloudflare.com/workers/previews/resources/#service-bindings)，不能用生产 Service Binding 配置连接同名分支。因此预览采用专用组合入口 `workers/core/src/preview-entry.ts`，在一个 Preview 内运行 core 与 ai，并注入本实例内的状态读取和请求转发。生产入口不导入这个组合模块。

只有 core 的非生产分支构建发布后端 Preview，parent 固定为 `core`，Preview 同时包含本提交的状态与 AI 代码。命名与地址算法在 `scripts/preview-worker-name.mjs`；分支名中的 `/` 收成短横线，过长时截断并带 hash。

`deploy-preview.mjs` 读取 core 的 `wrangler.toml`，生成临时 `workers/core/wrangler.preview.json`，执行 `wrangler preview` 后删除。它明确设置：

- `main` 为组合入口，parent 为 `core`；普通与预览的 `services` 都清空，不连生产 Service Binding。
- 空库迁移由 `scripts/preview-migrations.mjs#previewMigrations` 生成：生产的命名空间转移改成直接新建，组合入口要的 ai 类（`PREVIEW_ONLY_CLASSES`）随第一条迁移一起建，后续 core 迁移按原 tag 追加。
- `global_fetch_strictly_public`：让 `UPSTREAM_API_URL` 能访问同账号的生产自定义域，避免绕过 Worker 后返回 522。
- `PREVIEW_COMMIT_SHA` 为 Builds 当前提交；组合入口仅在 `PREVIEW_WORKER=true` 时工作，并提供 `PREVIEW_REVISION_PATH` 供构建校验。

预览绑定由 core 配置的 `[previews]` 段提供，状态、聊天与构建 DO 都是隔离空库，不挂生产域名、cron、KV 或 D1，也不复制 Secret。状态只读允许经 `UPSTREAM_API_URL` 按端点整份补缺，生产有 `ok:true` 的端点仍整份取生产；写入被隔离，上报入口不参加预览。测已有端点的新字段仍需本地注入夹具。

core 与 site 的 Preview 和生产同服务名，Workers Issues 的摘要只能按服务名数、分不出 Preview，所以两边的 Preview 只留日志与 traces，关掉 Issues：core 写在 `wrangler.toml` 的 `[previews.observability]`，site 由 `scripts/site-preview.mjs#sitePreviewConfig` 生成。查 Preview 的报错用遥测查询，按请求主机是 `*.workers.dev` 区分。

`scripts/build.mjs` 在预览构建里等待本分支 core Preview，`scripts/preview-backend.mjs#isMatchingPreview` 只接受 revision 与 `WORKERS_CI_COMMIT_SHA` 一致且状态读取就绪的地址。等待上限见 `WAIT_MS`；等不到匹配时构建直接失败，预览构建永不回退生产后端。选中的地址既是构建期的 `PREVIEW_BACKEND_URL`，也是运行时的预览后端，构建成功后冻结在 `build/site-preview.json`；`scripts/deploy-site-preview.mjs`（`pnpm preview:deploy`）只按这份冻结记录发布 `site` 的 Preview，不重查后端。预览构建强制清空 `PUBLIC_CF_WEB_ANALYTICS_TOKENS`，不带生产凭据。

为了让只改前端或只改 AI 的分支也有同提交后端可用，core 的非生产分支构建（Builds 配置里的 `previews_base_config`）另配包含路径：同时覆盖前端、状态与 AI 依赖（`src/*`、`shared/*`、`workers/core/*`、`workers/ai/*`、`workers/site/*`、`scripts/*`、`public/*`、`docs/explainer/v2/*`、根配置清单），只排除 ingress 独有的 `shared/ingest/*`；生产配置的监视路径不变。

站点 Preview 地址是 `<预览名>-site.lyjw.workers.dev`，由 Cloudflare Access 保护，访问者要先登录，没有免登录分享链接；应用与策略见 [仓库外事实](./ops-facts.md)。这个地址要 `site` 的 Worker 级 Preview URL 开关开着，而每次生产 `wrangler deploy` 都按 `wrangler.jsonc` 的 `preview_urls` 重写它（缺省为关），所以根配置必须写 `preview_urls: true`；关着时 `wrangler preview` 仍报成功，只是日志写「no active URLs」，PR 上也没有站点地址。PR 上带地址的「Deploying Preview」评论只有走 Builds Previews（`previews_enabled` 与 `previews_base_config`）的 Worker 才会发，旧版「非生产分支触发」只给构建状态表；core 与 site 都要走 Previews。只保护 `site` 的 Preview，不要开账号级保护，以免挡住 core 预览的构建就绪检查。`preview:deploy` 只在 site 的 Previews 构建变量 `SITE_PREVIEW_ACCESS_READY` 为 `true` 时执行，没确认 Access 生效前不要打开它。

AI 端点需要的 Secret 设在 core parent 的本分支 Preview 上：

```sh
pnpm --dir workers/core exec wrangler preview secret put CHAT_HISTORY_SECRET -c wrangler.toml --name <预览名> --worker-name core
```

其他所需变量见 `workers/ai/.dev.vars.example`。值从标准输入输入，不复制生产凭据；缺少密钥的聊天端点返回 503，MCP 公开状态工具仍可验证。

PR 关闭时 `.github/workflows/preview-core-worker.yml` 检出默认分支，用那里的 `workers/core/scripts/delete-preview.mjs` 清理 `core`、`site` 两个 parent 的分支 Preview，不执行 PR 里的代码。仓库 Secret `CLOUDFLARE_API_TOKEN` 需要能管理这两个 Worker 的 Preview；不存在的候选跳过，未配置令牌时不执行。分支删除只清理 Preview，不改生产 Worker。

## 构建监视路径

路径相对于仓库根目录，Cloudflare 的目录末尾 `*` 包含子目录。监视路径跟随生产运行依赖；分支 Preview 的触发路径见「分支预览」。

| Worker | 包含路径 | 排除路径 |
| --- | --- | --- |
| `core` | `workers/core/*`、`shared/*`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`scripts/preview-*` | `shared/ingest/*`、`shared/god-chat.ts`、`shared/god-chat-tiers.ts`、`shared/github-issue.ts`、`shared/build-routine.ts`、`shared/mcp.ts` |
| `ai` | `workers/ai/*`、`shared/ai-paths.ts`、`shared/god-chat.ts`、`shared/god-chat-tiers.ts`、`shared/github-issue.ts`、`shared/build-routine.ts`、`shared/mcp.ts`、`shared/http-origins.ts`、`shared/public-status.ts`、`shared/status-views.ts`、`shared/site.ts`、`shared/asset-url.ts`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`scripts/preview-*` | 无 |
| `site` | `src/*`、`shared/*`、`workers/site/*`、`scripts/*`、`public/*`、`docs/explainer/v2/*`、`.github/github-avatar.sha256`、`wrangler.jsonc`、`vite.config.ts`、`react-router.config.ts`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` | 无 |
| `ingress` | `workers/ingress/*`、`shared/*`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.json` | `shared/god-chat.ts`、`shared/god-chat-tiers.ts`、`shared/github-issue.ts`、`shared/build-routine.ts`、`shared/mcp.ts` |
| `collector` | `workers/collector/*`、`shared/*`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.json` | `shared/god-chat.ts`、`shared/god-chat-tiers.ts`、`shared/github-issue.ts`、`shared/build-routine.ts`、`shared/mcp.ts` |

AI 的提示词、SDK 使用和工具编排留在 `workers/ai`，仅面向浏览器的对话契约保留在所排除的共享文件。采集 Worker 调 ai 近况摘要入口的契约 `shared/digest.ts` 只被 ai type-import，不进 ai 的包含路径。公开路径单独定义在 `shared/ai-paths.ts`，路径变化仍触发 core；其他文件只重导出这些路径。eslint 阻止 core 的生产实现导入 AI 业务契约或运行时，防止排除路径后悄悄漏发。

core、site 的分支 Preview 走 Builds Previews：每个分支的 Preview 建立时复制一份当时的 `previews_base_config`，改基础配置不回写已有分支，要按 [仓库外事实](./ops-facts.md) 记的方式经 Builds API 逐份读改。

共享状态代码变化仍要发布 core。`shared/ingest/` 的校验只打包进 ingress，core 只能 type-import；命令形状变更要同时改 core 提交阶段，按被调用方先发布的顺序执行。增加共享依赖或移动文件时，同步核对包含与排除规则。

## 配置与验收

发布后核对该提交的 Cloudflare check run 与构建历史，再验证受影响的生产状态 API、WebSocket 或 AI 入口。构建成功不代表业务验收完成，不另加 GitHub Actions 发布同一个 Worker。

官方参考：[GitHub 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)、[构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[监视路径](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)。
