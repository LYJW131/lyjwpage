# PR 164 审查结论

> 类型：record。这是审查快照。按 c4ee8a5b0c96a6c20947e0e60e87536910bbed92 2026-10-11 核对，快照不维护，不当现状引用。代码结论对着 c4ee8a5b 与 b85d882，本文件提交在 6c13f51 之上。 <!-- allow: 审查快照的核对戳 -->

当前提交的树上已经没有的文件，只保留路径文字，不放进反引号。

# 结论

先不要合。

[PR 164](https://github.com/LYJW131/lyjwpage/pull/164)（分支 `devin/cloudflare-react-router`，base `main`）把展示层从 Next/Vercel 迁到独立的 `site` Worker。合进 `main` 之后，api、collector、ingress 会按各自的 Workers Builds 发布，而 `site` 目标、Builds 连接、域名切换、`SITE_WORKER_TAG`、`SITE_ANALYTICS_SITES` 在 `docs/workers-builds.md` 的切换顺序和 `docs/ops-facts.md`（2026-10-11 核对）里仍是未执行的发布前待办。

不依赖 `site` 是否已经建好、合入后就会生效的，是 `.github/workflows/purge-esa.yml` 改听还不存在的 `Workers Builds: site`，以及 collector 发布后旧任务空转、新任务因缺 `SITE_WORKER_TAG` / `SITE_ANALYTICS_SITES` 而跳过，部署列表和访问量停更。api 的 `SITE_CACHE` 指向尚未创建的 `site`：部署失败则生产 api 停在旧版本；先建 `site` 再发 api，则失效打不到仍由 Vercel 出的首页，`/api/status/vercel-deployments` 被删掉后现网卡片会 404。`LAG_KEYS` 是替换，api 与 collector 并行发布时读写不是同一代键。失败的 Vercel commit status 仍会挡住访客构建草稿，这一点在较新的 `b85d882` 上还在。

下面阻塞 6 条，应修 11 条。文档与代码冲突单独列出，不计入这两类。

# 审查范围

多数结论对着 `c4ee8a5b`（完整 `c4ee8a5b0c96a6c20947e0e60e87536910bbed92`）。`workers/ai` 的类型检查和该目录的复核对着 `b85d882`（完整 `b85d882cbf7d78bd16679bbd38ce66a35e0c01ee`）。

`b85d882` 相对 `c4ee8a5b` 只改了三处：`workers/ai/src/build-signals.test.ts` 里 `assert.equal` 的 message、`docs/workers-builds.md` 的 site 监视路径（加上 `.github/github-avatar.sha256`），以及 `apps/ios` 与 `docs/ios-app-handoff.md`。类型检查和 AI 复核核对了其中的测试文件：`workers/ai/src/build/github.ts` 和 `workers/ai/src/build/handlers.ts` 在这两次提交之间没有改，TS2345 已经消失，Vercel status 进 CI 的问题还在。监视路径和 `apps/ios` 不在那二十份结论的改动清单里，这里只作为两次提交的差别记下，没有另作行为结论。`docs/ios-app-handoff.md` 的冲突来自 Devin 的评论，写在文末「文档与代码冲突」。

`c4ee8a5b` 相对 `origin/main`：174 个文件，+5692/−3170。`gh pr view --json files` 只返回前 100 条路径，分组以 `git diff --stat` / name-status 为准。`reporters/` 无改动。

按目录：

- 站点 `src`（87）：React Router SSR。新增 `src/app/root.tsx`、`routes.ts`、`entry.client.tsx`、`entry.server.tsx`、`src/server/site-context.ts`、site-asset.ts。删除 layout.tsx、error.tsx、global-error.tsx、instrumentation.ts、sentry.server.config.ts，以及 src/app/api/revalidate/route.ts。Vercel 部署/指标读取换成 `src/lib/site-deployments.ts`、`src/lib/site-analytics.ts`。
- `workers/site`（2，新运行时）：`workers/site/src/index.ts`、`workers/site/src/sentry.ts`，根上 `wrangler.jsonc`（`name = site`）。
- `workers/api`（11）：`expireStatusTags` 改走 `SITE_CACHE`；`ALLOWED_ORIGINS` 收窄；freshness 改读 site 馈源。
- `workers/ai`（12）：删除 src/build/preview-share.ts；`sitePreview` 只认 `Workers Builds: site`。
- `workers/ingress`（3）：`DEPLOYMENT_JOBS` 改为 `site-deployments`（仍含 `cloudflare-deployments`）。
- `workers/collector`（13）：删除 src/jobs/vercel.ts；新增 `workers/collector/src/jobs/site-status.ts`；src/jobs/retired.ts 把旧任务固定为 `skipped`。
- `shared`（4）：`shared/site-cache.ts`、`shared/collector.ts`、`shared/lag.ts`、`shared/build-routine.ts`。`shared/state-core.ts`、`shared/public-status.ts` 无 diff。
- `docs`（9）加 CI 的 `.github/workflows/purge-esa.yml`。相邻脚本：`scripts/site-preview.mjs`、`scripts/deploy-site-preview.mjs`、`scripts/site-deploy-event.mjs`、`scripts/fixtures/site-cache.mjs`。

## 核对后没有另立问题的范围

站点 `src/` 的状态合并和数据变换：部署解析与 Workers Builds 字段一致（`created_on`，`status` 为 queued/initializing/running/stopped，`build_outcome` 为 success/fail/cancelled/terminated/skipped）。活跃部署取 `deployments[0]`。分流流量不编造单一 production。404 降级与上游失败抛出的契约留在 `SiteServices`。图片来源、重定向、体积上限、Sentry 信封和查询串脱敏按现有测试约定成立。

界面：这次 diff 没有新增可滚动容器。`god-chat.tsx` 的消息列表、会话列表、输入框仍同时有 `scrollbar-none` 和 `[&::-webkit-scrollbar]:hidden`；会话列表仍是 `snap-y snap-mandatory` / `snap-start`。新增可见文案是英文。响应式断点（`sm:` / `lg:`、`SLOT`）没有新问题。错误页标题和预览登录提示另见应修、可后续。

上报器：三方 diff 的 `reporters/` 为空。`reporters/mac-telemetry-hub` 两边都是 `99bed2409f1c36f22a03649d8695adbf106f86a9`，`.gitmodules` 未改。`git merge-tree` 的合并树里 `reporters/` 与 `origin/main` 无差异。main 在分叉之后的 Devin 用量上报（`854d4488`、`af3612ef`）会留在合并结果里。

安全：没有入库密钥、鉴权绕过、ingest 来源放宽、注入或过度暴露。`workers/ingress/wrangler.toml` 的 `ACCESS_CLIENTS` 和 `shared/ingest/` 未改。`/api/internal/site-deployed` 仍要求 `internal:site-deployed`。公共 `fetch` 不暴露 `invalidate`。`scripts/site-preview.mjs` 丢掉生产 service、R2、KV、D1、DO。`SITE_PREVIEW_ACCESS_READY` 只挡住 `pnpm preview:deploy`，不代替 Access，也不生成免登录链接。`src/lib/image-proxy.ts` 只允许 https 和白名单主机，拒绝用户信息、非 443、localhost 和 IP 字面量。`/img` 只接受 64 位十六进制对象键。`src/lib/sentry-tunnel.ts` 只把信封转到与配置 DSN 一致的地址。`parseSiteBuild` 不带出 `environment_variables`、令牌或预览 URL。

部署配置本身：生产监视路径盖住了 `c4ee8a5b` 要发布的运行时改动。`.github/workflows/ci.yml` 的门禁清单（lint、typecheck、workspace_tests、script_tests、docs）没有漏掉这次的代码范围。站点 `pnpm build` 不在 `ci.yml` 里，构建在 site 的 Workers Builds，与门禁清单一致。`shared/collector.ts` 的 `CollectorRpc.refresh` 签名未改。Durable Object 迁移链、`LivePushRoom` / `StateHub`、`liveRoom` 的 `ROOM_ID` 与 `locationHint` 未改。预览段没有 `SITE_CACHE`，预览 api 不会把生产首页标 stale。`CRON_SCHEDULE` 未改。`SITE_DEPLOYMENTS_STALE_MS`（10 分钟）对上每 1 分钟采集，`SITE_ANALYTICS_STALE_MS`（1 小时）对上每 15 分钟。缺键不告警是原逻辑。

禁区五项没有违规：没有新的 `"use server"`；diff 没有加 GitHub Actions 里的 `wrangler deploy` 发布步骤（`scripts/deploy-site-preview.mjs` 调用的是 `wrangler preview`）；公开路径已换成 `/api/status/site-deployments`，旧实现文件已删；新增的中日文在 `shared/build-routine.ts` 的 `PLAN_LABELS`，跟随计划语言；变更里只有 `.env.example` 与 `.dev.vars.example` 一类样例。`COLLECTOR_JOBS` 里留下的旧任务名见应修第 7 条：文档对照把它视为空名额，契约对照仍要求修。

# 合入就会出问题的

## 1. 首屏失效离开仍在出页面的 Vercel，api 发布依赖尚未创建的 site

涉及缓存、部署。

**文件**

- `workers/api/src/live-platform.ts` 的 `expireStatusTags`
- `workers/api/wrangler.toml` 的 `SITE_CACHE`
- `workers/api/src/runtime.ts`（去掉 `SITE_URL`、`REVALIDATE_SECRET`，加上 `SITE_CACHE?: SiteCacheRpc`）
- src/app/api/revalidate/route.ts（已删）
- `shared/site-cache.ts` 的 `SiteCacheRpc.invalidate`
- `workers/site/src/index.ts` 的 `RenderedSite`

**现在的行为**

布局变化后的失效只调用 `SITE_CACHE.invalidate`。生产绑定是 `[[services]] binding = "SITE_CACHE" service = "site" entrypoint = "RenderedSite"`。标签先过 `STATUS_TAGS` / `filterStatusTags`。调用链里没有对 `/api/revalidate` 的 `fetch`，也没有回退。

`StateCore.commitIngest` 仍先落库，再在 `waitUntil` 里失效。失效失败不改 202，只打 `[revalidate]` 日志。已落库的上报不会重发。

`workers/api/wrangler.toml` 落在 api 的生产监视路径 `workers/api/*` 里。合入 `main` 会让 api 的 Workers Builds 执行 `pnpm --dir workers/api exec wrangler deploy`，并带上这条绑定。文档要求先有 `site` 目标，再配调用方。

**影响**

`site` 按仓库外事实还没建。Cloudflare 的 service binding 要求目标 Worker 已经存在，否则这次部署失败，生产 api 停在旧版本，这次 api 改动上不了生产。若先建 `site` 再发 api，发布会成功，但 `lyjw.me` 仍由 Vercel 出首页，失效请求到不了它。本 PR 已删掉 src/app/api/revalidate/route.ts，新的 Vercel 构建上也没有这条路由。

部署成功时，充电头亮灭、在听 hero、开播停播这类布局变化不再把线上首页标 stale，只能等源站 SWR 自己过期。页面会一直旧，上报仍是 202。

预览段没有 `SITE_CACHE`。这条绑定的问题在生产 api，不在预览把生产首页标 stale。

**依据**

`expireStatusTags` 里没有指向 `/api/revalidate` 的 `fetch`。`docs/ops-facts.md` 待上线行：未创建 `site` 目标、未切域名。`docs/workers-builds.md` 的切换顺序和 `AGENTS.md` 的部署流程写明这些步骤还没做。部署没有实际执行，没有失败日志。

## 2. 公开路径改名，现网卡片仍请求旧地址

涉及契约。

**文件**

- `src/lib/status-views.ts` 的 `STATUS_VIEWS`（api 经 `workers/api/src/public-api.ts` 的 `serveStatus` / `viewKeyByPath` 分发）
- `workers/api/README.md` 的 `/api/status/site-deployments`
- `workers/api/src/freshness-watch.ts` 的 `LAG_FEEDS`

**现在的行为**

`/api/status/vercel-deployments` 从登记表删除，换成 `/api/status/site-deployments`。`viewKeyByPath("/api/status/vercel-deployments")` 为 `undefined`。`siteDeployments.path` 为 `/api/status/site-deployments`。未知路径 `serveStatus` 返回 null，`publicResponse` 回 `Not found` 404。

新 api 的 cron 读 `LAG_KEYS.siteDeployments` / `siteAnalytics`，不读 `vercel-deployments:v1` / `vercel-metrics:v1`。`watchFreshness` 对读不到的来源不下结论，所以新 api 不会把「缺新键」报成断流，也不会再报旧 Vercel 馈源变陈旧。

同一把新键上的公开 JSON 也换了形：旧载荷的 `metrics`（函数次数加上 `analytics.pageviews` / `visitors`）换成 `analytics`（只剩 `pageviews` 与 `hosts`）。`src/components/live/site-status-card.tsx` 已改读 `analytics.pageviews`。仓库内没有残留的部署载荷 `metrics` 读取。`pageviews` 仍是次数。该视图本来就没有推送事件，这次也没有。

**影响**

api 一发布，仍在 Vercel 上的现网前端继续请求 `/api/status/vercel-deployments`，部署卡片 404。新端点要等 collector 写出 `site-deployments:v1` 才有数据，而 `SITE_WORKER_TAG` / `SITE_ANALYTICS_SITES` 本轮未设（见第 3 条）。冒烟时生产 API `GET /api/status/site-deployments` 已经是 404，那是生产还没有这条路径；合入之后变成现网前端打旧路径 404。

**依据**

`publicResponse` 对未登记路径返回 404。`workers/api/dev-fixtures/` 里仍留着 `vercel-deployments-stale.json`，旧端点没了，夹具不会被线上读到。`workers/api/dev-fixtures/site-deployments.json` 外形与 `SiteDeploymentsPayload` 相符。

## 3. 采集任务空转，部署列表和访问量在发布后停更

涉及采集、部署。

**文件**

- `workers/collector/wrangler.toml` 的 `[vars]`
- `workers/collector/wrangler.test.toml`
- workers/collector/src/jobs/retired.ts
- `workers/collector/src/jobs/site-status.ts` 的 `siteDeploymentsJob`、`siteAnalyticsJob`
- `workers/collector/src/env.ts` 的 `settings()`
- `workers/collector/README.md` 配置节
- `workers/ingress/src/worker.ts` 的 `DEPLOYMENT_JOBS`、`refreshDeployments`
- `workers/collector/src/history.ts` 的 `siteDeployStatements`（入参从 `VercelDeployment` 换成 `SiteDeployment`，仍 UPSERT `site_deploys`）

**现在的行为**

`vercel-deployments` / `vercel-metrics` 的 `run` 固定 `{ status: "skipped" }`，detail 为 `Retired deployment provider`，任意 env 下都不读 Vercel。

新任务 `site-deployments`（每分钟）和 `site-analytics`（每 15 分钟）需要 `SITE_WORKER_TAG`、`SITE_ANALYTICS_SITES`。README 写明它们是 `[vars]`，缺了就跳过、不算故障。生产和测试的 `wrangler.toml` 都没有这两项，也没有 `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID`；`[vars]` 里只剩 `CLOUDFLARE_ACCOUNT_ID`。

生产上 `CLOUDFLARE_METRICS_TOKEN` 仍是既有 Secret（`cloudflare-deployments` 还在用），所以会走到「只缺 tag / 只缺站点映射」的跳过：不拉数，不写 `LAG site-deployments:v1`、`LAG site-analytics:v1`，也不 `archiveSiteDeploys`。缺 `SITE_WORKER_TAG` 时 detail 为 `missing SITE_WORKER_TAG`；缺 `SITE_ANALYTICS_SITES` 时为 `missing SITE_ANALYTICS_SITES`。

`POST /api/internal/site-deployed` 已改为 `Collector.refresh(["site-deployments", "cloudflare-deployments"])`。`DEPLOYMENT_JOBS` 与 `shared/collector.ts` 里的任务名一致。`refreshDeployments` 只在 `outcome.status === "error"` 时打日志，`skipped` 被当成成功，回执仍是 `{ ok: true }`。

上报入口没有动：`ACCESS_CLIENTS`、`shared/ingest` 来源清单、鉴权顺序都没有改。接不上数是跳过，不是入口指错任务。

**影响**

合进 `main` 后，Workers Builds 会发布一个不再写下部署与访问量的 collector。部署列表和站点访问量停更。`docs/workers-builds.md` 写明验收前不撤 Vercel，并把补上这两个变量列为未执行的发布前待办。`docs/ops-facts.md` 2026-10-11 的核对写明远端还没配这两项。

**依据**

在该分支上读 `workers/collector/wrangler.toml` 的 `[vars]`：`SITE_WORKER_TAG`、`SITE_ANALYTICS_SITES`、`VERCEL_PROJECT_ID`、`VERCEL_TEAM_ID` 均为缺席，`CLOUDFLARE_ACCOUNT_ID` 仍在。retired.ts 两个旧任务在任意 env 下都返回 `Retired deployment provider`。

## 4. lag 键被换掉，并行发布时读写不是同一代

涉及契约、采集、部署。

**文件**

- `shared/lag.ts` 的 `LAG_KEYS`
- 写：`workers/collector/src/jobs/site-status.ts`
- 读：`src/lib/site-deployments.ts`、`workers/api/src/freshness-watch.ts` 的 `LAG_FEEDS`
- workers/collector/src/jobs/retired.ts
- `workers/ingress/src/worker.ts` 的 `DEPLOYMENT_JOBS`
- `workers/collector/src/registry.ts`（未知任务名返回 `unknown job`）

**现在的行为**

`LAG_KEYS` 是替换，不是另加一把新键再双写、双读：

- `vercelDeployments: "vercel-deployments:v1"` 换成 `siteDeployments: "site-deployments:v1"`
- `vercelMetrics: "vercel-metrics:v1"` 换成 `siteAnalytics: "site-analytics:v1"`

仓库内已经没有残留的 `LAG_KEYS.vercel*`。旧任务不再写旧键。新任务只写新键。

api、collector、ingress、site 的监视路径都包含 `shared/*`（`shared/lag.ts` 不在排除列表），Workers Builds 会并行发布。契约说明里的发布顺序是先切 api 的 `SITE_CACHE`，再发 collector，读端会先于写端上线。并行发布时两种先后都会出现：

- collector 先就绪：旧 api 的 freshness 仍读 `vercel-deployments:v1` / `vercel-metrics:v1`，退役任务已经不再写它们。超过 `SITE_DEPLOYMENTS_STALE_MS` / `SITE_ANALYTICS_STALE_MS` 后会报 `Feed stale`。
- api 先就绪：freshness 读新键。读不到按 `watchFreshness` 的约定不下结论，但 `/api/status/site-deployments` 在 collector 写出新键之前是空的。`freshness-watch:v1` 里旧的 `vercel-*` 键会留在 blob 里，新循环不再读它们，不会误发 recovered。
- 新的 ingress 去 `refresh("site-deployments")`，旧 collector 回 `unknown job`。`refreshDeployments` 只把 `error` 打成警告，版本广播仍然成功，回执仍 200。

两边都换成新代码之后，这个错代窗口结束。窗口结束以后若变量仍缺，停更仍由第 3 条继续。

**影响**

切换窗口里，要么误报采集断流，要么部署通知刷不到新任务，要么新站点的部署快照是空的。这是 collector 写入、api 与站点读取的同一份 KV 契约。

**依据**

`shared/lag.ts` 的四个字符串如上。`workers/ingress/src/worker.ts` 的 `DEPLOYMENT_JOBS` 是 `["site-deployments", "cloudflare-deployments"]`。部署审查没有执行发布，没有一份真实的错代日志；结论来自监视路径会并行发布，以及两边代码各读各写的键。

## 5. ESA 刷新和版本通知不再跟着 Vercel 生产部署走

涉及部署。

**文件**

- `.github/workflows/purge-esa.yml`
- `scripts/site-deploy-event.mjs` 的 `siteDeploymentSha`

**现在的行为**

工作流去掉了 `deployment_status`（Vercel Production 成功）。现在只在 `check_run` 同时满足 `app.slug == cloudflare-workers-and-pages`、`name == Workers Builds: site`、`conclusion == success`、`head_branch == main` 时跑，再由 `siteDeploymentSha` 决定是否刷 ESA 和通知 `/api/internal/site-deployed`。

这份工作流在默认分支上就会接事件，不依赖 `site` Worker 是否已经建好。`deployment` job 跑 `scripts/site-deploy-event.mjs`，再等 `https://lyjw.me/api/version`。`purge` 仍清 ESA，目前仍只刷新 `https://lyjw131.com/`。`notify` 仍用 `ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET` POST 版本通知。域名未在时限内切到目标 SHA 会失败退出。并发组不取消正在跑的那次。`/api/version` 保持 `max-age=0, must-revalidate`。手动 `workflow_dispatch` 还在。

**影响**

合入后，现有 Vercel 生产部署不再触发 ESA 刷新和 `version` 通知。替代检查名 `Workers Builds: site` 还没有对应的 Builds。`workflow_dispatch` 不能代替这条自动路径。`docs/workers-builds.md` 写明切换顺序未执行，验收前不撤 Vercel。`docs/ops-facts.md` 2026-10-11 的核对写明尚未创建或核验 `site` Worker 目标与 Builds 连接，也未切域名。

**依据**

工作流条件与 `scripts/site-deploy-event.mjs` 的 SHA 选择。监视路径审查确认 `purge-esa.yml` 本身不在任何 Worker 的生产包含路径里，合入后生效的是 GitHub 上的工作流，不是 Worker 发布。

## 6. 失败的 Vercel commit status 仍会挡住访客构建草稿

**文件**

- `workers/ai/src/build/github.ts` 的 `ciState`、`aggregateState`
- `workers/ai/src/build/handlers.ts` 的 `handleBuildStatus`、`markBuildReady`、`markPullRequestReadyForReview`

**现在的行为**

`c4ee8a5b..b85d882` 没有改这两个文件。`ciState` 仍是 `statuses.map((item) => item.state)`，不过滤 context。context 为 `Vercel`、state 为 `failure` 时，`aggregateState` 得到 `failure`。

`handleBuildStatus` 仍只在 `state.ci?.state === "success"` 时调用 `markBuildReady`。`markBuildReady` 仍要求 `run.state.ci?.state === "success"`，并且再次要求 `ciState(checks, statuses.statuses) === "success"`，否则返回 `null`，草稿不会 `markPullRequestReadyForReview`。

同一次复核里，TS2345 已经不在：`workers/ai/src/build-signals.test.ts` 三处 `assert.equal` 的 message 从 `conclusion` 改成 `conclusion ?? status`。在 `b85d882` 上 `pnpm --dir workers/ai exec tsc --noEmit --pretty false` 退出码 0，输出里没有 TS2345。

**影响**

访客构建草稿在 CI 聚合里仍会因为一条失败的 Vercel commit status 标不成可审。验收前 Vercel 不撤，这条 status 还会继续出现。

**依据**

上述三个函数的条件。类型检查只证明 message 的类型错误消失，没有改 `ciState` 的过滤。

# 合入后行为不对的

## 1. 路由错误页丢掉了文档标题

**文件：** `src/app/root.tsx` 的 `PageError`（从已删除的 src/app/error.tsx 搬来）。

**现在的行为：** 旧页有 `<title>Something went wrong — ${site.name}</title>`。新的 `PageError` 没有 `<title>`，也不改 `meta()`。页内「Something went wrong」仍是 `div`。Retry、Back to home 和 `sm:` 内边距还在。

**影响：** 路由渲染失败时，标签页和读屏仍报原页面标题（首页是 `LYJW's Homepage`）。

**依据：** 与已删除的 src/app/error.tsx 对照。404 标题是另一件事，写在冒烟一节：界面审查没有把它单列为应修。

## 2. MusicKit 允许来源在预览切走之前就收窄了

**文件：** `workers/api/wrangler.toml` 的 `[vars].ALLOWED_ORIGINS` 与 `[previews.vars].ALLOWED_ORIGINS`；校验在 `workers/api/src/origin-worker.ts` 的 `handleMusicKitToken` / `isAllowedOrigin`。测试 `workers/api/src/musickit-token.test.ts`。

**现在的行为：** 生产名单去掉 `https://*.vercel.app`，只留 `https://lyjw131.com`、`https://lyjw.me`、`https://dev.lyjw.me`。预览名单改成 `https://*.lyjw.workers.dev`。站点 Preview 与 Access 仍是未配置待办，现网预览源站还是 `*.vercel.app`。`musickit-token.test.ts` 仍把生产名单写成 `https://*.vercel.app`，不读 `wrangler.toml`。

**影响：** `lyjw.me` / `lyjw131.com` 的一起听令牌还在。`Origin: https://<branch>.vercel.app` 请求 `GET /api/musickit/token` 时，两份名单上 `isAllowedOrigin` 都为 false，`handleMusicKitToken` 返回 403「来源不在允许的域名内」。把后端指到分支预览同样 403。

**依据：** 两份 `ALLOWED_ORIGINS` 与 `isAllowedOrigin`。安全审查确认生产名单去掉 `*.vercel.app` 本身没有鉴权绕过；这条是预览来源被提前拒绝。

## 3. 布局失效是软失效，下一份首页仍会带上旧内容

涉及缓存。

**文件**

- `src/lib/site-policy.ts` 的 `HOME_CACHE_CONTROL`、`STATUS_CACHE_CONTROL`、`statusSnapshotHeaders`、`renderCacheHeaders`
- `workers/site/src/index.ts` 的 `RenderedSite.invalidate`、`StatusSnapshot.invalidate`、`services.status`
- 已打开页面的旁路：`src/lib/status-reads.ts` 的 `fetchStatus`（`cache: "no-store"`，直连 `PUBLIC_BACKEND_URL`）

**现在的行为**

两处失效都调用 `ctx.cache.invalidate`，没有 `purge`。首页是 `public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400`。状态快照是 `max-age=600`，再加上约 7 天的 `stale-while-revalidate` / `stale-if-error`（故障信封那条写明的成功头是 `public, max-age=600, stale-while-revalidate=604200, stale-if-error=604200`）。两条响应都没有 `ETag` 或 `Last-Modified`，`invalidate` 的 304 捷径不会发生。

Workers 缓存对带 `stale-while-revalidate` 的过期条目会立刻返回旧正文（`Cf-Cache-Status: UPDATING`），回源在后台进行。首页后台重建调用 `StatusSnapshot.fetch` 时，拿到的是刚刚标 stale 的旧快照，并把它写成新的首页文档，`max-age=300` 重新起算。快照自己的后台回源随后更新，但这份新 HTML 已经是新鲜的，要再过一个首页新鲜窗口才会再读快照。

重验证若得到 5xx，`stale-if-error` 会继续发旧正文：首页最长约 1 天，状态快照约 7 天。

快照带 `Cache-Tag: page:<tag>`，首页文档与 `/_.data` 为 `home`。失效同时打这两层。`/api/version` 保持 `max-age=0, must-revalidate`。上游 5xx 用 `no-store`，并有 `stale-if-error`。Sentry `withSentry`（`@sentry/cloudflare@10.75.2`）仍会调用 `invalidate`。入口缓存按 `wrangler.jsonc` 只开在 `RenderedSite` / `StatusSnapshot` / `ImageVariants`。

**影响**

标签失效不能让下一次首页重建带上新布局。新访客、无脚本客户端和 ESA 回源会再看到约 300 秒的旧首屏。若 ESA 正好在这个窗口回源，边缘会把这份旧 HTML 再缓存一个 `max-age`。5xx 时旧正文可以留到 `stale-if-error` 窗口结束。已打开页面仍经 `fetchStatus` 和推送更新，不受这份 HTML 限制。

这是用来换掉 Vercel `revalidate` 的路径。第 1 条是失效根本到不了现网 Vercel；这一条是 `site` 自己接过流量之后，软失效仍对不上「布局变了就要换首屏」。

**依据**

`HOME_CACHE_CONTROL` / `STATUS_CACHE_CONTROL` 的指令，以及 `RenderedSite.invalidate` 先标 `page:<tag>` 和 `home` 再让带 SWR 的缓存回源。没有一份线上 `Cf-Cache-Status` 抓包；行为来自这两处实现和 Workers 缓存对 `stale-while-revalidate` 的处理。

## 4. 故障信封和上游 404 被当成成功快照写进缓存

涉及缓存、契约。

**文件**

- `workers/site/src/index.ts` 的 `StatusSnapshot.fetch`
- `src/lib/api.ts` 的 `statusEnvelope` / `statusResponse`
- `src/lib/site-policy.ts` 的 `isPublicStatusEnvelope`、`statusSnapshotHeaders`
- `src/lib/first-screen.ts`
- `src/lib/status-views.ts`

**现在的行为**

公开状态的 loader 异常和 `AwaitingReport` 被收成 HTTP 200 的 `{ok:false, error}`。`statusResponse` 固定 HTTP 200。`isPublicStatusEnvelope` 接受 `{ok:false, error}`。`StatusSnapshot` 只在上游不是 2xx 时回 503 + `no-store`。200 且信封合法（含 `ok:false`）就用 `statusSnapshotHeaders(200, tag)` 存起来，缓存头是 `public, max-age=600, stale-while-revalidate=604200, stale-if-error=604200`。

上游 404 同样改写成 200，并带上同一条成功缓存头。`first-screen.ts` 写明上游故障必须抛出，才能留住上一份首屏缓存，只有未部署端点的 404 才降级成空卡片。首页 loader 看到 `ok:false` 不会抛，整页仍是 200。

`githubChart`、`githubRepo`、`cloudflareWorkers`、`siteDeployments`、`sentry`、`reporters`、`pulse` 没有 `tag`。标签失效清不到这些快照。

客户端轮询走 `PUBLIC_BACKEND_URL` 且 `cache: "no-store"`，水合后能补上。首屏缓存本身不会跟着新端点立刻更新。

**影响**

一次暂时失败会盖掉上一份好快照。恢复后最多再新鲜 600 秒；没有 tag 的视图只能等 TTL。空卡片会再进首页文档缓存。

`site` 先于带新路径的 api 上线时，首屏会把「还没有这个端点」缓存成成功快照。api 就绪后，SSR 仍可能在 TTL 内嵌这份空信封。对无 tag 的 `/api/status/site-deployments`，期间没有失效能清掉它。

**依据**

先让某视图快照是 `{ok:true, data}`，再让对应 loader 抛错，或让 KV 尚无条目触发 `AwaitingReport`。`statusResponse` 返回 200 `{ok:false, error:"状态暂不可用"}`。等该快照过 `max-age` 后回源，缓存变成这份失败信封。API 恢复后，600 秒内 SSR 仍嵌失败信封。404 路径是 `StatusSnapshot.fetch` 在上游 404 时 `Response.json(..., statusSnapshotHeaders(200, tag))`。

## 5. 卡片错误边界接住的异常仍把整页打成 500

涉及缓存。

**文件**

- `src/app/entry.server.tsx` 的 `onError`
- `src/components/card-boundary.tsx` 的 `CardErrorBoundary`
- `src/lib/site-policy.ts` 的 `renderCacheHeaders`
- `workers/site/src/index.ts` 的 `RenderedSite.fetch`
- 举例抛错点：`src/components/live/site-status-card.tsx` 的 `siteDeployments?.activeVersions.length`

**现在的行为**

`renderToReadableStream` 的 `onError` 在错误已被下层错误边界接住时仍会调用，这里无条件 `responseStatusCode = 500`。`CardErrorBoundary` 已经渲染降级卡片，文档却是 500。`renderCacheHeaders` 见 `status >= 400` 就改成 `no-store`，盖掉首页 `stale-if-error` 所要保护的这次渲染。

`entry.server` 的 `onError` 把状态写成 500 之后，`renderCacheHeaders` 对 `status >= 400` 返回 `no-store`。这与「`StatusSnapshot` 对非 2xx 回 503」是不同的一层：`SiteServices.status` 在非 2xx 时抛错，文档变成 500。

**影响**

一张卡片在 SSR 里抛错，整页不再作为可缓存的降级首页。已有首页缓存会按 `stale-if-error=86400` 继续发旧 HTML，访客看不到这张卡片的 Retry。冷缓存则拿到 500。监控会把首页算成故障。

**依据**

让首页某张卡片在服务端 render 抛错（`siteDeployments` 有值但 `activeVersions` 缺失时，`siteDeployments?.activeVersions.length` 会抛）。响应状态是 500，`Cache-Control` 为 `no-store`。若边缘上还有未过 `stale-if-error` 的旧首页，下一次回源失败会继续发旧页。

## 6. 失效超时没有绑在 RPC 上，可能停在两次 invalidate 之间

涉及缓存。

**文件**

- `workers/api/src/live-platform.ts` 的 `expireStatusTags`（`REVALIDATE_TIMEOUT_MS`、`Promise.race`）
- `workers/api/src/ingest-effects.ts` 的 `dispatchIngestEffects`（经 `afterResponse` / `waitUntil` 调用它）
- `workers/site/src/index.ts` 的 `RenderedSite.invalidate`（先 `StatusSnapshot.invalidate`，再失效首页标签 `home`）

**现在的行为**

`Promise.race` 在 5 秒后拒绝。`finally` 只 `clearTimeout`，不取消 `SITE_CACHE.invalidate`。超时被 catch 掉，`waitUntil` 的 Promise 就此结束。调用方分不清失效完成和只是超时。

超时先赢时，之后 RPC 的拒绝没有人接收。让 `SITE_CACHE.invalidate` 在 5 秒后才 reject，catch 先记 `Site cache timeout`，随后出现未处理的 `invalidate` 拒绝。

失效 RPC 若随调用方结束被取消，会停在两次 `invalidate` 之间：状态快照已标陈旧，首页标签还没动。`SITE_CACHE` 若一直挂起，`waitUntil` 不结束；抛错路径已有测试，这条放弃路径没有。

**影响**

慢失效时，首页 HTML 可以一直留在 `max-age` 加 SWR 窗口里，而状态 JSON 已经准备重验证。首屏嵌入的是失效前的快照。缓存也可能停在「快照已标陈旧、首页标签还没动」。

**依据**

`expireStatusTags` 的 `Promise.race` 与 `RenderedSite.invalidate` 的两步顺序。未处理拒绝和半截失效是同一条超时路径上的两种结果。

## 7. 旧采集任务名还在，行为已经是永久跳过

涉及契约、采集。

**文件：** `shared/collector.ts` 的 `COLLECTOR_JOBS`；实现 workers/collector/src/jobs/retired.ts；`workers/collector/README.md`；`workers/collector/src/registry.ts`；测试 `workers/collector/src/registry.test.ts`；本仓库调用方 `workers/ingress/src/worker.ts` 的 `DEPLOYMENT_JOBS`。

**现在的行为：** 任务表加了 `site-deployments`、`site-analytics`。`vercel-deployments`、`vercel-metrics` 仍留在 `COLLECTOR_JOBS` 里，也仍在每分钟 / 每 15 分钟的 cron 里。`run()` 只返回 `skipped`（`Retired deployment provider`），不写 KV、不归档。README 写明是「保留 ABI 名额」。`workers/collector/src/registry.test.ts` 仍要求任务全集与 `COLLECTOR_JOBS` 一致，所以这两个空转名字被测试钉死。本仓库的运行时调用方已经改成 `["site-deployments", "cloudflare-deployments"]`。

**影响：** 旧的 ingress 若仍 `refresh(["vercel-deployments"])`，新 collector 只回跳过，不会去写 `site-deployments:v1`。名字还在，行为已经不是原来的采集。文档禁区对照把这视为「只加不改」下的空名额：公开路径已经换掉，没有旧状态路由，退役任务不再取数。契约对照仍把它标为应修，因为这是兼容分支，而且测试把空转名字钉死了。

**依据：** `COLLECTOR_JOBS` 同时含新旧四名；retired.ts 不写 KV。与第 3 条的差别是：第 3 条是新任务因缺变量跳过，这一条是旧名字被故意留成永久 `skipped`。

## 8. `BuildRun` 删掉了 `previewShare`

涉及契约。

**文件：** `shared/build-routine.ts` 的 `BuildRun`。旧生产者是 main 上的 workers/ai/src/build/preview-share.ts，本分支已删除。ai 的包含路径有这个文件，site 经 `shared/*` 也会重建。

**现在的行为：** 删除 `previewShare?: { deploymentId: string; url: string; expiresAt: number }`。`expiresAt` 原为 epoch 毫秒。这是删字段。本仓库已经没有 `previewShare` 的读写。字段本来可选，站点也不读它。已落库的 run 里若还带着这个键，新类型会忽略。同文件 `PLAN_LABELS` 的 `screenshotsNote` 只是文案（预览要过 Cloudflare Access），不算字段契约。

**影响：** 不构成另一侧 Worker 的必填字段断裂。共享类型仍然被改了，不是只加字段。`shared/state-core.ts`、`shared/public-status.ts` 无 diff，不在这一条里。

**依据：** `BuildRun` 的字段diff，以及仓库内已无 `previewShare` 读写。

## 9. `workers/site` 的组合路径没有测试，改坏了也不会红

**文件：** `workers/site/src/index.ts`（无测试文件）。`site-policy` / `image-proxy` / `sentry-tunnel` 的单测不执行这些分支。

审查没有把这些路径跑成失败。现有用例覆盖的是纯函数。下面这些只存在于组合代码里：

- 状态快照：无查询串的 GET/HEAD 才回源；上游 404 变成带 page 标签的 200 不可用信封；非 2xx、坏 JSON、坏信封是 503 且 `no-store`。缺了它，抓不住「缺端点被写成可缓存错误」或「503 / 非法包被标上 `STATUS_CACHE_CONTROL`」。带 `?` 的路径仍回源并被缓存时也抓不住。这一条与应修第 4 条是同一行为的测试缺口。
- 按环境选源：生产只调 `PUBLIC_STATUS.readStatus`，非生产才 `fetch` `PUBLIC_BACKEND_URL`；生产不读 `process.env`。抓不住生产被环境变量拐到预览或公网，或预览打到 `api.homepage.lyjw.llc`。
- 失效：`StatusSnapshot` 把白名单标签加成 `page:`；`RenderedSite` 同时失效这些视图和 `home`；空标签不碰 cache。api 侧 `SITE_CACHE.invalidate` 已测，站点把标签写成 `listening` 而不是 `page:listening`，或漏掉 `home`，现有用例不会红。`verify-api-worker.mjs` 只记录调用方传入的标签。
- 网关：`classifyGatewayRequest` 的单测仍可绿，分流可以写错。要抓住的行为是 MCP 307 到后端并保留 path 与查询串；`/explainer` 与静态资产 404 改走渲染；`/sw.js` 强制 `no-store` 与 JS 类型；`/assets` 与 `/explainer/a` 强制 immutable；其余非法请求 404 `no-store`。
- 图片入口：策略拒绝 404、超限 413、其它上游失败 502，错误均为 `no-store`；站内变体用 immutable，外链用 `REMOTE_IMAGE_CACHE_CONTROL`；生产 R2 在 `head.size` 超限时不读 body，HEAD 不取 body。抓不住拒绝的源变成 500 或被缓存、外链被标成一年 immutable、大对象先整段读进内存。
- 首屏服务：状态非 2xx 抛出；歌词与图片失败返回 null。抓不住上游故障被收成 `ok:false` 后随首页文档缓存（`first-screen.ts` 要求故障必须抛出），或歌词超时变成整页 500。

## 10. 部署快照的旧用例删了，新文件没有接上

**文件：** 已删的 src/lib/vercel-deployments.test.mts；现有 `src/lib/site-metrics.test.mts`；实现 `getSiteDeployments`（`src/lib/site-deployments.ts`）。

`site-metrics.test.mts` 只盖了成功 / BUILDING / ERROR、分流，以及「另一条成功构建不是生产」。下面这些旧断言没有对应新用例：三份滞后键组合、分析与 PageSpeed 可选、部署不可选；空项目不等于 403；未知状态为 UNKNOWN。

缺的行为：

- 信封时间跟部署记录；缺 analytics 或 pagespeed 为 null；缺 `site-deployments` 才抛 `AwaitingReport`。抓不住「分析未配置时整个 `/api/status/site-deployments` 失败」或「部署缺失仍返回空生产」。
- 100% 版本没有构建记录时合成 `cloudflare-version` 生产行，不用 `recent[0]`；查到的构建即使 fail 或分支不是 main，也改成 READY + production。抓不住回滚/手工版本显示成最近一次构建，或已接流量的失败构建仍显示 ERROR 或 preview。
- 没有活跃部署时 production 为 null 且 recent 仍在；按 `createdAt` 留最新 5 条；0% 版本滤掉后 100% 仍算生产；非法 script tag 与非 2xx 在解析正文前抛错。抓不住空列表把最新构建标成已上线、接口顺序被当成新旧、清零的旧版本让生产行消失、403 被当成空项目。
- 构建状态：queued、initializing、cancelled/terminated/skipped、其它停止结果分别是 QUEUED、INITIALIZING、CANCELED、UNKNOWN；非 main 的 target 是 preview；缺 `build_uuid` 或时间抛错。抓不住取消的构建显示 ERROR，或预览构建被标成 production。

站点逻辑审查认为成功路径上的解析与官方字段一致，分流不编造单一 production。这一条是那些边界没有测试钉住，不是把成功路径判成已经算错。

## 11. 采集任务只测了缺配置，成功写入和失败不覆盖没有测

**文件：** `workers/collector/src/jobs/site-status.ts`；`workers/collector/src/history.ts`；`workers/collector/src/history.test.ts` 只测归档函数本身。

缺的行为：`site-deployments` 成功才写 `LAG_KEYS.siteDeployments`，并把 production 与 recent 交给 `archiveSiteDeploys`；fetch 失败不写 KV。`site-analytics` 成功写 `LAG_KEYS.siteAnalytics`。

抓不住：键写错则卡片永远空；合成的 `cloudflare-version:` 生产行不进 `site_deploys`；失败轮覆盖上一份成功值。缺配置时跳过，是第 3 条已经从 `wrangler.toml` 读到的行为，那部分有测试。

# 可后续

## 根布局自己崩溃时没有全页

src/app/global-error.tsx 已删除，没有对应界面。原页有 `lang="en"`、视口、标题 System error、`h1`「Service temporarily unavailable」、Retry 和 Back to home。`root.tsx` 的 `ErrorBoundary` 只包在 `Layout` 里面，接不住 `Layout` 自己抛错。只影响根壳失败这条少见路径。子路由错误仍走 `PageError`。

## 预览「需要登录」只写在链接的 title 上

`src/components/build-plan-card.tsx` 的 `Signal`。`title="Preview (sign-in required)"`。可见文字仍是状态（如 Built）。没有 URL 时这个 `title` 不会渲染。键盘和读屏默认读不到登录提示；鼠标悬停才看得到。链接本身仍可点。

## 讲解动画仍把旧采集任务画成在跑

`docs/explainer/v2/ch01.js`、`docs/explainer/v2/ch04.js` 仍把 `vercel-deployments` / `vercel-metrics` 画成在跑的采集任务。不是运行时契约。`docs/reporter-endpoints.md` 里的旧 `Collector.refresh(["vercel-deployments", ...])` 写在历史节，并标明不是现行链路，不记为漏改。

## 构建期取提交失败会把空列表固化进该版本

`src/lib/github-recent-commits.ts` 在超时、非 2xx 或形状不对时 `return []`。`scripts/build-site-assets.tsx` 原样写入 `public/site-assets/metadata.json`。构建仍成功。最近提交不再按请求重取。构建那一下失败，这个版本的首页最近提交一直是空的，要等下一次成功构建。构建时让 `api.github.com` 的 commits 返回 502 或非数组，`public/site-assets/metadata.json` 的 `recentCommits` 为 `[]`。

这与「Node 22 上 `cache: "force-cache"` 不会把最近提交读空」不是同一条。后者是运行时缓存，见通过的检查。

## 分钟 cron 和部署通知会互相覆盖

`workers/collector/src/jobs/site-status.ts`；`workers/collector/src/registry.ts`（`runScheduled` 把 `scheduledTime` 当作 `now`，`runNamed` 用调用时的 `Date.now()`）；`workers/collector/src/history.ts`（`UPSERT` 的 `WHERE` 不比较 `updated_at`）；`workers/ingress/src/worker.ts` 的 `refreshDeployments`；`src/lib/site-deployments.ts`（`fetchedAt` 用的是入参 `now`，不是写完 KV 的时刻）。

`site-deployments` 每分钟一次，`maxRuntimeMinutes` 为 2，拉取超时 15 秒，没有单飞锁。`/api/internal/site-deployed` 会再跑同一任务。`writeLag` 是无条件 `put`。先开始、后写完的那次获胜，即使它的 `fetchedAt` 更早。同一轮归档里 `[production, ...recent]` 按 id 放进 Map，后出现的 recent 盖掉 production 上强制的 `READY` / `production`。D1 的 upsert 在字段有差异时就更新，不要求新的 `updated_at` 更大。

部署通知刚写入的快照，可能被仍在飞的那一分钟任务用更旧的列表盖掉，卡片最多再旧一轮（约 1 分钟）。D1 `site_deploys` 可能把状态写回去，或丢掉「当前线上版本」的覆盖。页面读的是 KV，不是这张表。旧的 Vercel 任务也是这个写法。

`site-analytics` 没有这条覆盖问题：两个主机共用同一次 `scheduledTime` 对齐的 UTC 日窗口，一次失败整次不写。

## 只改 `workers/site` 的分支不会拉起同提交的 api Preview

非生产 api Preview 触发器写的是 `src/*`、`shared/*`、`workers/api/*`、`workers/ai/*`、`scripts/*` 和根配置清单，没有点名 `workers/site/*`。只改 `workers/site` 时不会起同提交的 api Preview，而 `scripts/build.mjs` 等不到就失败，不回退生产。`c4ee8a5b` 这次同时改了 `src/**`、`shared/**`、`workers/api/**`、`scripts/**`、`package.json`，这一次仍会触发 api。

## 关掉这个 PR 时，清理脚本还不会删 site Preview

`.github/workflows/preview-api-worker.yml` 在 PR 关闭时检出默认分支，跑 `workers/api/scripts/delete-preview.mjs`。本 PR 里的脚本会删 api、ai、site 三个 Preview。关闭本 PR 时用的是 main 上的旧脚本，要等合入之后才带上 site。`workers/api/scripts/delete-preview.mjs` 对 `site` 使用 `previewWorkerName(branch, workerName)`，短分支名与 `-site` 后缀一致。

## 还可以补、但现有用例没钉住的路径

- `expireStatusTags` 在 `REVALIDATE_TIMEOUT_MS` 后放弃，且调用方不抛。抓住 `SITE_CACHE` 挂起时 `waitUntil` 不结束。抛错路径已测。行为本身见应修第 6 条。
- `relaySentryEnvelope`：上游抛错为 504，非超限读体错误为 400。抓住中转超时变成未处理拒绝。403 / 413 / 404 已测。
- 生产 `/img` 的 Range 与 `If-None-Match`：要么传给 `R2.get`，要么锁住「整对象 + `Accept-Ranges` / `ETag`，由入口缓存合成 206/304」。条件头只在 `imageObjectRequest` 上被保留，生产 `rawObject` 不读它们。现在无法区分「平台合成」和「Range 被丢掉」。缓存审查的结论是：生产走 R2 绑定，响应 `immutable`；Workers 缓存自己切 Range，Worker 返回完整 200。两条放在一起：Range 的平台行为没有测试钉死。
- `SiteAnalytics` 按 hostname 取 token，Lighthouse/Headless 不注入，已有 beacon 不重复插入。抓住爬虫计入浏览量，或 token 用到别的主机。
- `AppImage` 只改写 `parseImageSource` 通过的绝对 URL；宽度向上取到 `IMAGE_WIDTHS`；`unoptimized` 与相对路径保持原 `src`。抓住 `/img/...` 或 data URI 被改成 `/image?url=` 后裂图。白名单本身已测。

# 已经通过的检查

CI 的 `node-version` 是 24（`.github/workflows/ci.yml`）。虚拟机默认 Node 是 `v22.14.0`（`/exec-daemon/node`）。`node:module` 没有 `registerHooks`。加载 `src/lib/testing/register-alias.mjs` 和第一次 `pnpm build` 会因此失败。这是环境版本，不当成这次 diff 的代码失败。通过的测试、类型检查、构建和冒烟把 nvm 的 Node `v24.21.0`（`/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node`）放在 PATH 最前。lint 是在 Node 22 上跑的，eslint 不加载那个注册钩子，所以能在 22 上退出 0。

站点逻辑审查另有一条阅读结论：`cache: "force-cache"` 在 Node v22.14.0 下不会把最近提交读空。没有单独的命令和退出码。

## 单元测试

提交 `c4ee8a5b`。运行时 Node v24.21.0。`pnpm install --frozen-lockfile` 退出码 0。安装提示忽略了 `@sentry/cli`、`esbuild`、`workerd` 的构建脚本；这些单元测试不依赖它们，没有再安装。

- `pnpm test`（根，`src/lib/*.test.mts` 与 `src/lib/*.test.mjs`）：退出码 0，572 pass / 0 fail
- `pnpm --dir workers/ai test`：退出码 0，308 pass / 0 fail
- `pnpm --dir workers/api test`：退出码 0，163 pass / 0 fail
- `pnpm --dir workers/collector test`：退出码 0，40 pass / 0 fail
- `pnpm --dir workers/ingress test`：退出码 0，57 pass / 0 fail
- `node --test scripts/explainer-score.test.mjs scripts/preview-worker-name.test.mjs scripts/site-deploy-event.test.mjs scripts/site-preview.test.mjs scripts/preview-backend.test.mjs`：退出码 0，24 pass / 0 fail

`scripts/preview-backend.test.mjs` 自身不在 diff 里，但它 import 了改过的 `scripts/preview-worker-name.mjs`，所以一起跑了。Worker 命令与各目录 `AGENTS.md` 的验证条一致。

`workers/site` 没有跑：目录没有 `package.json`、没有 `AGENTS.md`、没有 `*.test.ts`。也没有跑整包 `node --test scripts/*.test.mjs`。没跑的脚本：`scripts/architecture-diagram.test.mjs`、`scripts/build-explainer.test.mjs`、`scripts/codeql-autofix.test.mjs`、`scripts/comment-only-check.test.mjs`、`scripts/docs-check.test.mjs`、`scripts/esa-purge.test.mjs`、`scripts/preview-migrations.test.mjs`。各 Worker 与 test 并列的 `typecheck`、`pnpm exec eslint workers/ai/src`、`node scripts/verify-api-worker.mjs`（含 `--build`）这次单测没有跑。`pnpm docs:check` 没有跑。上报器和 iOS 没有跑；iOS 目录是 `b85d882` 才进 diff 的。

## workers/ai 类型检查

提交 `b85d882cbf7d78bd16679bbd38ce66a35e0c01ee`。Node v24.21.0。只重跑了 `workers/ai`。工作区在检查后是干净的。`git pull --ff-only` 从 `c4ee8a5b` 快进到 `b85d882`。

- `pnpm --dir workers/ai typecheck`（脚本 `tsc --noEmit`）：退出码 0。日志只有脚本标题和 `tsc --noEmit`，没有诊断。
- `pnpm --dir workers/ai exec tsc --noEmit --pretty false`：退出码 0，输出里没有 TS2345。

根 `tsc`、api / collector / ingress / site 的 typecheck 没有在 `b85d882` 上重跑。

## lint

`origin/main...HEAD` 共 174 个路径，与 `c4ee8a5b` 的文件数一致；这条命令的记录没有另写提交 SHA。Node v22.14.0，eslint v9.39.5。跑之前 `pnpm install --frozen-lockfile` 退出码 0。

CI 在未设置 `CI_CACHE_DIR` 时，`scripts/ci-checks.sh` 的 `lint()` 跑 `pnpm lint`，即根 `package.json` 的 `"lint": "eslint"`。这次对改动文件执行等价的 `pnpm exec eslint`：现存、扩展名为 js/mjs/cjs/ts/tsx/mts/cts 的 121 个文件（均不在 `eslint.config.mjs` 的 `globalIgnores` 里）。已删除的 20 个代码文件不存在，未送入。其余 32 个现存的 md、yml、json、css、toml、jsonc、lock、example、gitignore，以及已删除的 `.vercelignore`，不在该 eslint 目标内。

退出码 0。标准输出和标准错误均为空，没有 error 或 warning。工作区相对该 PR 分支没有代码改动。CI 的 `setup-node` 使用 Node 24，这次 lint 用的是 Node 22。

## 构建

提交 `c4ee8a5b`。未改代码、未提交、未推送、未部署。工作区干净。

第一次 `pnpm build` 失败是因为 PATH 上的 Node `v22.14.0` 没有 `registerHooks`，不是 PR 缺陷。随后：

- `gh pr checkout 164`：退出码 0
- `pnpm install`（Node 22 下，lockfile 已最新）：退出码 0
- `nvm install 24`：退出码 0
- `PATH="/home/ubuntu/.nvm/versions/node/v24.21.0/bin:$PATH" pnpm build`（`node scripts/build.mjs`，Node `v24.21.0`）：退出码 0

Node 24 上完成了 explainer、site-assets（`avatar=ok og=ok commits=3`）、Vite client 与 SSR。末尾有 chunk 大于 500 kB 的警告，进程退出码仍是 0。`registerHooks` 在 Node 24 上为 function。

# 冒烟实际看到的和没验证的

检出同一 PR，HEAD `c4ee8a5b0c96a6c20947e0e60e87536910bbed92`。Node `v24.21.0`。未改代码，未跑 `wrangler deploy` / `vercel deploy`。冒烟结束时工作区干净，开发服务器已停，`localhost:3211` 已关闭。

`pnpm dev` 连的是生产状态源 `https://api.homepage.lyjw.llc`（只读 GET）。没有发聊天、没有开 issue、没有上报、没有注入假数据。打开首页时浏览器会按页面自己的逻辑去拉状态，并可能短暂连上实时通道；测完已关掉页面。Worker 目录 README 里的验证是 `typecheck` / `test`，这次冒烟没有重跑。

启动顺序：`gh pr checkout 164` 成功；`pnpm install --frozen-lockfile` 成功，pnpm 跳过了 `esbuild`、`workerd` 的安装脚本，随后在对应包目录执行了 `node install.js`，二进制才到位（本机安装限制）；`nvm install 24` 得到 `v24.21.0`，`corepack prepare pnpm@10.14.0 --activate`，PATH 把这个 Node 放在 `/exec-daemon/node` 前面；`pnpm dev` 日志为 `[site-assets] avatar=ok og=ok commits=3`，然后 `Local: http://localhost:3211/`。进程是 Node `v24.21.0`。无头 Chrome（系统 `google-chrome`，CDP）打开受影响页面。桌面视口 1440×900，手机视口 375×812。首页第二次再滚到 `#site-status`。

## 实际看到的

测过的页面上，控制台 `error` / `warning` / 未捕获异常都是 0。

- `GET /`：200，`text/html`，约 741KB。标题 `LYJW's Homepage`。SSR 含首页文案和 `#site-status`。
- `GET /api/version`：200，`{"commit":"c4ee8a5b0c96a6c20947e0e60e87536910bbed92","message":null,"builtAt":"2026-10-11T15:52:05.223Z"}`。
- `GET /manifest.webmanifest`：200，`application/manifest+json`，`name` 为 `LYJW's Homepage`，图标指向 `/pwa/icon-192.png` 与 `/pwa/icon-512.png`。
- `GET /no-such-page`：404，`no-store`。正文有 `NOT FOUND`、`404`、`The page you requested doesn’t exist or has been removed.` 1440 和 375 上地址停在 `/no-such-page`，`overflowX` 0，可见 NOT FOUND / 404 / Back to home。文档标题仍是 `LYJW's Homepage`，不是 `not-found.tsx` 里 `meta()` 写的 `404 — LYJW's Homepage`。HTTP 状态和页面正文是 404。
- `GET /github-callback`：200，`no-store`。标题 `GitHub sign-in — LYJW's Homepage`。正文 `Finishing GitHub sign-in… you can close this window.` 桌面 `clientWidth` 1440，`overflowX` 0。
- `GET /local/charging`：200，`no-store`。HTML 里有 `localStorage.setItem` 和 `location.replace("/")`。脚本跳回 `/`，随后首页正常渲染。
- `GET /icon`：200，PNG 32×32。`GET /apple-icon`：200，PNG 180×180。`GET /opengraph-image`：200，PNG 1200×630。`GET /pwa/icon-192.png`：200，PNG 192×192。`GET /pwa/icon-512.png`：200，PNG 512×512。

首页 1440：`innerWidth` 1440，`overflowX` 0。首屏有头图、联系信息、热力图、充电头。滚到 `#site-status` 后能看到 LYJWPAGE、7 日视图、贡献者和最近提交。375：`innerWidth` 375，`overflowX` 0，头图缩成 `LYJW`，同一张站点卡的文字还在，没有横向撑破。

第二次打开首页时，失败请求只剩两条，都打到生产 API，页面没有因此抛控制台错误：

- `GET https://api.homepage.lyjw.llc/api/status/site-deployments` → 404。这是本 PR 新加的状态路径，生产 API 还没有它。站点卡其余块（提交、贡献者）仍渲染。部署数据的成功路径没看到 200。
- `GET https://api.homepage.lyjw.llc/api/dev/overrides` → 404。本地注入用的路径，生产上没有，符合 `pnpm dev` 连生产的预期。

第一次打开首页时，一批 Vite 预构建模块返回 `504 Outdated Optimize Dep`（`@lobehub/icons`、`clsx`、`tailwind-merge`、`react-markdown`、`remark-gfm` 等），浏览器记成 `net::ERR_ABORTED`。直接 curl 旧的 `?v=` 地址当时仍是空 body 的 504。第二次打开不再出现这些 504，控制台仍是 0。这是开发服务器冷启动优化依赖。

另外两次网络失败没有变成控制台错误：首页一条 Apple Music HLS `m3u8` 为 `net::ERR_ABORTED`；从 `/local/charging` 回到首页后，`http://127.0.0.1:8787/sse/charger` 和 `.../sse/powerbank` 为 `net::ERR_CONNECTION_REFUSED`。本机没有那个充电 SSE 进程。

## 没验证的

- 新的 `site-deployments` 在生产 API 上是 404，卡片的部署/访问统计成功数据没看到。
- `/github-callback` 的 375 宽没有量到。两次 `Emulation.setDeviceMetricsOverride` 之后 `innerWidth` 仍是 980 / 981，`overflowX` 为 1。桌面 1440 是量到的。随后用 `--window-size=375,812 --dump-dom` 的 Chrome 调用挂起，已杀掉，没有可用结果。
- 没有起 `pnpm dev:worker`。`SITE_CACHE`、Access 预览、Workers Cache 都没在本地打到。
- 没有本地充电 SSE（8787），充电臂打开之后的本地实时流只确认了连接被拒绝。
- 没有发真实聊天、没有创建 GitHub issue、没有走 Turnstile 提交。
- 错误页 `PageError`（应修第 1 条）没有在这次冒烟里触发。冒烟看到的标题不符是 404 页，不是路由渲染失败页。

# 文档与代码冲突

下面都是文档或注释与 `c4ee8a5b` 的代码不一致。`docs/explainer/FACTS.md` 文首要求按仓库代码核对；本 PR 只改了其中几段。最后一条来自 Devin 的评论，不是这二十份审查结论，而且文件在 `b85d882` 的差别里。

## `README.md` / `README.en.md`

内容变化的重建周期写成 `src/lib/status-views.ts` 的 `cadenceMs`。`cadenceMs` 只给浏览器轮询（`src/lib/poll-schedule.ts` 的 `nextLagDelay`）。视图快照的缓存头是统一的 `src/lib/site-policy.ts` 的 `STATUS_CACHE_CONTROL`（max-age 600），不按视图的 `cadenceMs`。首屏新鲜度没有比迁移前的 `first-screen.ts` `cacheLife`（`revalidate: 600`）更差。之后若只改某个视图的 `cadenceMs`，快照 TTL 不会跟着变；浏览器轮询仍按 `cadenceMs`。

## `workers/api/README.md`

布局失效之后的内容重建同样写成 `cadenceMs`，与 `STATUS_CACHE_CONTROL` 不符。

「本地开发」写 `node scripts/verify-api-worker.mjs --build` 会把 `PUBLIC_BACKEND_URL` 指到隔离 Worker。脚本实际传入的是 `NEXT_PUBLIC_BACKEND_URL`，并打印 `Next production build`。`vite.config.ts` 只读 `PUBLIC_BACKEND_URL` / `PREVIEW_BACKEND_URL`（缺省回生产 API）。站点读取见 `src/lib/backend-url.ts`。

## `docs/state-storage.md`

- 「慢卡拖不住整个首屏」与冷渲染不符。`src/app/page.tsx` 的 `loader` 对全部 `status()` 做 `Promise.all`。根 README 已改成冷缓存会等待所需视图。
- 「网络失败、5xx 与非法信封直接 503」只对上 `workers/site/src/index.ts` 的 `StatusSnapshotBase`。调用方 `SiteServices.status` 在非 2xx 时抛错，`src/app/entry.server.tsx` 把文档打成 500；`renderCacheHeaders` 对 status ≥ 400 设 `no-store`。这与应修第 5 条是同一层行为。
- 「首屏歌词同样缓存」与实现不符。`firstScreenLyrics` 的 `use cache` 已删。`SiteServices.lyrics` 直取 `/api/lyrics`，失败回 `null`，不进 `StatusSnapshot`。`docs/explainer/FACTS.md` 这一条是对的。
- 「站点分支预览尚未接线，遗留的 Vercel 预览等待逻辑（`scripts/build.mjs`）待清理」与现码不符。`scripts/build.mjs` 用 `WORKERS_CI_COMMIT_SHA` 等本分支 Preview，等不到就失败、不回退生产，并写入 `PREVIEW_BACKEND_URL`。发布脚本是 `scripts/deploy-site-preview.mjs`（`wrangler preview`）。`docs/workers-builds.md`「分支预览」按这套写。未做的是远端 Access / Builds 接线，脚本已经不在等 Vercel。

## `docs/explainer/FACTS.md`

- 总览仍写「展示是 Vercel 上的 Next.js」。站点是 React Router SSR 的 site Worker（`package.json` 已无 `next`，路由在 `src/app/routes.ts`）。
- 第 4 节标题仍是「首屏（Vercel 上的 Next.js）」。无标签视图仍写「Vercel」。`STATUS_VIEWS` 里对应项已是 `siteDeployments`（`/api/status/site-deployments`）。无标签的七项为 github 两份、site、cloudflare、sentry、reporters、pulse。
- 在线探测仍写「只说明 Vercel 还在出页面」，指针却是 `src/app/api/version/route.ts` 的 `loader`。该 loader 属于 site Worker。
- 「站点：Vercel」仍写 `pnpm build` 再 `next build`、部署只发生在 Vercel、`deployment_status` 触发 `.github/workflows/purge-esa.yml`。`package.json` 的 `build` 是 `node scripts/build.mjs`，不再调用 `next build`。`purge-esa.yml` 触发已改为 `check_run`，名为 `Workers Builds: site`。同节 Workers Builds 名单仍只有 api / ai / ingress / collector，未列入 `docs/workers-builds.md` 已加的 `site`。
- `lyjw.me` 的 `/img` 与首页、`/api/version` 缓存头仍指向已删除的 next.config.ts（标了「当时的」）。现况：`/img/*` 由 site Worker 的 R2 绑定直出；首页与版本头在 `src/lib/site-policy.ts` 的 `HOME_CACHE_CONTROL`、`VERSION_CACHE_CONTROL`。

## `docs/ops-facts.md`

- ESA 首页 SWR 的值仍指向「当时的 next.config.ts」。同字符串现由 `src/lib/site-policy.ts` 的 `HOME_CACHE_CONTROL` 发出。文首写与代码冲突以代码为准。
- 「Vercel」节仍把站点环境变量写成 `NEXT_PUBLIC_BACKEND_URL`、`NEXT_PUBLIC_TURNSTILE_SITE_KEY`、`REVALIDATE_SECRET`。代码与 `.env.example` 已是 `PUBLIC_BACKEND_URL`、`PUBLIC_TURNSTILE_SITE_KEY`。失效走 `SITE_CACHE`，已经没有 `REVALIDATE_SECRET`。Turnstile 读取见 `src/components/god-chat.tsx` 的 `PUBLIC_TURNSTILE_SITE_KEY`。同文新增的「待上线」行没有改这些名字。
- 图片路径一行仍写回源后再 rewrite 到 R2 公开源。代码路径是 R2 绑定直出。

## `docs/build-routine.md`

截图沙盒要放行的图片主机指向已删除的 next.config.ts 的 `remotePatterns`（`f72dd525` 只有 github 头像、`*.blobstore.apple.com`、PlayStation）。现允许名单是 `src/lib/image-proxy.ts` 的 `allowedImageHost`，多了 `mzstatic.com`。

## `workers/ai/README.md`

「配置与部署」仍写「Vercel 选择与当前提交 SHA 匹配的 Preview」。选择在 `scripts/build.mjs` 加 `scripts/preview-backend.mjs` 的 `findMatchingPreview`，认的是 `WORKERS_CI_COMMIT_SHA`。同句在 `workers/api/README.md` 已改成构建侧选择。

## `AGENTS.md`

顶部 `next dev` 自动块仍要求先读 `node_modules/next/dist/docs/`，并称删掉会被 `next dev` 加回。依赖与入口已是 React Router / Vite，仓库里没有 `next`。禁区仍禁止改这块，所以这块和「修改路由与加载器前读 react-router 文档」互相矛盾，也和现码矛盾。

## `src/lib/first-screen.ts`

保留注释「上游故障必须抛出以保留上一份首屏缓存」。原来会抛错的 `firstScreen` 已删除。`StatusSnapshotBase` 在超时、非 2xx、非法包时回 503 且 `no-store`，并不在这里抛错保缓存。`ok:false` 被当成 200 成功快照写进去，见应修第 4 条。

## `docs/ios-app-handoff.md` 第 7 行

来源是 Devin 在 PR 上的评论，不是这二十份审查结论。该文件属于 `b85d882` 相对 `c4ee8a5b` 的差别（与 `apps/ios` 一起），二十份结论没有审这一页的正文。

Devin 指出：验收清单仍含已暂停的 Now 卡片、小组件和 Siri，与新的范围声明冲突。
