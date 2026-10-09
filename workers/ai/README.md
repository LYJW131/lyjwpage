# AI Worker

负责首页对话、模型调用、配额、GitHub issue 提交、站点工具与公开 MCP。站点状态的唯一权威仍是 [api Worker](../api/README.md)；Coding 的 Pulse 评估也留在 api 的 cron 中。

## 入口与权限

生产配置 `wrangler.toml` 设 `workers_dev=false`，不绑定独立公开域名；`preview_urls=true` 用于允许隔离的分支 Preview 使用 workers.dev 地址。生产 HTTP 只经 api 对外公开。浏览器与 MCP 客户端继续访问 api 的公开地址，api 按 `shared/ai-paths.ts#AI_HTTP_PATHS` 经 `AI_SERVICE.fetch(request)` 原样转发请求与响应流；来源校验、预检、限流和协议处理由本 Worker 执行。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/chat` | 首页对话，流式返回 NDJSON |
| GET | `/api/chat/usage` | 当前访客与全站的对话配额，只读不扣额度 |
| POST | `/api/github/issue` | 访客确认草稿并完成 GitHub 授权后提交 issue |
| POST | `/mcp` | 公开工具与需鉴权的 webhook 事件，Streamable HTTP MCP |
| GET | `/.well-known/oauth-protected-resource/mcp` | 已配置的 MCP OAuth 资源元数据，根 well-known 路径提供同文档别名 |

这些路径接受 CORS 预检；其他路径，包括未知路径的预检，均返回 404。入口在 `src/worker.ts`，共享来源匹配在根目录 `shared/http-origins.ts`。

`PUBLIC_STATUS` 是唯一的站点状态读取权限，契约为根目录 `shared/public-status.ts#PublicStatusRpc` 的 `readStatus(path: string): Promise<Response>`。api 的 `PublicStatus` 只接受 `src/lib/status-views.ts#STATUS_VIEWS` 登记的精确路径，返回浏览器使用的公开模型；不接受查询参数、任意 URL、凭据读取或写入。AI Worker 不绑定 `STATE`、`LAG`、`HISTORY`、`CREDENTIALS` 或 `StateCore`。

## 代码职责

- `src/index.ts`：Sentry 包装的 HTTP 入口，导出 `ChatQuota`、`AnthropicEgress`。
- `src/chat/`：Turnstile、模型分流、工具循环、流式事件、历史验签、配额与 Anthropic 出口。
- `src/tools/registry.ts#SITE_TOOLS`：首页对话与 MCP 共用的只读站点工具；读取由 `ToolIO` 注入。
- `src/mcp.ts`：MCP 协议处理，不调用模型。
- `src/github-issue.ts`：访客授权、创建 issue 与撤销短期 token。
- `src/sentry.ts#sentryOptions`：关闭请求正文、请求头与 cookie 收集；对话、OAuth code 和代理请求中的密钥不能进入 Sentry。`SENTRY_ENVIRONMENT` 优先，未配置时由 `PREVIEW_WORKER` 选择预览或生产环境。

下文 `src/chat/`、`src/tools/` 等后端路径相对于本目录；`shared/`、站点的 `src/components/`、`src/app/` 和 `docs/` 相对于仓库根目录。

## 首页对话

`POST /api/chat`（`src/chat/handler.ts`）收浏览器的对话历史与 Turnstile token，契约在 `shared/god-chat.ts`：请求体、NDJSON 事件、上下文与输出上限都在那一份，站点卡片 `src/components/god-chat.tsx` 读同一份。

