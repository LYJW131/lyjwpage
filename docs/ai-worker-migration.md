# AI Worker 首次迁移

> 类型：runbook

本流程把聊天专用 Durable Object 从 api 转移到 ai，同时保留公开 URL、额度计数、历史签名和状态权威。生产切换需要独立的发布授权；准备 PR、分支 Preview 和本地验证不执行这些步骤。运行时职责见 [AI Worker](../workers/ai/README.md)，构建配置见 [Workers 原生 Git 部署](./workers-builds.md)。

## 准备

- 确认 `api` 的 `ChatQuota`、`AnthropicEgress` 命名空间与正在使用的 `CHAT_HISTORY_SECRET`；仅记录命名空间身份与变量名，不输出密钥值。
- 在安全凭据来源中准备 `ANTHROPIC_API_KEY`、`TURNSTILE_SECRET_KEY`、`CHAT_HISTORY_SECRET`、`GITHUB_APP_CLIENT_SECRET`。其中历史签名密钥必须保留原值，否则浏览器持有的对话历史会验签失败。
- 核对 [仓库外事实](./ops-facts.md) 中的域名、Secret 归属和构建配置。该表保留最近一次生产核对，不能以新代码推断外部配置已经切换。
- 最终拆分提交进入 `main` 前完成下面的顺序部署，避免 Workers Builds 并行发布 api 时 ai 尚未就绪。此处适用根 `AGENTS.md` 的跨 Worker 契约切换例外。

## 发布顺序

1. **先让 api 提供只读入口。** 部署桥接提交 `c8515e86`：它只增加 `PublicStatus` 与 `shared/public-status.ts`，仍保留 api 原有聊天处理和两个聊天 DO。使用单独的干净 checkout 运行 `pnpm --dir workers/api typecheck` 和 `pnpm --dir workers/api exec wrangler deploy`。不要用最终拆分提交替代这一步；ai 的 `PUBLIC_STATUS` 依赖这个具名入口。
2. **发布 ai 并转移聊天命名空间。** 在最终拆分提交上运行 `pnpm --dir workers/ai typecheck`，再执行 `pnpm --dir workers/ai exec wrangler deploy`。`workers/ai/wrangler.toml` 的 `v1-transfer-from-api` 使用 `transferred_classes` 接收 `ChatQuota` 与 `AnthropicEgress`，不得先创建同名的新命名空间，不得在 api 加 `deleted_classes`。Cloudflare 转移后原 api 的旧绑定仍指向同一批对象，聊天入口可以继续服务。
3. **配置 ai 的 Secret。** 对准备好的各变量运行 `pnpm --dir workers/ai exec wrangler secret put <NAME>`，从标准输入或安全凭据流程传值。不要为历史签名重新生成密钥。Sentry 目标以 ai 的 `wrangler.toml` 为准，事件带 `worker:ai`。保持生产默认地址关闭；分支 Preview 的 URL 开关按构建文档设置。
4. **切换 api 为转发入口。** 在最终拆分提交上运行 `pnpm --dir workers/api exec wrangler deploy`。其生产绑定删除聊天 DO，保留历史迁移记录，通过 `AI_SERVICE` 调 ai；`StateHub`、`LivePushRoom` 与 Pulse 留在 api。确认 `/mcp`、聊天、额度和 GitHub issue 入口行为后，再移除 api 不再使用的聊天 Secret；旧绑定移除不等于删除命名空间。
5. **配置 Git 构建并合并。** 按构建文档连接 ai 的 Workers Builds，设置各 Worker 包含与排除路径、预览命令及清理权限。确认之后才合并并推送 `main`，让 Workers Builds 按同一份代码重建。不要用另一条 GitHub Actions 发布流水线接管。

桥接代码与最终拆分代码分别提交，不能在首次迁移完成前 squash 掉桥接提交的可取用来源。无论合并方式如何，先核对准备发布的提交中导出类、绑定及迁移配置。

## 验收

- 比较迁移前后的 ChatQuota 命名空间身份，确认转移而非新建；在已有对话中继续一轮，历史验签不丢失。实时访问会改变额度，不能简单要求两次读数逐字相等。
- 用真实 MCP 客户端经站点 `/mcp` 连接，列工具并读取公开状态。核对工具所见与公开状态 API 一致，状态仍由 api 管理。
- 检查聊天首个 NDJSON 事件、后续正文、工具卡片、`/api/chat/usage`、Turnstile 与额度拒绝。从亚洲访问发一轮对话，确认不报 Anthropic 的 403 `Request not allowed`：`AnthropicEgress` 靠首次创建时的北美 `locationHint` 绕开地区限制，Cloudflare 没写明转移是否保留对象位置。GitHub issue 写入仍由访客确认，不能把自动验收变成实际发帖。
- 验证原有上报、状态读取和 WebSocket；确认 AI 日志可按 `worker:ai` 查询，错误事件不包含对话正文、OAuth code 或请求头。
- 核对相应 Git 提交的 Builds 状态，并确认 AI 专属实现变更只触发 ai 的生产发布。共享路径或锁文件变更仍可触发多个 Worker。
- 更新 `docs/ops-facts.md` 的 Worker、Secret 归属与构建核对记录。上述远端核验完成前，不能把本地通过报告成生产迁移完成。

## 中断与回退

在 api 切换前失败时，先保持桥接版本的 api 服务原入口，修复 ai 配置；转移成功后不要删除 ai，也不要把旧 DO 当作空库重建。api 切换后如需回退处理逻辑，必须保留对已转移命名空间的外部绑定及历史签名密钥，先准备可审阅的回退配置。Git 回滚不会自动逆转 DO 的命名空间归属；需要转回时按新的 transfer 迁移执行，不复用旧 tag。

本地 `node scripts/verify-api-worker.mjs` 验证真实 Service Binding、公开读取边界和流式转发；它使用独立空命名空间，不证明生产 transfer 已执行，也不证明浏览器断连能在生产中取消上游模型请求。

官方依据：[Legacy transfer migration](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/#transfer-migration)、[Service Binding 部署顺序](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/#deployment)。
