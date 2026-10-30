# workers/ai（AI 功能）

人读的说明与协议契约在 `README.md`；生产迁移按 `docs/ai-worker-migration.md`，预览与构建按 `docs/workers-builds.md`。

## 不变量

- 生产不开放 `workers.dev` 或独立公开域名；HTTP 只服务 `shared/ai-paths.ts#AI_HTTP_PATHS` 中的路径，生产由 site 的 `AI_SERVICE` 转发原请求和响应流（core 的同名转发只在分支 Preview 与本地用到），不改访客 IP、不缓冲聊天响应。
- `PUBLIC_STATUS` 是唯一状态读取权限，契约为 `shared/public-status.ts#PublicStatusRpc`。只能读取 core 返回的公开模型；不添加 `STATE`、`LAG`、`HISTORY`、`CREDENTIALS`、`StateCore` 或 `PrivateHistory` 绑定，不自建状态权威。
- `src/tools/registry.ts#SITE_TOOLS` 同时是无鉴权 `/mcp` 和首页对话的工具：只放只读、只读公开模型的工具；要访客确认的、只对对话界面有意义的、Anthropic 服务端工具留在 `src/chat/`。
- 访客触发的付费模型调用前先过 `ChatQuota`；缺配额绑定或历史签名密钥时关闭对话入口。历史只能经 `src/chat/seal.ts#sealedHistory` 验证后进入 Clef 和模型，工具循环共用整条回复的输出预算与读取账本。
- 设计会话、计划和构建状态令牌各自签名；计划只能被 Start build 消费一次，Open issue 不消费计划；Start build 受理前按 `issueRef` 查一次 GitHub，已有这份计划的 issue 就拒绝。`BuildCoordinator` 只保存 AI 交互配额与构建状态，不保存站点遥测。访客 GitHub token 用完立即撤销，不持久化。
- 设计会话的 Managed Agents 规划者只读：沙盒只放行 `src/chat/design-hosts.ts#DESIGN_WEB_HOSTS`（github.com 加几个文档站）、不挂凭据，write / edit 关闭，停下等确认的调用一律拒绝；提示词与工具每个会话从 `src/chat/designer.ts` 覆盖，不依赖 Console 上 agent 的配置。挂起的 `ask_visitor` / `propose_build` 只能用 `user.custom_tool_result` 了结。会话不会自己过期，靠 cron 跑的 `src/chat/design-cleanup.ts` 删除；改设计会话期限时同时核对宽限期。
- 构建工作流不持有仓库写凭据；上传、进度、截图只认 `src/build/actions-oidc.ts#verifyActionsToken` 验过的 main 上 build.yml 的 OIDC 令牌（受众绑定回调源与 runId），再按该 run 的上传凭据哈希交给 `BuildCoordinator`，经 `src/build/validation.ts` 的路径与大小校验后由 GitHub App 写入构建分支。webhook 必须验证原始正文 HMAC；Claude 审查只作参考，不授权合并。
- `Digest`（`src/digest/`）只经采集 Worker 的 Service Binding 调用，不开 HTTP 路径、不进 `SITE_TOOLS`；它不过 `ChatQuota`，Clef 调用次数靠采集节奏和输入哈希封顶：事实清单里的数字取粗是有意的，改细会让哈希每轮都变、每轮都调 Clef。标题只能出自 `src/digest/taglines.ts#DIGEST_TAGLINES`，运行时不让模型现写。
- Anthropic 出站经 `src/chat/egress.ts#anthropicFetch`；不要把任意主机转发能力加进 `AnthropicEgress`，取消信号须贯穿请求与响应管道。
- Workers Observability 收下所有 `console` 输出：不能把请求正文、请求头、cookie、对话、OAuth code 或出站密钥写进日志与错误消息。对话只存进 `ChatLog`（`src/chat/transcripts.ts`），不存 IP 与令牌；改保留期同步改首页隐私说明 `src/components/god-chat/consent.tsx#CONSENT_COPY` 的三种语言。
- 开发权限只由 `src/runtime.ts#aiDevEnabled` 判定；生产缺省关闭，不能用 `UPSTREAM_API_URL` 推断开发环境。分支预览使用组合入口，不能绑定生产状态或生产配额对象。

## 迁移与成对修改

- `ChatQuota`、`AnthropicEgress` 的生产命名空间从旧 `api` Worker transfer，保留对象 ID 与计数；迁移 tag 只追加，不改旧的，不以新建空命名空间代替迁移。
- HTTP 路径 ⇄ `shared/ai-paths.ts`、site 与 core 的转发入口（site 侧是 `src/lib/site-policy.ts#classifyGatewayRequest`）、浏览器契约与预览入口；状态读取契约只加不改，core 的被调用入口先发布。
- 构建派发的 `event_type` 与 `client_payload` 键（`src/build/handlers.ts#dispatchBuild`）、`src/build/actions-oidc.ts#BUILD_WORKFLOW_REF`、`buildWorkflowAudience`、`BUILD_REPO_ID`、`BUILD_REPO_OWNER_ID` 与 OIDC 声明 ⇄ `.github/workflows/build.yml` 的触发、文件路径、payload 环境变量与校验，以及 `scripts/build-actions.ts`；`src/build-workflow-contract.test.ts` 只核对键名、触发与路径。
- `shared/digest.ts` ⇄ `workers/collector/src/jobs/digest.ts`：契约只加不改，ai 先发布；ai 只能 `import type` 它，它不在 ai 的构建监视路径里。
- `DESIGN_WEB_HOSTS` ⇄ Managed Agents environment 的 `allowed_hosts`：web 工具的 `allowed_domains` 列了环境没放行的主机，建会话直接 400；先用 `lyjwpage-chat` 工作区的 key 跑 `pnpm designer:setup` 更新环境，再发布 Worker。
- 写给模型的工具说明与提示词（`src/tools/` 里的 `description`、`src/chat/prompts.ts`）⇄ 产出那份数据的代码：讲数据语义的句子（阈值含不含等于、「正在」这类状态词、单位、截断丢哪一段）改了哪边，都逐句对照另一边。
- 模型档位与配额 ⇄ `shared/god-chat-tiers.ts`；NDJSON、历史与卡片事件 ⇄ `shared/god-chat.ts`、浏览器消费者及验签逻辑。改模型路由判据先验证代表性输入，不凭提示词文字推断模型表现。

## 本地开发与验证

- 根目录 `pnpm dev:worker` 启动包含 ai 的完整栈，`pnpm dev:local` 连接本地入口；AI 凭据放 `workers/ai/.dev.vars`，状态兜底和注入仍由 core 管理。
- 本地配置用 `wrangler.test.toml`，从空命名空间创建对象；生产 transfer 配置不能用于初始化空的本地状态。
- 验证：`pnpm --dir workers/ai typecheck`、`pnpm --dir workers/ai test`、`pnpm exec eslint workers/ai/src`；改跨 Worker 链路同时运行 core 的集成验证。
- 改 `src/mcp.ts` 协议处理用真实客户端验（`README.md`「MCP」），跨 Worker 绑定用 Miniflare 真加载验：普通对象替身测不出运行时错误。
