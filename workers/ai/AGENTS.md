# workers/ai（AI 功能）

人读的说明与协议契约在 `README.md`；生产迁移按 `docs/ai-worker-migration.md`，预览与构建按 `docs/workers-builds.md`。

## 不变量

- 生产不开放 `workers.dev` 或独立公开域名；HTTP 只服务 `shared/ai-paths.ts#AI_HTTP_PATHS` 中的路径，由 api 的 `AI_SERVICE` 转发原请求和响应流，不改访客 IP、不缓冲聊天响应。
- `PUBLIC_STATUS` 是唯一状态读取权限，契约为 `shared/public-status.ts#PublicStatusRpc`。只能读取 api 返回的公开模型；不添加 `STATE`、`LAG`、`HISTORY`、`CREDENTIALS` 或 `StateCore` 绑定，不自建状态权威。
- `src/tools/registry.ts#SITE_TOOLS` 同时是无鉴权 `/mcp` 和首页对话的工具：只放只读、只读公开模型的工具；要访客确认的、只对对话界面有意义的、Anthropic 服务端工具留在 `src/chat/`。
- `run_site_code` 执行模型生成的代码，只能在 `MCP_CODE_MODE=true` 时经 `ToolIO.runCode` 暴露给 `/mcp`，不进 `SITE_TOOLS` 与首页对话；沙箱必须保持无网络（`globalOutbound: null`）、无绑定，只通过 `status(view)` 读白名单视图并共用读取账本。
- 付费模型调用前先过 `ChatQuota`；缺配额绑定或历史签名密钥时关闭对话入口。历史只能经 `src/chat/seal.ts#sealedHistory` 验证后进入 Clef 和模型，工具循环共用整条回复的输出预算与读取账本。
- 设计会话、计划和构建状态令牌各自签名；计划只能被 issue 或 build 消费一次。`BuildCoordinator` 只保存 AI 交互配额与构建状态，不保存站点遥测。访客 GitHub token 用完立即撤销，不持久化。
- 设计会话的 Managed Agents 规划者只读：沙盒只放行 github.com、不挂凭据，write / edit 关闭，停下等确认的调用一律拒绝；提示词与工具每个会话从 `src/chat/designer.ts` 覆盖，不依赖 Console 上 agent 的配置。挂起的 `ask_visitor` / `propose_build` 只能用 `user.custom_tool_result` 了结。会话不会自己过期，靠 cron 跑的 `src/chat/design-cleanup.ts` 删除；改设计会话期限时同时核对宽限期。
- routine 不持有仓库推送凭据；上传只经 `src/build/validation.ts` 的路径与大小校验后由 GitHub App 写入构建分支。webhook 必须验证原始正文 HMAC；Claude 审查只作参考，不授权合并。
- Anthropic 出站经 `src/chat/egress.ts#anthropicFetch`；不要把任意主机转发能力加进 `AnthropicEgress`，取消信号须贯穿请求与响应管道。
- `src/sentry.ts#sentryOptions` 禁止收集请求正文、请求头和 cookie；不能把对话、OAuth code 或出站密钥写入日志与错误上下文。
- 开发权限只由 `src/runtime.ts#aiDevEnabled` 判定；生产缺省关闭，不能用 `UPSTREAM_API_URL` 推断开发环境。分支预览使用组合入口，不能绑定生产状态或生产配额对象。

## 迁移与成对修改

- `ChatQuota`、`AnthropicEgress` 的生产命名空间从 api transfer，保留对象 ID 与计数；迁移 tag 只追加，不改旧的，不以新建空命名空间代替迁移。
- HTTP 路径 ⇄ `shared/ai-paths.ts`、api 转发入口、浏览器契约与预览入口；状态读取契约只加不改，api 的被调用入口先发布。
- 模型档位与配额 ⇄ `shared/god-chat-tiers.ts`；NDJSON、历史与卡片事件 ⇄ `shared/god-chat.ts`、浏览器消费者及验签逻辑。改模型路由判据先验证代表性输入，不凭提示词文字推断模型表现。

## 本地开发与验证

- 根目录 `pnpm dev:worker` 启动包含 ai 的完整栈，`pnpm dev:local` 连接本地入口；AI 凭据放 `workers/ai/.dev.vars`，状态兜底和注入仍由 api 管理。
- 本地配置用 `wrangler.test.toml`，从空命名空间创建对象；生产 transfer 配置不能用于初始化空的本地状态。
- 验证：`pnpm --dir workers/ai typecheck`、`pnpm --dir workers/ai test`、`pnpm exec eslint workers/ai/src`；改跨 Worker 链路同时运行 api 的集成验证。
- 改了 `src/mcp.ts` 的协议处理，单测之外要用真实客户端连接本地入口，命令见 `README.md`「MCP」；客户端按自己的 schema 严格校验结果。