- 一条消息的路径：请求体按读到的字节数截停（`src/chat/guard.ts#readJsonBody`）→ Turnstile 校验（`TURNSTILE_SECRET_KEY`；除了 success，还核对 action 是 `shared/god-chat.ts#GOD_CHAT_TURNSTILE_ACTION`、hostname 落在 `ALLOWED_ORIGINS` 里，见 `turnstilePassed`）→ `ChatQuota.admitVisitor` 在路由前过三道：访客总量、全站路由次数（`shared/god-chat-tiers.ts#GOD_CHAT_ROUTE_LIMIT`，各档全站名额之和）、这位访客此刻至少有一档访客与全站都有空位；访客自己超额回「Too many prayers」，全站忙回「All the heavens are busy」，都是 429，到此为止、不再触发付费的路由 → Clef 选档（`src/chat/router.ts`，经 `AI` 绑定调 `@cf/cloudflare/clef`，选项与思考强度在 `CLEF_CHOICES`；Clef 不可用时落到 `ROUTER_FALLBACK`）→ `ChatQuota.admitTier` 扣档位额度，该档满了就往下逐档降级（`shared/god-chat-tiers.ts#downgradeChain`）→ 调 Anthropic（`ANTHROPIC_API_KEY`）。refuse 不调模型，只占访客总量与一次全站路由，直接回一句关门话。
- 模型档位与人设的型号、展示名在 `shared/god-chat-tiers.ts#GOD_CHAT_TIER_INFO`。提示词在 `src/chat/handler.ts`：`BASE_PROMPT` 讲清 Clef 怎么选档、额度用完怎么降级，`PERSONA` 告诉每档自己是哪个模型、什么身份；被降级时另在末尾加一条 system 消息说明替谁作答（`downgradeNote`），不动缓存前缀。
- 额度数值在 `shared/god-chat-tiers.ts#GOD_CHAT_QUOTA`（窗口、访客总量、每档访客与全站），计数在 Durable Object `ChatQuota`（`src/chat/quota.ts`，全站共用实例，对象名由 `src/chat/handler.ts#quotaStub` 决定，SQLite 存窗口内的命中，每次调用先删窗口外的再数再记）。`/api/chat/usage` 读同一份；它不验人，每次都要进这个全站共用的对象跑一个事务，所以先过 Rate Limiting 绑定 `CHAT_USAGE_LIMIT` 按 IP 限流；这类绑定只作为尽力而为的入口保护，核验记录见 `docs/ops-facts.md`。`resetInMs` 倒数到这位访客看到的数下一次会变的时刻（自己最早的命中过期，或某档全站、全站路由次数已满时它最早的命中过期）；路由次数不单列在用量里。没有 `CHAT_QUOTA` 绑定时对话端点回 503，不放行。Anthropic 账户侧的花费上限与凭据配置只以 `docs/ops-facts.md` 的核验记录为准。
- 对 Anthropic 的请求经 `src/chat/egress.ts#anthropicFetch` 转给 Durable Object `AnthropicEgress`；出口位置取同文件的 `EGRESS_HINT`，主机白名单取 `ANTHROPIC_HOST`。对象只转发该上游，避免访客所在机房的地区限制；核验记录见 `docs/ops-facts.md`。没有这层绑定时直接发。
- 中断：Worker 开启 `enable_request_signal`，入站请求的 `signal` 一 abort 就停下工具循环，SDK 的 fetch 信号带进 `AnthropicEgress`，那边经带信号的管道取消对 Anthropic 的连接，避免原样直通响应体时取消延迟。只有运行时真的报了取消时这条路径才起作用，不能把访客点击停止当成上游已停止计费；生产断开信号的核验边界见 `docs/ops-facts.md`。未收到取消时仍受这条回复的 `maxTokens` 和配额约束，拒答兜底的溢出规则见下文。
- `draft_github_issue`（`src/chat/issue-draft.ts`）只起草：NDJSON 发一行 `issue`，卡片打开可编辑的表单，模型自己提交不了。访客点提交时在弹窗里走 GitHub App `LYJW131` 的用户授权，带 PKCE（S256）：卡片每次提交现生成 code verifier，只放在这次提交的内存里，授权 URL 只带它的 SHA-256。回调页 `src/app/github-callback/page.tsx` 与卡片同源，读完参数先把 code 从地址栏抹掉，只把 code 经 postMessage 交回同源窗口；卡片把 code、`codeVerifier` 和改过的标题正文 POST 到 `/api/github/issue`（`src/github-issue.ts`），verifier 不合 RFC 7636 的直接 400。Worker 用 `GITHUB_APP_CLIENT_SECRET` 加 verifier 换出访客的 token，单拿到 code 换不出来；以访客身份在 `shared/github-issue.ts#GITHUB_ISSUE_REPO` 开 issue，随即撤销 token，不存。这个端点按 IP 过 Rate Limiting 绑定 `GITHUB_ISSUE_LIMIT`。来源标记由 `src/github-issue.ts#FOOTER` 追加到正文。
- `show_card`（`src/chat/show-card.ts`）在回复里画一张实时卡片：模型只选卡片名，卡片名与每张卡片背后的状态视图登记在 `shared/god-chat.ts#GOD_CHAT_CARD_VIEWS`，模型给不了任何文字、图片或链接。NDJSON 发一行 `card`，站点 `src/components/chat-card.tsx` 按登记的视图读公开状态自己画，画在收到这一行时正文已到的位置；它和首页卡片共用 SWR 缓存键，推送写进同一份缓存、卡片跟着变，自己不轮询。工具结果把同一组视图的数据回给模型（走 `get_site_status` 的执行与这条回复的账本，读过的不再读），模型据此用一两句话作答、不复述卡片内容。同一条回复里同一张卡片只画一次。
- 请求带 `thinking.display: "summarized"`：模型思考时流出 `thinking` 事件（思考摘要），卡片在正文出来前显示，正文开始后折叠；摘要不进对话历史。
- 模型由 Anthropic 的拒答兜底（`fallbacks: "default"`，Haiku 没有）换掉时，NDJSON 末尾多一行 `served`，卡片标出实际作答的模型；下一轮的 trace 带 `fallback`。兜底按单次请求生效、兜底模型自己也可能拒，所以只按给出最终答案的那一轮、且它没被拒时才报。
- 读取类工具有三种。前两种是和 `/mcp` 共用的站点工具（`src/tools/registry.ts#SITE_TOOLS`），对话把整条回复的调用记在同一本账本（`newLedger`）上：`get_site_status` 经 `PUBLIC_STATUS.readStatus(path)` 调 api 的 `PublicStatus` 入口（和浏览器看到的同一份公开模型，走 Service Binding），一条回复里所有调用合计有视图数上限、读过的不再读（`src/tools/site-status.ts#claimViews`）；`read_project_doc` 读本项目的设计文档（`src/tools/project-docs.ts`），只认 `PROJECT_DOCS` 白名单里的文档键，运行时从公开仓库 main 分支的 raw.githubusercontent.com 取并在边缘缓存，所以改文档不用重发 Worker、新增文档才要加一行；长文档先回目录和开头，模型再按章节读，一条回复的读取次数有上限（`claimDoc`，上限说明经 `replyCap` 只附给对话）。`web_search` 是服务端工具，Haiku 用基础版，其余用带动态过滤的版本（原因写在 `src/chat/web-search.ts#webSearchTool`），每轮请求的 `max_uses` 是这条回复还剩的次数，用完就不再带这个工具。
- 历史由浏览器提交，Worker 给每一问一答盖章（`src/chat/seal.ts`，HMAC 密钥是 Secret `CHAT_HISTORY_SECRET`，缺了对话端点回 503）：回复正常结束时 NDJSON 末尾发一行 `seal`，带章和 trace（哪一档答的、实际 effort、读过哪些视图与文档、搜了几次、是否兜底代答、起草过 issue、画过哪些卡片），浏览器原样带回。章签的是「访客消息 + 回复 + trace」整对，进 Clef 与模型之前先验章，没有章或对不上的一对整对丢掉：Clef 拒掉的、模型拒答的、半路中断的、浏览器伪造或改过的都进不了上下文。验过章的 trace 拼成一条说明附在那条回复之前的访客消息里（`src/chat/history.ts`），模型因此知道那条回复当时查过什么；说明只用枚举与计数拼，不带自由文本。
- 回复上限按档位定（`shared/god-chat-tiers.ts#GOD_CHAT_TIER_INFO` 的 `maxTokens`）；思考强度在选中 Haiku 时由 Clef 一并选出，其余情况（Opus、Fable、降级、强制档位、Clef 不可用）取同一处的 `effort` 默认值。访客没有手动调高的命令。`maxTokens` 是一条回复所有轮次（工具循环、暂停续跑）合计的输出上限，每轮请求只给剩下的部分；每轮按计费量扣（`src/chat/billing.ts#billedOutputTokens`）。同一请求内本档中途拒答后兜底模型还能再用满一次 `max_tokens`，这部分溢出有意接受。各档都用 [Claude 官方的消息级 effort](https://platform.claude.com/docs/en/build-with-claude/effort#per-message-effort-beta)，请求参数以 `src/chat/handler.ts#converse` 为准：保持 adaptive thinking，不设置请求顶层的 effort；`src/chat/history.ts#toModelMessages` 在强度变化的访客消息前插入空 `system` 消息及 `output_config.effort`，工具续跑继承该强度。实际 effort 随已签名的 trace 回传，后续按原位置重放，切换当前强度不重写历史前缀。省钱靠 system 与末尾各一个缓存断点；缓存按模型分开，换档不会互相命中，历史裁剪和工具定义变化仍会影响命中。

## MCP

`POST /mcp`（`src/mcp.ts`）是给外部 AI 用的 MCP 端点，工具读取无鉴权，事件目录和操作要求外部 OAuth 授权服务器签发的访问令牌。站点在根目录 `next.config.ts` 中将 `/mcp` 用 307 跳到 `NEXT_PUBLIC_BACKEND_URL` 对应的 api，api 再经 Service Binding 交给本 Worker。307 保留 POST 与请求体；不用 Vercel rewrite，避免 `CF-Connecting-IP` 变成共用的 Vercel 出口 IP。公开访问域名见 `docs/ops-facts.md`；OAuth 连接应使用事件配置里的规范 Worker 资源地址，配置契约见下文。

- 工具就是 `src/tools/registry.ts#SITE_TOOLS`，和首页对话同一份定义与执行。这里只放只读、只读公开模型的工具：`draft_github_issue`（要访客在卡片里确认）、`show_card`（只对对话卡片有意义）和 `web_search`（Anthropic 服务端工具）只在对话里。每次调用各开一本账本，单次调用的视图数与截断长度和对话相同，跨调用不累计。
- 协议：HTTP 无会话，只回 JSON，不发会话 ID，不开 SSE（GET、DELETE 回 405），JSON-RPC 批量请求回 400。两代工具客户端都收：`_meta` 里带版本的新协议（`MODERN_VERSIONS`）逐个请求核对 `MCP-Protocol-Version`、`Mcp-Method`、`Mcp-Name` 头与正文一致，`server/discover`、`tools/list` 带缓存提示（`CACHE_HINTS`，缺了 Claude Code 整张工具表都不认）；旧协议（`LEGACY_VERSIONS`）先 `initialize` 握手。事件仅对现代协议开放，订阅独立持久化，不依赖 HTTP 会话。
- 事件：配置完整且具备事件绑定时公开 `events` 能力；`events/list`、`events/subscribe`、`events/unsubscribe` 仍要求 OAuth。资源元数据和 HTTP 认证 challenge 引导客户端授权，AI Worker 验证受信任发行方的 JWT，不托管账号或签发令牌。`watching-now` 只报告采样检测到的播放条目或暂停状态变化，不发送进度刷新。`McpEventHub` 经 `PUBLIC_STATUS` 读公开模型，SQLite 持久化订阅、基线与待投递通知。外部授权服务器前提、配置、事件 schema、采样缺口、回调安全、重试和未完成的真实接入验收统一见 [MCP Events](../../docs/mcp-events.md)。未配置事件鉴权或回调白名单时事件关闭，公开工具仍可用。
- 限流与来源：按 `CF-Connecting-IP` 过 Rate Limiting 绑定 `MCP_LIMIT`，拦下时回 429 带 `Retry-After`；和 `CHAT_USAGE_LIMIT` 一样只是尽力而为，核验记录见 `docs/ops-facts.md`。带 `Origin` 的请求按 `ALLOWED_ORIGINS` 校验（与 `/api/*` 同口径），不在名单里回 403；服务端和桌面端的 MCP 客户端不带 `Origin`，不受影响。
- 验证：`src/mcp.test.ts` 覆盖两代握手与报错，但客户端会按自己的 schema 严格校验结果，单测验不出这类不兼容；改了协议处理，起 `pnpm dev:worker` 后用真实客户端各连一次：`claude -p --strict-mcp-config --mcp-config '{"mcpServers":{"lyjw":{"type":"http","url":"http://localhost:8788/mcp"}}}' "…"` 走新协议，`npx @modelcontextprotocol/inspector --cli http://localhost:8788/mcp --transport http --method tools/list` 走旧协议握手。

## 配置与部署

绑定与变量的代码契约在 `src/runtime.ts#Env`，生产绑定在 `wrangler.toml`。模型与验人使用 `AI`、`ANTHROPIC_API_KEY`、`TURNSTILE_SECRET_KEY`，历史签名使用 `CHAT_HISTORY_SECRET`，提交 issue 使用 `GITHUB_APP_CLIENT_SECRET`。`CHAT_QUOTA` 和 `ANTHROPIC_EGRESS` 指向各自的 Durable Object；`CHAT_USAGE_LIMIT`、`GITHUB_ISSUE_LIMIT`、`MCP_LIMIT` 保护对应入口。配额阈值取根目录 `shared/god-chat-tiers.ts#GOD_CHAT_QUOTA`，入口限流配置取 Wrangler 文件，不另抄数值。

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

聊天凭据放 `workers/ai/.dev.vars`：`ANTHROPIC_API_KEY`、`TURNSTILE_SECRET_KEY`、`CHAT_HISTORY_SECRET` 必须齐全，否则聊天回 503；issue 提交另需 `GITHUB_APP_CLIENT_SECRET`。本地 `wrangler.test.toml` 设置 `AI_DEV=true`；`src/runtime.ts#aiDevEnabled` 只在 `AI_DEV=true` 或 `PREVIEW_WORKER=true` 时放宽 localhost / Turnstile 测试密钥校验，并启用以下调试变量：

- `CHAT_RATE_LIMIT=off`：配额仍记账、`/usage` 仍显示用量，但不拦截。
- `CHAT_FORCE_TIER=<档位或 CLEF_CHOICES 的键>`：跳过 Clef；合法值见根目录 `shared/god-chat-tiers.ts#GOD_CHAT_TIERS` 与 `src/chat/router.ts#CLEF_CHOICES`。

生产缺省不开调试权限，不能靠 `UPSTREAM_API_URL` 或只设置调试变量绕过验人及配额。使用 `pnpm dev` 让本地页面连接生产 api 时，localhost 的 Turnstile 结果不会被当成本地测试放行；调试对话应使用上面的本地 Worker 栈。本地 `AI` 绑定调用远程 Workers AI，需要 Wrangler 具备访问权限；强制档位只跳过 Clef，仍会调用所选 Anthropic 模型。

## 验证

从仓库根目录执行：

```sh
pnpm --dir workers/ai typecheck
pnpm --dir workers/ai test
pnpm exec eslint workers/ai/src
```

`src/worker.test.ts` 验证路由边界、CORS、MCP 的公开状态 RPC、缺绑定时关闭入口与环境选择；聊天、配额和 MCP 的行为测试随实现放在本目录。涉及跨 Worker 读取或转发时，还要运行 [api 集成验证](../api/README.md#验证)。MCP 协议变更必须按上文「MCP」用真实客户端连接本地入口，不能仅以单元测试作为客户端兼容的证明。
