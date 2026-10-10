# AI Worker

负责首页对话、设计与访客构建、模型调用、配额、GitHub issue 提交、站点工具与公开 MCP。站点状态的唯一权威仍是 [api Worker](../api/README.md)；Coding 的 Pulse 评估也留在 api 的 cron 中。

## 入口与权限

生产配置 `wrangler.toml` 设 `workers_dev=false`，不绑定独立公开域名；`preview_urls=true` 用于允许隔离的分支 Preview 使用 workers.dev 地址。生产 HTTP 只经 api 对外公开。浏览器与 MCP 客户端继续访问 api 的公开地址，api 按 `shared/ai-paths.ts#AI_HTTP_PATHS` 经 `AI_SERVICE.fetch(request)` 原样转发请求与响应流；来源校验、预检、限流和协议处理由本 Worker 执行。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/chat` | 首页对话，流式返回 NDJSON |
| GET | `/api/chat/usage` | 当前访客与全站的对话配额，只读不扣额度 |
| POST | `/api/github/issue` | 访客确认签名计划并完成 GitHub PKCE 授权后提交 issue |
| POST | `/api/build` | 访客每次都完成 GitHub PKCE 授权：授权码当场换令牌、查身份后立即吊销，再一次性消费计划与额度并触发 routine |
| GET | `/api/build/status` | 持状态 token 查询 run 并按需对账 |
| POST | `/api/build/upload` | routine 持一次性上传 token 提交文件 |
| POST | `/api/build/progress` | routine 持同一上传 token 报告进度 |
| POST | `/api/build/webhook` | 验证 GitHub webhook 并更新构建状态 |
| POST | `/mcp` | 无鉴权的 Streamable HTTP MCP |

浏览器端点检查允许来源；上传、进度和 webhook 接受无 Origin 的服务器请求，分别验证 bearer token 或原始正文 HMAC。这些路径接受 CORS 预检；其他路径，包括未知路径的预检，均返回 404。入口在 `src/worker.ts`，共享来源匹配在根目录 `shared/http-origins.ts`。

`PUBLIC_STATUS` 是唯一的站点状态读取权限，契约为根目录 `shared/public-status.ts#PublicStatusRpc` 的 `readStatus(path: string): Promise<Response>`。api 的 `PublicStatus` 只接受 `src/lib/status-views.ts#STATUS_VIEWS` 登记的精确路径，返回浏览器使用的公开模型；不接受查询参数、任意 URL、凭据读取或写入。AI Worker 不绑定 `STATE`、`LAG`、`HISTORY`、`CREDENTIALS` 或 `StateCore`。

## 代码职责

- `src/index.ts`：Sentry 包装的 HTTP 入口，导出 `ChatQuota`、`AnthropicEgress`、`BuildCoordinator`。
- `src/chat/`：Turnstile、模型分流、工具循环、流式事件、历史验签、配额与 Anthropic 出口。
- `src/tools/registry.ts#SITE_TOOLS`：首页对话与 MCP 共用的只读站点工具；读取由 `ToolIO` 注入。
- `src/mcp.ts`：MCP 协议处理，不调用模型。
- `src/github-issue.ts`：一次性消费签名计划，以访客身份创建 issue 并撤销短期 token。
- `src/build/`：构建令牌、上传路径验证、GitHub App 调用、webhook、状态对账与 `BuildCoordinator`。完整配置与 routine 提示词见 [访客协作构建](../../docs/build-routine.md)。
- `src/sentry.ts#sentryOptions`：关闭请求正文、请求头与 cookie 收集；对话、OAuth code 和代理请求中的密钥不能进入 Sentry。`SENTRY_ENVIRONMENT` 优先，未配置时由 `PREVIEW_WORKER` 选择预览或生产环境。

下文 `src/chat/`、`src/tools/` 等后端路径相对于本目录；`shared/`、站点的 `src/components/`、`src/app/` 和 `docs/` 相对于仓库根目录。

## 首页对话

`POST /api/chat`（`src/chat/handler.ts`）收浏览器的对话历史与 Turnstile token 或通行证，契约在 `shared/god-chat.ts`：请求体、NDJSON 事件、上下文与输出上限都在那一份，站点卡片 `src/components/god-chat.tsx` 读同一份。

- 普通消息的路径：请求体按读到的字节数截停（`src/chat/guard.ts#readJsonBody`）→ 通行证或 Turnstile 校验（通行证是验过人后下发的 `pass` 事件，按 IP 签、有效期见 `shared/god-chat.ts#GOD_CHAT_PASS_TTL_MS`，期内免新 token，过期回 403 `human_pass_expired`，签发与核验在 `src/chat/pass.ts`；Turnstile 用 `TURNSTILE_SECRET_KEY`；除了 success，还核对 action 是 `shared/god-chat.ts#GOD_CHAT_TURNSTILE_ACTION`、hostname 落在 `ALLOWED_ORIGINS` 里，见 `turnstilePassed`）→ `ChatQuota.admitVisitor` 在路由前过三道：访客总量、全站路由次数（`shared/god-chat-tiers.ts#GOD_CHAT_ROUTE_LIMIT`，各档全站名额之和）、这位访客此刻至少有一档访客与全站都有空位；访客自己超额回「Too many prayers」，全站忙回「All the heavens are busy」，都是 429，到此为止、不再触发付费的路由 → Clef 选档（`src/chat/router.ts`，经 `AI` 绑定调 `@cf/cloudflare/clef`，选项与思考强度在 `CLEF_CHOICES`；Clef 不可用时落到 `ROUTER_FALLBACK`）→ `ChatQuota.admitTier` 扣档位额度，该档满了就往下逐档降级（`shared/god-chat-tiers.ts#downgradeChain`）→ 调 Anthropic（`ANTHROPIC_API_KEY`）。refuse 不调模型，只占访客总量与一次全站路由，直接回一句关门话。
- 模型档位与人设的型号、展示名在 `shared/god-chat-tiers.ts#GOD_CHAT_TIER_INFO`。提示词在 `src/chat/handler.ts`：`BASE_PROMPT` 讲清 Clef 怎么选档、额度用完怎么降级，`PERSONA` 告诉每档自己是哪个模型、什么身份；被降级时另在末尾加一条 system 消息说明替谁作答（`downgradeNote`），不动缓存前缀。
- 额度数值在 `shared/god-chat-tiers.ts#GOD_CHAT_QUOTA`（窗口、访客总量、每档访客与全站），计数在 Durable Object `ChatQuota`（`src/chat/quota.ts`，全站共用实例，对象名由 `src/chat/handler.ts#quotaStub` 决定，SQLite 存窗口内的命中，每次调用先删窗口外的再数再记）。`/api/chat/usage` 读同一份；它不验人，每次都要进这个全站共用的对象跑一个事务，所以先过 Rate Limiting 绑定 `CHAT_USAGE_LIMIT` 按 IP 限流；这类绑定只作为尽力而为的入口保护，核验记录见 `docs/ops-facts.md`。`resetInMs` 倒数到这位访客看到的数下一次会变的时刻（自己最早的命中过期，或某档全站、全站路由次数已满时它最早的命中过期）；路由次数不单列在用量里。没有 `CHAT_QUOTA` 绑定时对话端点回 503，不放行。Anthropic 账户侧的花费上限与凭据配置只以 `docs/ops-facts.md` 的核验记录为准。
- 对 Anthropic 的请求经 `src/chat/egress.ts#anthropicFetch` 转给 Durable Object `AnthropicEgress`；出口位置取同文件的 `EGRESS_HINT`，主机白名单取 `ANTHROPIC_HOST`。对象只转发该上游，避免访客所在机房的地区限制；核验记录见 `docs/ops-facts.md`。没有这层绑定时直接发。
- 中断：Worker 开启 `enable_request_signal`，入站请求的 `signal` 一 abort 就停下工具循环，SDK 的 fetch 信号带进 `AnthropicEgress`，那边经带信号的管道取消对 Anthropic 的连接，避免原样直通响应体时取消延迟。只有运行时真的报了取消时这条路径才起作用，不能把访客点击停止当成上游已停止计费；生产断开信号的核验边界见 `docs/ops-facts.md`。未收到取消时仍受这条回复的 `maxTokens` 和配额约束，拒答兜底的溢出规则见下文。
- 站点改动请求由 Clef 路由给 Sonnet，候选请求仍扣普通额度，Sonnet 无空位时返回 429，不降级；Sonnet 判断值得做时调用 `start_design`，开启轮计入设计轮数。设计会话跑在 Claude Managed Agents（`src/chat/designer.ts`）：`start_design` 用 `agent_with_overrides` 建会话，模型、提示词（`src/chat/design.ts#PLANNER_PROMPT`）和工具每个会话从代码覆盖，Console 上的 agent（`DESIGN_AGENT_ID`）只是壳，environment（`DESIGN_ENVIRONMENT_ID`）只放行 github.com；会话带 `src/chat/design.ts#DESIGN_BUDGET_CENTS` 的硬预算，到顶时平台暂停会话、回复里说明。会话 ID 签进设计令牌，同一条回复随即把访客那段对话交给会话里的 Opus 规划者，NDJSON 再发一次 `route` 事件；持有效令牌的后续消息直接转给同一个会话，扣 `BuildCoordinator` 中的专属轮数，跳过 Clef 与普通配额；会话期限、轮数和全站上限以 `shared/build-routine.ts#BUILD_DESIGN_LIMITS` 为准。规划者在沙盒里克隆公开仓库，用 Managed Agents 自带的 read、glob、grep、bash（`auto` 权限，停下等确认的调用一律拒绝；write、edit 关闭）和 web_search、web_fetch；自定义工具 `get_site_status` 由 Worker 当场作答，`ask_visitor` 与 `propose_build` 校验通过后挂起：会话停在 `requires_action`，访客下一条消息作为那次调用的 `user.custom_tool_result` 发回，没有挂起的调用时才发 `user.message`。题目不合规、计划被 `src/build/validation.ts#checkBuildPlan` 拒绝时立刻把原因回给规划者。NDJSON 发送 `design` / `ask` / `plan` 事件，正文按 `event_deltas` 实时推；Managed Agents 不给思考内容，规划者读仓库文件发 `doc` 事件，其余每一步发一行 `step` 事件作进度。每条设计回复记一行 `[god-chat] design turn` 日志（会话 ID、停止原因、模型请求数与 token），不记对话正文与工具输入。
- Open issue 使用 GitHub App 用户授权与 PKCE（S256），回调页仍是 `src/app/github-callback/page.tsx`。浏览器只提交签名计划、code 和 `codeVerifier`；`src/github-issue.ts` 验证并一次性消费计划，从计划生成标题正文，以访客身份开 issue 后立即撤销 token。GitHub App 不会代替访客发 issue。Start build 使用独立的签名账号会话，并由 GitHub App 创建构建 PR；两个出口共享计划消费记录。
- `show_card`（`src/chat/show-card.ts`）在回复里画一张实时卡片：模型只选卡片名，卡片名与每张卡片背后的状态视图登记在 `shared/god-chat.ts#GOD_CHAT_CARD_VIEWS`，模型给不了任何文字、图片或链接。每张卡片只对应一个视图，「此刻」和「最近」分开画，访客只问此刻时模型只画此刻那张。NDJSON 发一行 `card`，站点 `src/components/chat-card.tsx` 按登记的视图读公开状态自己画，画在收到这一行时正文已到的位置；它和首页卡片共用 SWR 缓存键，推送写进同一份缓存、卡片跟着变，自己不轮询。工具结果把同一个视图的数据回给模型（走 `get_site_status` 的执行与这条回复的账本，读过的不再读），模型据此用一两句话作答、不复述卡片内容。同一条回复里同一张卡片只画一次。
- 请求带 `thinking.display: "summarized"`：模型思考时流出 `thinking` 事件（思考摘要），卡片在正文出来前显示，正文开始后折叠；摘要不进对话历史。
- 模型由 Anthropic 的拒答兜底（`fallbacks: "default"`，Haiku 没有）换掉时，NDJSON 末尾多一行 `served`，卡片标出实际作答的模型；下一轮的 trace 带 `fallback`。兜底按单次请求生效、兜底模型自己也可能拒，所以只按给出最终答案的那一轮、且它没被拒时才报。
- 读取类工具有三种。前两种是和 `/mcp` 共用的站点工具（`src/tools/registry.ts#SITE_TOOLS`），对话把整条回复的调用记在同一本账本（`newLedger`）上：`get_site_status` 经 `PUBLIC_STATUS.readStatus(path)` 调 api 的 `PublicStatus` 入口（和浏览器看到的同一份公开模型，走 Service Binding），一条回复里所有调用合计有视图数上限、读过的不再读（`src/tools/site-status.ts#claimViews`）；`read_project_doc` 读本项目的设计文档（`src/tools/project-docs.ts`），只认 `PROJECT_DOCS` 白名单里的文档键，运行时从公开仓库 main 分支的 raw.githubusercontent.com 取并在边缘缓存，所以改文档不用重发 Worker、新增文档才要加一行；长文档先回目录和开头，模型再按章节读，一条回复的读取次数有上限（`claimDoc`，上限说明经 `replyCap` 只附给对话）。`web_search` 是服务端工具，Haiku 用基础版，其余用带动态过滤的版本（原因写在 `src/chat/web-search.ts#webSearchTool`），每轮请求的 `max_uses` 是这条回复还剩的次数，用完就不再带这个工具。
- AI 资讯走 Anthropic 的 MCP 连接器：普通对话（非设计会话）每轮请求带 `mcp_servers`（`https://aihot.news/api/mcp`，无鉴权、只读）和只启用白名单工具的 `mcp_toolset`（`src/chat/ai-news.ts`），由 Anthropic 服务端代连，Worker 不出站；收尾轮不带工具时 `mcp_servers` 与 `mcp-client-2025-11-20` beta 一并不带。`aihot_search` 的搜索词会像 `web_search` 一样作为 `search` 事件展示。MCP 调用不计入 `web_search` 的 `max_uses`，一条回复的用量只受输出预算约束。
- 历史由浏览器提交，Worker 给每一问一答盖章（`src/chat/seal.ts`，HMAC 密钥是 Secret `CHAT_HISTORY_SECRET`，缺了对话端点回 503）：回复正常结束时 NDJSON 末尾发一行 `seal`，带章和 trace（哪一档答的、实际 effort、读过哪些视图与文档、搜了几次、是否兜底代答、是否进入设计、是否生成计划、画过哪些卡片），浏览器原样带回。章签的是「访客消息 + 回复 + trace + 计划 token」整对；设计会话与构建状态另用带用途的 HMAC token 验证，进 Clef 与模型之前先验章，没有章或对不上的一对整对丢掉：Clef 拒掉的、模型拒答的、半路中断的、浏览器伪造或改过的都进不了上下文。验过章的 trace 拼成一条说明附在那条回复之前的访客消息里（`src/chat/history.ts`），模型因此知道那条回复当时查过什么；说明只用枚举与计数拼，不带自由文本。
- Haiku 作答时带 `request_upgrade` 工具（`src/chat/handler.ts#UPGRADE_TOOL`）：它判断问题超出自己时先调这个工具，Worker 向 `ChatQuota` 扣一个 Sonnet 名额（不降级、不动 Haiku 已扣的名额），成功就丢掉 Haiku 这一轮的草稿，由 Sonnet 带着原对话重答，流里补发一条 `route`（`tier: sonnet`，无 `downgradedFrom`），回复上限与强度按 Sonnet 重算；Sonnet 没空位时工具回错误，Haiku 自己答完。升级只在非设计会话里开放，Fable 仍然只由 Clef 派。
- 回复上限按档位定（`shared/god-chat-tiers.ts#GOD_CHAT_TIER_INFO` 的 `maxTokens`），设计会话的花费由会话预算约束；思考强度在选中 Haiku 时由 Clef 一并选出，设计会话里的 Opus 用 `GOD_CHAT_TIER_INFO.opus.effort`，其余情况（Sonnet、Fable、降级、强制档位、Clef 不可用）取 `GOD_CHAT_TIER_INFO` 的 `effort` 默认值。访客没有手动调高的命令。`maxTokens` 是一条回复所有轮次（工具循环、暂停续跑）合计的输出上限，每轮请求只给剩下的部分；每轮按计费量扣（`src/chat/billing.ts#billedOutputTokens`）。同一请求内本档中途拒答后兜底模型还能再用满一次 `max_tokens`，这部分溢出有意接受。各档都用 [Claude 官方的消息级 effort](https://platform.claude.com/docs/en/build-with-claude/effort#per-message-effort-beta)，请求参数以 `src/chat/handler.ts#converse` 为准：保持 adaptive thinking，不设置请求顶层的 effort；`src/chat/history.ts#toModelMessages` 在强度变化的访客消息前插入空 `system` 消息及 `output_config.effort`，工具续跑继承该强度。实际 effort 随已签名的 trace 回传，后续按原位置重放，切换当前强度不重写历史前缀。省钱靠 system 与末尾各一个缓存断点；缓存按模型分开，换档不会互相命中，历史裁剪和工具定义变化仍会影响命中。

浏览器以 `src/lib/chat-archive.ts` 保存有限量的多个本地会话，保留历史签章、设计/计划 token 与构建 runId；`/clear` 新开会话，列表可恢复、单条删除或确认后全部清空。流式分片只更新内存，回复结束或中断时再持久化。设计会话到期、轮数耗尽或访客输入 `/exit`（只在设计会话里列出）时清除设计令牌并退回普通对话。localStorage 不可用时只保留内存状态。

## MCP

`POST /mcp`（`src/mcp.ts`）是给外部 AI 用的公开 MCP 端点，无鉴权。站点在根目录 `next.config.ts` 中将 `/mcp` 用 307 跳到 `NEXT_PUBLIC_BACKEND_URL` 对应的 api，api 再经 Service Binding 交给本 Worker。307 保留 POST 与请求体；不用 Vercel rewrite，避免 `CF-Connecting-IP` 变成共用的 Vercel 出口 IP。公开访问域名见 `docs/ops-facts.md`。

- 工具就是 `src/tools/registry.ts#SITE_TOOLS`，和首页对话同一份定义与执行。这里只放只读、只读公开模型的工具：`start_design`、`ask_visitor`、`propose_build`（要访客在卡片里操作）、`show_card`（只对对话卡片有意义）和 `web_search`（Anthropic 服务端工具）只在对话里。每次调用各开一本账本，单次调用的视图数与截断长度和对话相同，跨调用不累计。
- 协议：无状态，只回 JSON，不发会话 ID，不开 SSE（GET、DELETE 回 405），JSON-RPC 批量请求回 400。两代客户端都收：`_meta` 里带版本的新协议（`MODERN_VERSIONS`）逐个请求核对 `MCP-Protocol-Version`、`Mcp-Method`、`Mcp-Name` 头与正文一致，`server/discover`、`tools/list` 带缓存提示（`CACHE_HINTS`，缺了 Claude Code 整张工具表都不认）；旧协议（`LEGACY_VERSIONS`）先 `initialize` 握手。
- 限流与来源：按 `CF-Connecting-IP` 过 Rate Limiting 绑定 `MCP_LIMIT`，拦下时回 429 带 `Retry-After`；和 `CHAT_USAGE_LIMIT` 一样只是尽力而为，核验记录见 `docs/ops-facts.md`。带 `Origin` 的请求按 `ALLOWED_ORIGINS` 校验（与 `/api/*` 同口径），不在名单里回 403；服务端和桌面端的 MCP 客户端不带 `Origin`，不受影响。
- 验证：`src/mcp.test.ts` 覆盖两代握手与报错，但客户端会按自己的 schema 严格校验结果，单测验不出这类不兼容；改了协议处理，起 `pnpm dev:worker` 后用真实客户端各连一次：`claude -p --strict-mcp-config --mcp-config '{"mcpServers":{"lyjw":{"type":"http","url":"http://localhost:8788/mcp"}}}' "…"` 走新协议，`npx @modelcontextprotocol/inspector --cli http://localhost:8788/mcp --transport http --method tools/list` 走旧协议握手。

## 配置与部署

绑定与变量的代码契约在 `src/runtime.ts#Env`，生产绑定在 `wrangler.toml`。模型与验人使用 `AI`、`ANTHROPIC_API_KEY`、`TURNSTILE_SECRET_KEY`，历史签名使用 `CHAT_HISTORY_SECRET`，提交 issue 与连接构建账号使用 `GITHUB_APP_CLIENT_SECRET`。构建的 Secret（含触发 Codex 与 Cursor 审查的 `CODEX_REVIEW_GITHUB_TOKEN`）、routine 与 webhook 配置见 [访客协作构建](../../docs/build-routine.md)，没有配置时入口关闭。`CHAT_QUOTA`、`ANTHROPIC_EGRESS` 与 `BUILD_COORDINATOR` 指向各自的 Durable Object；`CHAT_USAGE_LIMIT`、`GITHUB_ISSUE_LIMIT`、`MCP_LIMIT` 与 `BUILD_REQUEST_LIMIT` 保护对应入口。配额阈值取根目录 `shared/god-chat-tiers.ts#GOD_CHAT_QUOTA`，入口限流配置取 Wrangler 文件，不另抄数值。

生产迁移配置 `wrangler.toml` 的 `v1-transfer-from-api` 使用 `transferred_classes` 接管 api 的 `ChatQuota`、`AnthropicEgress` 命名空间，保留对象 ID 和配额计数；不能另建空命名空间替代。发布顺序、Secret 配置和回滚按 [AI Worker 迁移 runbook](../../docs/ai-worker-migration.md) 执行，不凭提交或配置文件推断迁移已生效。

Workers Builds 的监视路径和部署命令统一见 [Workers 构建](../../docs/workers-builds.md)。分支预览使用组合入口，在同一隔离 Preview 内运行 api 与 AI，不连接生产 Service Binding；以 api 或 ai 为 parent 时使用同一实现，Vercel 选择与当前提交 SHA 匹配的 Preview。Secret 只配在实际选中的 parent 的具体 Preview 上，不能把另一个 parent 的配置当成已继承；创建、解析和配置步骤只在构建文档维护。

## 本地开发

以下命令从仓库根目录执行：

```sh
cp workers/ai/.dev.vars.example workers/ai/.dev.vars
pnpm dev:worker
pnpm dev:worker:init
pnpm dev:local
```

初始化 StateHub 只在首次使用空的本地状态时需要。`pnpm dev:worker` 同时启动 dev-router、api、ai、ingress、collector；请求从本地 api 经 Service Binding 到 ai，工具再经 `PUBLIC_STATUS` 读本地 api。端口、状态持久化与假数据注入见 [api 本地开发](../api/README.md#本地开发)。`workers/api/.dev.vars` 的 `UPSTREAM_API_URL` 只控制 api 的公开状态兜底，不启用 AI 调试权限。

聊天凭据放 `workers/ai/.dev.vars`：`ANTHROPIC_API_KEY`、`TURNSTILE_SECRET_KEY`、`CHAT_HISTORY_SECRET` 必须齐全，否则聊天回 503；设计与签名计划另需 `BUILD_SESSION_SECRET`、`BUILD_COORDINATOR` 绑定，以及与该 key 同一工作区的 `DESIGN_AGENT_ID`、`DESIGN_ENVIRONMENT_ID`（`wrangler.toml` 与 `wrangler.test.toml` 的 `[vars]` 已填；换工作区时用新 key 跑 `pnpm --dir workers/ai designer:setup`，按名字找或建并打印两个 ID），缺任何一项时 Sonnet 拿不到 `start_design`；issue 提交还需 `GITHUB_APP_CLIENT_SECRET`。本地 `wrangler.test.toml` 设置 `AI_DEV=true`；`src/runtime.ts#aiDevEnabled` 只在 `AI_DEV=true` 或 `PREVIEW_WORKER=true` 时放宽 localhost / Turnstile 测试密钥校验，并启用以下调试变量：

- `CHAT_RATE_LIMIT=off`：普通聊天配额仍记账、`/usage` 仍显示用量，但不拦截；设计轮数与会话上限仍执行。
- `CHAT_FORCE_TIER=<档位或 CLEF_CHOICES 的键>`：无设计会话时跳过 Clef；合法值见根目录 `shared/god-chat-tiers.ts#GOD_CHAT_TIERS` 与 `src/chat/router.ts#CLEF_CHOICES`。有效设计会话始终由规划者回答。

生产缺省不开调试权限，不能靠 `UPSTREAM_API_URL` 或只设置调试变量绕过验人及配额。使用 `pnpm dev` 让本地页面连接生产 api 时，localhost 的 Turnstile 结果不会被当成本地测试放行；调试对话应使用上面的本地 Worker 栈。本地 `AI` 绑定调用远程 Workers AI，需要 Wrangler 具备访问权限；强制档位只跳过 Clef，仍会调用所选 Anthropic 模型。

## 验证

从仓库根目录执行：

```sh
pnpm --dir workers/ai typecheck
pnpm --dir workers/ai test
pnpm exec eslint workers/ai/src
node scripts/verify-build-worker.mjs
```

`scripts/verify-build-worker.mjs` 用临时配置启动本地 workerd，以真实 Durable Object RPC 和 SQLite 验证并发一次性消费、额度、状态恢复与重启持久化；GitHub 和 routine 出站使用夹具。若依赖锁定的 workerd 不支持脚本配置的 `compatibility_date`，设置 `MINIFLARE_WORKERD_PATH` 指向支持该日期的本地 workerd 可执行文件。

`src/worker.test.ts` 验证路由边界、CORS、MCP 的公开状态 RPC、缺绑定时关闭入口与环境选择；聊天、配额和 MCP 的行为测试随实现放在本目录。涉及跨 Worker 读取或转发时，还要运行 [api 集成验证](../api/README.md#验证)。MCP 协议变更必须按上文「MCP」用真实客户端连接本地入口，不能仅以单元测试作为客户端兼容的证明。
