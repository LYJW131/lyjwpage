# AI Worker

负责首页对话、设计与访客构建、首页近况摘要、模型调用、配额、GitHub issue 提交、站点工具与公开 MCP。站点状态的唯一权威仍是 [core Worker](../core/README.md)；Coding 的 Pulse 评估也留在 core 的 cron 中。

## 入口与权限

生产配置 `wrangler.toml` 设 `workers_dev=false`、`preview_urls=false`，不绑定独立公开域名，也没有 workers.dev 地址。生产 HTTP 只经站点域名进来：site Worker 按 `src/lib/site-policy.ts#classifyGatewayRequest` 分出，经 `AI_SERVICE.fetch(request)` 原样转发请求与响应流。core 没有公开地址，它按 `shared/ai-paths.ts#AI_HTTP_PATHS` 认出并转发的那条路只在分支 Preview 与本地用到。来源校验、预检、限流和协议处理由本 Worker 执行。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/chat` | 首页对话，流式返回 NDJSON |
| GET | `/api/chat/usage` | 当前访客与全站的对话配额，只读不扣额度 |
| POST | `/api/build` | 访客每次都完成 GitHub PKCE 授权：授权码当场换令牌、查身份后立即吊销，再一次性消费计划与额度、开草稿 PR，并以 `repository_dispatch` 派发构建工作流 |
| GET | `/api/build/status` | 持状态 token 查询 run 并按需对账 |
| GET | `/api/build/issue` | 持计划 token 确认访客是否已用预填表单提交这份计划的 issue |
| POST | `/api/build/upload` | 构建工作流持 GitHub Actions OIDC 令牌提交文件，每个 run 只收一次 |
| POST | `/api/build/progress` | 构建工作流持 OIDC 令牌报告计划审查结果、进度或 `blocked` |
| POST | `/api/build/screenshot` | 构建工作流在上传前持 OIDC 令牌提交界面截图，存进 R2 图片桶，PR 开出后由 App 评论 |
| POST | `/api/build/webhook` | 验证 GitHub webhook 并更新构建状态 |
| POST | `/mcp` | 无鉴权的 Streamable HTTP MCP |

浏览器端点检查允许来源；上传、进度、截图和 webhook 接受无 Origin 的服务器请求，前三者验证 GitHub Actions OIDC 令牌（`src/build/actions-oidc.ts#verifyActionsToken`），webhook 验证原始正文 HMAC。这些路径接受 CORS 预检；其他路径，包括未知路径的预检，均返回 404。入口在 `src/worker.ts`，共享来源匹配在根目录 `shared/http-origins.ts`。

`PUBLIC_STATUS` 是唯一的站点状态读取权限，契约为根目录 `shared/public-status.ts#PublicStatusRpc` 的 `readStatus(path: string): Promise<Response>`。core 的 `PublicStatus` 只接受 `shared/status-views.ts#STATUS_VIEWS` 登记的精确路径，返回浏览器使用的公开模型；不接受查询参数、任意 URL、凭据读取或写入。AI Worker 不绑定 `STATE`、`LAG`、`HISTORY`、`CREDENTIALS` 或 `StateCore`。

## 代码职责

- `src/index.ts`：HTTP 入口，导出 `ChatQuota`、`AnthropicEgress`、`BuildCoordinator`、`ChatLog` 与具名入口 `Digest`。
- `src/chat/`：Turnstile 与通行证、模型分流、工具循环、流式事件、历史验签、配额与 Anthropic 出口。
- `src/tools/registry.ts#SITE_TOOLS`：首页对话与 MCP 共用的只读站点工具；读取由 `ToolIO` 注入。
- `src/mcp.ts`：MCP 协议处理，不调用模型。
- `src/digest/`：首页近况摘要，见「近况摘要」。
- `src/build/`：构建令牌、构建工作流的 OIDC 校验、上传路径验证、GitHub App 调用与工作流派发、webhook、状态对账与 `BuildCoordinator`。构建工作流、提示词指针与完整配置见 [访客协作构建](../../docs/build-routine.md)。
- 日志与 Issues 在 Workers Observability 的服务 `ai` 下；`console` 调用只记错误对象和固定前缀，不带对话、OAuth code 和代理请求中的密钥。

下文 `src/chat/`、`src/tools/` 等后端路径相对于本目录；`shared/`、站点的 `src/components/`、`src/app/` 和 `docs/` 相对于仓库根目录。

## 首页对话

`POST /api/chat`（`src/chat/handler.ts`）收浏览器的对话历史与 Turnstile token 或通行证，契约在 `shared/god-chat.ts`：请求体、NDJSON 事件、上下文与输出上限都在那一份，站点卡片 `src/components/god-chat.tsx` 读同一份。

- 普通消息的路径：请求体按读到的字节数截停（`src/chat/guard.ts#readJsonBody`）→ 通行证或 Turnstile 校验（通行证是验过人后下发的 `pass` 事件，不绑 IP，有效期见 `shared/god-chat.ts#GOD_CHAT_PASS_TTL_MS`，用掉一半后随回复换新的，期内免新 token；过期或验签失败回 403 `human_pass_expired`，卡片丢掉它、当场验人重发；签发与核验在 `src/chat/pass.ts`；Turnstile 用 `TURNSTILE_SECRET_KEY`，除了 success，还核对 action 是 `shared/god-chat.ts#GOD_CHAT_TURNSTILE_ACTION`、hostname 落在 `ALLOWED_ORIGINS` 里，见 `turnstilePassed`）→ `ChatQuota.admitVisitor` 在路由前过三道：访客总量、全站路由次数（`shared/god-chat-tiers.ts#GOD_CHAT_ROUTE_LIMIT`，各档全站名额之和）、这位访客此刻至少有一档访客与全站都有空位；访客自己超额回「Too many prayers」，全站忙回「All the heavens are busy」，都是 429，到此为止、不再触发付费的路由 → Clef 选档（`src/chat/router.ts`，经 `AI` 绑定调 `@cf/cloudflare/clef`，选项在 `CLEF_CHOICES`；Clef 不可用时落到 `ROUTER_FALLBACK`）；对话第一条与首页示例问题（`shared/god-chat.ts#GOD_CHAT_PRESETS`）原文一致时不调 Clef，按示例写定的档位走（`src/chat/router.ts#presetRoute`），示例写了 `prefetch` 的，Worker 在第一次模型请求前跑好这些工具调用，写成一轮模型已调过的工具随请求发出（`src/chat/converse.ts#converse`），模型不必再自己调一轮；其余消息在选档的同一次 Clef 调用里另答两题：要先读哪组站点状态（`src/chat/router.ts#PREFETCH_STATUS`）、要先读哪篇项目文档，选中项的概率不低于该题在 `PREFETCH_MIN_PROBABILITY` 里的阈值才照同样方式预取（拒答与设计请求不预取）；同时并行调一次 `@cf/cloudflare/clairic`，从最新一条里抽访客点名的游戏、歌、番名（`src/chat/router.ts#itemInput`），只在 Clef 选中标了 `query` 的状态分组时才等它；抽到的条目过了 `ITEM_MAX_P_NULL` 与 `ITEM_MIN_CONFIDENCE` 时，在整组之外再预取一次带这个 `query` 的 `get_site_status`，读的是该组 `query` 列出的有列表视图（译名与记录里的原名对不上时整组仍在）；标了 `card` 的组（游戏与奖杯）在这次读取之后再预取一次 `show_card` 画那款游戏的卡，卡片因此排在正文前面（抽到的是奖杯名或译名、对不上游戏时这次调用报错，数据仍靠前面的读取）；Clairic 出错或超时只是少这一次读取，每次 Clef 选档记一行 `[god-chat] route`（档位、状态与文档题的选项和概率、有没有抽到条目、预取几次，不记原文），预取记一行 `[god-chat] prefetch` 日志（档位、来源是示例还是 Clef、调了哪些工具）；改这几题的判据先用 `pnpm --dir workers/ai route:probe` 在线上 Clef 跑代表性问题（用法见 `scripts/route-probe.ts` 的 `USAGE`）→ `ChatQuota.admitTier` 扣档位额度，该档满了就往下逐档降级（`shared/god-chat-tiers.ts#downgradeChain`，只在 `GOD_CHAT_RANKS` 三档里降）→ 按档位的 `provider` 调 DeepSeek（`DEEPSEEK_API_KEY`）或 Anthropic（`ANTHROPIC_API_KEY`）。refuse 不调模型，只占访客总量与一次全站路由，直接回一句关门话。
- 模型档位与人设的型号、展示名、供应商与开不开思考在 `shared/god-chat-tiers.ts#GOD_CHAT_TIER_INFO`：Clef 只判档次（`GOD_CHAT_RANKS`），由谁出场看访客在卡片里选的阵容（`GOD_CHAT_LINEUPS`，请求体的 `lineup`，缺省 DeepSeek；浏览器侧记在 `src/lib/chat-lineup.ts`）：DeepSeek 阵容的 Small Fry 与 Prophet 都是 DeepSeek Flash，区别只在 `thinking`；Claude 阵容是 Haiku 与 Sonnet；God 都是 Fable。额度按出场的档位分开算（`GOD_CHAT_QUOTA`），`ChatQuota.admitVisitor` 的空位与 `downgradeChain` 的降级都只在访客所选阵容里算。DeepSeek 两档走它的 Anthropic 兼容接口（`src/chat/handler.ts#DEEPSEEK_BASE_URL`），用同一个 Anthropic SDK 发请求，差异在 `src/chat/converse.ts#converse` 里处理：不带 beta 头、`fallbacks` 与 tool search，领域工具常驻（`defer_loading: false`），搜索结果回成纯文本（接口不收 `search_result` 块与引用，`DEEPSEEK_NOTE` 让模型在正文里写链接，来源列表取正文里出现过的搜索结果 URL）；开思考又带工具时接口要求每条带 `tool_use` 的助手消息回传思考块，Worker 预取与升档前的调用没有思考，请求时补占位块（`withThinking`）。提示词在 `src/chat/prompts.ts`：`BASE_PROMPTS`（按阵容各拼一份，保持缓存前缀不变）讲清 Clef 怎么选档、额度用完怎么降级，并带一份 lyjw 的小档案（没有上班、Mac 是笔记本、云端 agent 会自己跑等），免得模型读状态时乱猜，`PERSONA` 告诉每档自己是哪个模型、什么身份；被降级时另在末尾加一条 system 消息说明替谁作答（`downgradeNote`），不动缓存前缀。
- 额度数值在 `shared/god-chat-tiers.ts#GOD_CHAT_QUOTA`（窗口、访客总量、每档访客与全站），计数在 Durable Object `ChatQuota`（`src/chat/quota.ts`，全站共用实例，对象名由 `src/chat/handler.ts#quotaStub` 决定，SQLite 存窗口内的命中，每次调用先删窗口外的再数再记）。`/api/chat/usage` 读同一份；它每次都要进这个全站共用的对象跑一个事务，所以先过 Rate Limiting 绑定 `CHAT_USAGE_LIMIT` 按 IP 限流；这类绑定只作为尽力而为的入口保护，核验记录见 `docs/ops-facts.md`。`resetInMs` 倒数到这位访客看到的数下一次会变的时刻（自己最早的命中过期，或某档全站、全站路由次数已满时它最早的命中过期）；路由次数不单列在用量里。没有 `CHAT_QUOTA` 绑定时对话端点回 503，不放行。Anthropic 账户侧的花费上限与凭据配置只以 `docs/ops-facts.md` 的核验记录为准。
- 对话记录存在 Durable Object `ChatLog`（`src/chat/transcripts.ts`，全站一个实例，对象名 `global`）：每个请求一行，含发给模型的整段历史（只留 `role`、`content`、`time`）、这次回复全文、路由、档位、工具调用摘要（`trace`）与结果（完成、未完成、失败、中断、拒答），不存 IP 与令牌；保留 `TRANSCRIPT_RETENTION_MS`，写入和 alarm 时删除到期的行。首页隐私说明按这个期限写。分支预览不绑 `CHAT_LOG`，不记。agent 调试时用 Cloudflare Code Mode MCP 调 Cloudflare API 的「Query a Durable Object」（`POST /accounts/{account_id}/workers/durable_objects/namespaces/{id}/query/v2`，命名空间 `ai_ChatLog`，请求体 `durable_object_name: "global"`、`jurisdiction: "none"`）直接查这张表，只跑 `SELECT`，不改不删；按回复原文找某条用 `reply LIKE ?`。
- DeepSeek 的请求从 Worker 直接发出。对 Anthropic 的请求经 `src/chat/egress.ts#anthropicFetch` 转给 Durable Object `AnthropicEgress`；出口位置取同文件的 `EGRESS_HINT`，主机白名单取 `ANTHROPIC_HOST`。对象只转发该上游，避免访客所在机房的地区限制；核验记录见 `docs/ops-facts.md`。没有这层绑定时直接发。
- 中断：Worker 开启 `enable_request_signal`，入站请求的 `signal` 一 abort 就停下工具循环，SDK 的 fetch 信号带进 `AnthropicEgress`，那边经带信号的管道取消对 Anthropic 的连接，避免原样直通响应体时取消延迟。只有运行时真的报了取消时这条路径才起作用，不能把访客点击停止当成上游已停止计费；生产断开信号的核验边界见 `docs/ops-facts.md`。未收到取消时仍受这条回复的 `maxTokens` 和配额约束，拒答兜底的溢出规则见下文。
- 站点改动请求由 Clef 路由给开思考的 `think` 档，候选请求仍扣普通额度，该档无空位时返回 429，不降级；它判断值得做时调用 `start_design`，开启轮计入设计轮数。设计会话跑在 Claude Managed Agents（`src/chat/designer.ts`）：`start_design` 用 `agent_with_overrides` 建会话，模型、提示词（`src/chat/design.ts#PLANNER_PROMPT`）和工具每个会话从代码覆盖，Console 上的 agent（`DESIGN_AGENT_ID`）只是壳，environment（`DESIGN_ENVIRONMENT_ID`）只放行 `src/chat/design-hosts.ts#DESIGN_WEB_HOSTS`，web_search 与 web_fetch 也用 `allowed_domains` 限在这些主机；会话带 `src/chat/design.ts#DESIGN_BUDGET_CENTS` 的硬预算，到顶时平台暂停会话、回复里说明。会话 ID 签进设计令牌；开场回合不在本条回复里跑——访客先看到设计模式的隐私确认，同意后浏览器带 `resume: true` 与令牌补发，Worker 见空会话即把那段对话作为开场交给会话里的 Opus 规划者，期间不向会话发任何访客内容，NDJSON 再发一次 `route` 事件；持有效令牌的后续消息直接转给同一个会话，扣 `BuildCoordinator` 中的专属轮数，跳过 Clef 与普通配额；会话期限、轮数和全站上限以 `shared/build-routine.ts#BUILD_DESIGN_LIMITS` 为准。规划者在沙盒里克隆公开仓库，用 Managed Agents 自带的 read、glob、grep、bash（`auto` 权限，停下等确认的调用一律拒绝；write、edit 关闭）和 web_search、web_fetch；自定义工具 `get_site_status` 由 Worker 当场作答，`ask_visitor` 与 `propose_build` 校验通过后挂起：会话停在 `requires_action`，访客下一条消息作为那次调用的 `user.custom_tool_result` 发回，没有挂起的调用时才发 `user.message`。题目不合规、计划被 `src/build/validation.ts#checkBuildPlan` 拒绝时立刻把原因回给规划者。NDJSON 发送 `design` / `ask` / `plan` 事件，正文按 `event_deltas` 实时推；Managed Agents 不给思考内容，规划者读仓库文件发 `doc` 事件，其余每一步发一行 `step` 事件作进度。访客断线时线上 Worker 照样把那一回合跑完（见 `docs/ops-facts.md`），浏览器随后带 `resume: true` 重发同一份历史：Worker 只校验令牌、不扣轮数，从会话事件里找到访客最新那条对应的回合开场，重推之后的文字、进度和仍挂起的题目或计划（计划重新签发），回合还在跑就跟着事件流到停下，期间不向会话发任何事件；会话还没有任何事件时同样按补发处理、把整段历史作为开场上传（设计同意的补发就走这条路），开场先在 `BuildCoordinator#claimDesignOpen` 按会话抢一次租约，同时到的另一份补发（复制的标签页）抢不到就等开场落进会话，再按断线补发跟着看同一回合；回合开场存在但对不上访客最新那条时返回 409 `nothing_to_resume`。Managed Agents 的会话记录与沙盒不会自己过期，`scheduled`（`wrangler.toml` 的 cron）按 `src/chat/design-cleanup.ts#deleteExpiredDesignSessions` 删除设计 agent 下令牌过期又过了 `DESIGN_SESSION_GRACE_MS` 的会话，删除时连同事件和沙盒一起移除。每条设计回复记一行 `[god-chat] design turn` 日志（会话 ID、停止原因、模型请求数与 token），不记对话正文与工具输入。
- Open issue 在访客浏览器里直接打开 GitHub 预填链接（`shared/build-routine.ts#buildIssueUrl`），按计划填好 `improvement.yml` 表单的标题与各字段，访客在 GitHub 上自行提交，不经过本 Worker、不消费计划；卡片随后凭计划 token 轮询 `/api/build/issue`，本 Worker 按表单里带 `issueRef` 的隐藏标记在 GitHub 上认出这份计划的 issue。Start build 每次通过 PKCE 验证 GitHub 身份，由 GitHub App 先提交已确认计划并创建草稿 PR，再派发 GitHub Actions 构建工作流（先由 Claude 审查计划，通过后在沙盒里实现）；实现经 Worker 校验后追加到同一分支和 PR，满足 CI 条件后转为待审。计划只被 Start build 消费一次，同账号的构建重试只恢复原 run；身份、恢复与上传契约见 [访客协作构建](../../docs/build-routine.md)。
- `show_card`（`src/chat/show-card.ts`）在回复里画一张实时卡片：模型只选卡片名，卡片名与每张卡片背后的状态视图登记在 `shared/god-chat.ts#GOD_CHAT_CARD_VIEWS`，模型给不了任何文字、图片或链接。每张卡片只对应一个视图，「此刻」和「最近」分开画，访客只问此刻时模型只画此刻那张；例外是单个游戏的 `game` 卡：模型另给游戏名，Worker 按名字在游玩记录里查出 titleId（`src/chat/show-card.ts#findGame`，比较时忽略大小写、全半角、空格与标点），随 `card` 事件的 `game` 发给浏览器，卡片读游玩记录与奖杯摘要两个视图，画封面、时长、次数、最近游玩与各级奖杯数；查不到就回工具错误、不画卡，同一款游戏一条回复只画一次。NDJSON 发一行 `card`，站点 `src/components/chat-card.tsx` 按登记的视图读公开状态自己画，画在收到这一行时正文已到的位置；它和首页卡片共用 SWR 缓存键，推送写进同一份缓存、卡片跟着变，自己不轮询。工具结果把同一个视图的数据回给模型（走 `get_site_status` 的执行与这条回复的账本，读过的不再读），模型据此用一两句话作答、不复述卡片内容。同一条回复里同一张卡片只画一次。
- 公式按 `$$…$$` 用 KaTeX 渲染（`src/lib/chat-markdown-plugins.ts`，站点侧），单个 `$` 不当公式，免得价格被吞；提示词把这条规矩告诉模型。回复里的其他图示不走工具：提示词按 `shared/god-chat.ts` 的 `GOD_CHAT_VISUAL_EXAMPLES` 与 `GOD_CHAT_VISUAL_LIMITS` 生成每种组件的说明、上限和例子（`stats`、`chart`、`timeline`、`media`、`diagram`），模型在正文里写以组件名为语言标记、内容为 JSON 的代码块。校验只有一份，`shared/god-chat.ts#checkGodChatVisual`：站点在 `src/lib/chat-visuals.ts` 带上图片与链接的放行规则调用它，再用 `src/components/chat-visual.tsx` 画，校验不过就照原样显示代码；Worker 在回复结束后用同一份校验跑一遍，过不了的记进 `[god-chat] fences` 日志的 `invalid`，漏写末尾括号、补齐后画得出的记进 `repaired`（补法见 `shared/god-chat.ts#closeVisualBrackets`，日志在 `src/chat/reply-fences.ts`）。组件画不了的才写 `html` 代码块，进断网沙箱（`src/lib/html-preview.ts`）。图示是正文的一部分，随回复进历史签章。
- 请求不带 `thinking.display: "summarized"`：带上后 Anthropic 把思考摘要和正文攒到一轮结束才一起发，首字变晚、正文不再流式，所以思考内容保持默认的不返回。浏览器仍处理 `thinking` 事件（卡片在正文出来前显示、正文开始后折叠，摘要不进对话历史），目前请求不会产生它。
- 模型由 Anthropic 的拒答兜底（`fallbacks: "default"`，只有 Anthropic 的档有）换掉时，NDJSON 末尾多一行 `served`，卡片标出实际作答的模型；下一轮的 trace 带 `fallback`。兜底按单次请求生效、兜底模型自己也可能拒，所以只按给出最终答案的那一轮、且它没被拒时才报。
- 读取类工具有四种。前两种是和 `/mcp` 共用的站点工具（`src/tools/registry.ts#SITE_TOOLS`），对话把整条回复的调用记在同一本账本（`newLedger`）上：`get_site_status` 经 `PUBLIC_STATUS.readStatus(path)` 调 core 的 `PublicStatus` 入口（和浏览器看到的同一份公开模型，走 Service Binding），一条回复里所有调用合计有读取次数上限，「视图 + 位置 + query + detail」完全相同的读取不再读，换页或换 query 另算一次，trace 里仍只记读过哪些视图（`src/tools/site-status.ts#claimViews`）。拿到完整 JSON 后才在本 Worker 加工，`readStatus` 契约不变：`detail` 缺省为 `"summary"`，删掉图片字段（判定见 `isImageField`），`"full"` 保留全部字段；时间点字段（以 At 结尾的、`since`、`from` / `to`、`start`，毫秒、Unix 秒或 ISO 字符串都认）换成 `Asia/Shanghai` 本地时间 `YYYY-MM-DD HH:mm`，后附按本地日历日算的相对日（`today`、`yesterday`、`N days ago` 等），时长字段仍是毫秒（`src/tools/site-status.ts#localTimes`），免得模型自己换算算错日期；`pulse` 视图在这之前先由 `src/tools/pulse-shape.ts#pulseForModel` 把按列存的相对秒数组改成各道带时间的行（听歌、看片、游戏只留在放的时段，编码道合成活跃时段，Tokens、充电、步数只留合计），否则编码道一道就超出截断长度，后面的听歌道到不了模型；`query` 按 NFKC 加小写匹配，只保留递归包含该文本的列表项；处理后超过 `PAGE_SIZE` 的列表（或带 query 时被搜索的列表）换成 `{ total, items, nextCursor? }`，带 query 时另有 `totalBeforeQuery`。只处理最外层的对象列表，匹配的条目整项保留；纯数值或字符串数组（如热力图的逐日序列）整份保留、不分页也不按 query 筛，带合法 `origin` 日期的数值数组另附按月合计 `<数组名>ByMonth` 、最近几天带日期的逐日值 `<数组名>LastDays` 与近 7 天、近 30 天、全部的合计 `<数组名>Sums`（`withMonthlyTotals`）；同一视图的长列表共用一个位置。分页沿用 MCP 规范 Pagination 的约定，用在工具参数上：页面大小由服务端决定，`cursor` 不透明，须原样传回，它决定视图、query 与 detail，同时传入的这几个参数被忽略并附提示；没有 `nextCursor` 就是最后一页；列表总数与 cursor 记录的不一致时照常返回并提示；非法或越界的 cursor 回工具错误、不占额度。每个视图先给一行摘要（分页列表、总数、`nextCursor`），兜底截断只截后面的 JSON。`show_card` 回给模型的数据走同一套默认处理；`read_project_doc` 读本项目的设计文档（`src/tools/project-docs.ts`），只认 `PROJECT_DOCS` 白名单里的文档键，运行时从公开仓库 main 分支的 raw.githubusercontent.com 取并在边缘缓存，所以改文档不用重发 Worker、新增文档才要加一行；长文档先回目录和开头，模型再按章节读，一条回复的读取次数有上限（`claimDoc`，上限说明经 `replyCap` 只附给对话）。`web_search` 与 `web_fetch` 是本 Worker 执行的客户端工具（`src/chat/web-search.ts`），后端由 `webSearchProvider` 定：搜索默认 Exa 的 `lite` 档，变量 `WEB_SEARCH_PROVIDER=deepseek` 时改用 DeepSeek Search（`/v1/tools/search`，没有分类，`category` 不生效）；读页有 `EXA_API_KEY` 就走 Exa，没有才用 DeepSeek Fetch。两个 key 都没配就不带这两个工具；`web_search` 的 `category` 可选网页、新闻、论文（只对 Exa 生效）。领域工具 `anime_search`（Bangumi）与 `game_search`（Steam 商店）也由本 Worker 直接调免 key 的公开接口（`src/chat/domain-search.ts`）。这些工具每次调用记一行 `[god-chat] web` 日志（哪个工具、耗时、结果数或错误，不记查询与 URL），Anthropic 的档拿到的结果是 `search_result` 块，模型的引用是 `search_result_location`，来源列表从这里收；DeepSeek 的档拿纯文本（`searchResultText`）。三个搜索工具合计的次数上限是 `shared/god-chat.ts#GOD_CHAT_LIMITS` 的 `maxWebSearches`，读页上限是 `MAX_WEB_FETCHES`；`web_fetch` 只读访客消息里写过、或本条回复 `web_search` 结果里出现过的 http(s) URL，页面里出现的链接不算，免得网页里的指令让模型把对话拼进 URL 带出去；页面由 Exa（或 DeepSeek Fetch）代抓，Worker 不直连目标站。`src/chat/doc-search.ts` 里另有四组走 Claude API MCP connector 的文档检索工具（Context7、Cloudflare 文档、grep.app、DeepWiki），目前停用、请求不带 `mcp_servers` 与 `mcp-client` beta：挂上它们实测每轮响应头要多等约 2 秒。恢复时把它们加回 `src/chat/converse.ts#converse` 的工具、beta 与 `mcp_servers`，并把提示词里的工具清单与首页隐私说明 `src/components/god-chat.tsx#CONSENT_COPY` 里的去向一起加回。
- 渐进式披露（只在 Anthropic 的档）：站点工具、`show_card`、`web_search`、`web_fetch` 等常驻；领域工具与全部 MCP 工具设 `defer_loading`，每轮带上 Claude API 的 tool search（`TOOL_SEARCH_TOOL`，BM25），模型搜到才加载定义，系统提示列出按需工具的类别。历史里 tool search 留下的 `tool_reference` 指向的工具不在列表里时整轮 400，所以工具列表每轮都带全：搜索次数用完时领域工具仍在、调用回错误，收尾轮也带全部工具，改用 `tool_choice: none` 禁止调用。

- 历史由浏览器提交，Worker 给每一问一答盖章（`src/chat/seal.ts`，HMAC 密钥是 Secret `CHAT_HISTORY_SECRET`，缺了对话端点回 503）：回复正常结束时 NDJSON 末尾发一行 `seal`，带章和 trace（哪一档答的、实际 effort、读过哪些视图与文档、搜了几次、是否兜底代答、是否进入设计、是否生成计划、画过哪些卡片），浏览器原样带回。章签的是「访客消息 + 回复 + trace + 计划 token」整对；设计会话与构建状态另用带用途的 HMAC token 验证，进 Clef 与模型之前先验章，没有章或对不上的一对整对丢掉：Clef 拒掉的、模型拒答的、半路中断的、浏览器伪造或改过的都进不了上下文。验过章的 trace 拼成一条说明附在那条回复之前的访客消息里（`src/chat/history.ts`），模型因此知道那条回复当时查过什么；说明只用枚举与计数拼，不带自由文本。
- Small Fry 作答时带 `request_upgrade` 工具（`src/chat/prompts.ts#UPGRADE_TOOLS`）：它判断问题超出自己时先调这个工具，Worker 向 `ChatQuota` 扣一个所选阵容先知档的名额（DeepSeek 阵容是 `think`，Claude 阵容是 `sonnet`；不降级、不动杂鱼档已扣的名额），成功就丢掉这一轮的草稿，由 Prophet 带着原对话重答，流里补发一条 `route`（`tier` 是那个先知档，无 `downgradedFrom`），回复上限与强度按它重算；先知档没空位时工具回错误，Small Fry 自己答完。升级只在非设计会话里开放，Fable 仍然只由 Clef 派。
- 回复上限按档位定（`shared/god-chat-tiers.ts#GOD_CHAT_TIER_INFO` 的 `maxTokens`），设计会话的花费由会话预算约束；思考强度一律取 `GOD_CHAT_TIER_INFO` 的 `effort`（设计会话里的 Opus 用 `GOD_CHAT_TIER_INFO.opus.effort`），`thinking: false` 的档整条回复发 `thinking: disabled`。访客没有手动调高的命令。`maxTokens` 是一条回复所有轮次（工具循环、暂停续跑）合计的输出上限，每轮请求只给剩下的部分；每轮按计费量扣（`src/chat/billing.ts#billedOutputTokens`）。同一请求内本档中途拒答后兜底模型还能再用满一次 `max_tokens`，这部分溢出有意接受。各档都用 [Claude 官方的消息级 effort](https://platform.claude.com/docs/en/build-with-claude/effort#per-message-effort-beta)，请求参数以 `src/chat/converse.ts#converse` 为准：保持 adaptive thinking，不设置请求顶层的 effort；`src/chat/history.ts#toModelMessages` 在强度变化的访客消息前插入空 `system` 消息及 `output_config.effort`，工具续跑继承该强度。实际 effort 随已签名的 trace 回传，后续按原位置重放，切换当前强度不重写历史前缀。省钱靠 system 与末尾各一个缓存断点；缓存按模型分开，换档不会互相命中，历史裁剪和工具定义变化仍会影响命中。

浏览器以 `src/lib/chat-archive.ts` 保存有限量的多个本地会话，保留历史签章、设计/计划 token 与构建 runId；`/clear` 新开会话，列表可恢复、单条删除或确认后全部清空。流式分片只更新内存，回复结束或中断时再持久化。设计会话到期、轮数耗尽或访客输入 `/exit`（只在设计会话里列出）时清除设计令牌并退回普通对话。localStorage 不可用时只保留内存状态。

访客发出第一条消息前，卡片先在本地回一段隐私说明（`src/components/god-chat.tsx#ConsentPrompt`，按这条消息用中文、日文或英文，判断见 `shared/build-routine.ts#textLanguage`），接受之前不向 Worker 发任何请求，但说明一出现就在后台跑 Turnstile，接受时多半已拿到 token；Turnstile 与通行证的浏览器侧在 `src/hooks/use-human-check.ts`，通行证存 localStorage，跨标签页与重开浏览器都有效，交互挑战超时不算失败、重新出复选框；同意记录存在浏览器（`src/lib/chat-consent.ts`），按 `scripts/chat-code-version.ts#CHAT_CODE_PATHS` 列出的对话代码（含本 Worker 的 `src/`）的内容哈希记版本，这些文件一改就要重新同意，增删对话相关文件时同步这份清单。说明分两行：先选杂鱼与先知用 DeepSeek 还是 Claude，再接受或拒绝；去向只列两种阵容都用的服务加所选那家厂商（`CONSENT_COPY`；Turnstile 不收对话内容，不列），联网搜索那句按 `/api/chat/usage` 回的 `webSearch`（`src/chat/web-search.ts#webSearchServices`）写实际生效的服务。同意按厂商分开记（`src/lib/chat-consent.ts#vendorConsent`）：请求体的 `anthropic` 是 `allow` 才能把对话发给 Anthropic，DeepSeek 阵容里 Clef 选了神而访客没同意过时 Worker 回 409 `shared/god-chat.ts#GOD_CHAT_ANTHROPIC_CONSENT`（此时访客总量与路由次数已扣、神档名额没扣），卡片单独弹 Anthropic 那一条，接受后带 `allow` 重发，拒绝则这一条带 `deny` 重发、改由先知作答；头部开关切到没同意过的厂商也先弹那一条。新增模型供应商、第三方工具或日志出口时同步改它。

## 近况摘要

具名入口 `Digest`（`src/digest/entrypoint.ts`，契约 `shared/digest.ts#DigestRpc`）只给采集 Worker 的 `digest` 任务经 Service Binding 调用，不开 HTTP 路径。每次 `compose` 经 `PUBLIC_STATUS` 读 `src/digest/facts.ts#DIGEST_VIEWS` 登记的公开视图（任一读不到就整轮失败，采集 Worker 留着上一份摘要），压成一份英文事实清单，连同情境说明、文案库与挑选说明算出输入哈希：与上一份相同就回 `unchanged`。变了才往下走，全程不调付费模型：

- 情境：`src/digest/situation.ts#digestScene` 按规则从可选格（`src/digest/facts.ts#digestHighlightOptions`，数字与图例按事实清单同样的取粗）和 `digestSignals`（周末、窗口内锻炼时长、当地日期）判出主情境与附带情境，并按主情境挑两三格；整体太少时判 `quiet`，摘要不带标题和格子，站点照旧显示时钟卡。情境清单与每种的中文说明在 `DIGEST_SITUATIONS`，阈值的取舍写在同文件的注释里。
- 文案库：`src/digest/taglines.ts#DIGEST_TAGLINES` 按情境存好的三到五字中文标语，由 `pnpm --dir workers/ai digest:taglines` 用 Claude 批量写出后人工删改（用法见 `scripts/digest-taglines.ts` 的 `USAGE`）。改情境说明或删了太多行后重跑它补齐。
- 挑选：`compose.ts#taglineCandidates` 按当地日期从主情境抽几条、每个附带情境抽两条做候选；上一份的标题还在主情境那几条里就沿用（`compose.ts#keepsHeadline`，`model` 记 `rules`；附带情境的句子跨主情境共用，不沿用），否则经 `AI` 绑定让 Clef（`DIGEST_PICKER_MODEL`）按事实挑一条；每个选项标明写给哪个情境、是主线还是附带（`compose.ts#taglineCriteria`），提示词要它优先主线。没有 `AI` 绑定、Clef 出错或答到候选外时取第一条候选，也记 `rules`。
- 轮换池：摘要另带 `headlines`（`compose.ts#headlinePool`），定下的标题打头，其余取主情境当天抽样的前几条，凑满 `HEADLINE_POOL` 条；站点每次加载随机挑一条、按分钟轮换（`src/components/live/digest-card.tsx#useRotatingHeadline`）。

摘要不经 `ChatQuota`：它不由访客触发，Clef 调用次数由采集节奏和输入哈希封顶，事实清单里的数字取粗就是为了让哈希只在有看得出的变化时才变。写入可滞后层、节奏与首屏失效见 [采集 Worker](../collector/README.md)。

改情境规则、文案库或事实清单后，用 `pnpm --dir workers/ai digest:probe` 读线上公开视图，打印事实清单、情境、格子和这一轮的候选，再让 Clef 挑几次（`--runs`、`--previous`，用法见 `scripts/digest-probe.ts` 的 `USAGE`）。

## MCP

`POST /mcp`（`src/mcp.ts`）是给外部 AI 用的公开 MCP 端点，无鉴权。生产里站点域名上的 `/mcp` 由 site Worker 经 Service Binding 直接交给本 Worker；Service Binding 保留访客的 `CF-Connecting-IP`，跨域 `fetch` 或缓存层 rewrite 会把它换成共用的出口 IP。site 的分支 Preview 与本地没有这些绑定，仍用 307 跳到 `PUBLIC_BACKEND_URL` 对应的后端，307 保留 POST 与请求体。公开访问域名见 `docs/ops-facts.md`。

- 工具就是 `src/tools/registry.ts#SITE_TOOLS`，和首页对话同一份定义与执行。这里只放只读、只读公开模型的工具：`start_design`、`ask_visitor`、`propose_build`（要访客在卡片里操作）、`show_card`（只对对话卡片有意义）和 `web_search`、`web_fetch`、领域搜索与检索 MCP 只在对话里。每次调用各开一本账本，单次调用的视图数与截断长度和对话相同，跨调用不累计。
- 协议：无状态，只回 JSON，不发会话 ID，不开 SSE（GET、DELETE 回 405），JSON-RPC 批量请求回 400。两代客户端都收：`_meta` 里带版本的新协议（`MODERN_VERSIONS`）逐个请求核对 `MCP-Protocol-Version`、`Mcp-Method`、`Mcp-Name` 头与正文一致，`server/discover`、`tools/list` 带缓存提示（`CACHE_HINTS`，缺了 Claude Code 整张工具表都不认）；旧协议（`LEGACY_VERSIONS`）先 `initialize` 握手。
- 限流与来源：按 `CF-Connecting-IP` 过 Rate Limiting 绑定 `MCP_LIMIT`，拦下时回 429 带 `Retry-After`；和 `CHAT_USAGE_LIMIT` 一样只是尽力而为，核验记录见 `docs/ops-facts.md`。带 `Origin` 的请求按 `ALLOWED_ORIGINS` 校验（与 `/api/*` 同口径），不在名单里回 403；服务端和桌面端的 MCP 客户端不带 `Origin`，不受影响。
- 验证：`src/mcp.test.ts` 覆盖两代握手与报错，但客户端会按自己的 schema 严格校验结果，单测验不出这类不兼容；改了协议处理，起 `pnpm dev:worker` 后用真实客户端各连一次：`claude -p --strict-mcp-config --mcp-config '{"mcpServers":{"lyjw":{"type":"http","url":"http://localhost:8788/mcp"}}}' "…"` 走新协议，`npx @modelcontextprotocol/inspector --cli http://localhost:8788/mcp --transport http --method tools/list` 走旧协议握手。

- Code Mode（默认关闭）：`MCP_CODE_MODE=true` 且有 `LOADER`（`wrangler.toml` 的 `worker_loaders`）时，`/mcp` 的工具表多一个 `run_site_code`（`src/tools/code-mode.ts#CODE_TOOL`），首页对话不用；它不在 `SITE_TOOLS` 里，由 `src/worker.ts` 给 `ToolIO.runCode` 才出现。模型写的代码在 Worker Loader 动态 Worker 里跑（`src/tools/code-sandbox.ts`）：`globalOutbound` 为 null、无绑定，唯一出口是 `status(view)`，读到完整未分页的公开 JSON；读取额度与 `get_site_status` 共用账本，同一次运行重复读同一视图只占一次；有 CPU 与墙钟超时（`CODE_TIMEOUT_MS`）、代码长度与输出长度上限。生产不设该变量。

## 配置与部署

绑定与变量的代码契约在 `src/runtime.ts#Env`，生产绑定在 `wrangler.toml`。模型与验人使用 `AI`、`ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`、`TURNSTILE_SECRET_KEY`，联网搜索使用 `EXA_API_KEY` 与可选的 `WEB_SEARCH_PROVIDER`，历史签名使用 `CHAT_HISTORY_SECRET`，连接构建账号使用 `GITHUB_APP_CLIENT_SECRET`。构建的 Secret、构建工作流与 webhook 配置见 [访客协作构建](../../docs/build-routine.md)，没有配置时入口关闭。`CHAT_QUOTA`、`ANTHROPIC_EGRESS` 与 `BUILD_COORDINATOR` 指向各自的 Durable Object；`CHAT_USAGE_LIMIT`、`MCP_LIMIT` 与 `BUILD_REQUEST_LIMIT` 保护对应入口。配额阈值取根目录 `shared/god-chat-tiers.ts#GOD_CHAT_QUOTA`，入口限流配置取 Wrangler 文件，不另抄数值。

生产迁移配置 `wrangler.toml` 的 `v1-transfer-from-api` 使用 `transferred_classes` 接管旧 `api` Worker 的 `ChatQuota`、`AnthropicEgress` 命名空间，保留对象 ID 和配额计数；不能另建空命名空间替代。发布顺序、Secret 配置和回滚按 [AI Worker 迁移 runbook](../../docs/ai-worker-migration.md) 执行，不凭提交或配置文件推断迁移已生效。

Workers Builds 的监视路径和部署命令统一见 [Workers 构建](../../docs/workers-builds.md)。分支预览使用组合入口，在 core 的同一隔离 Preview 内运行 core 与 AI，不连接生产 Service Binding；ai 自己不发布分支 Preview。Secret 配在 core parent 的具体 Preview 上；创建、解析和配置步骤只在构建文档维护。

## 本地开发

以下命令从仓库根目录执行：

```sh
cp workers/ai/.dev.vars.example workers/ai/.dev.vars
pnpm dev:worker
pnpm dev:local
```

`pnpm dev:worker` 同时启动 dev-router、core、ai、ingress、collector；请求从本地 core 经 Service Binding 到 ai，工具再经 `PUBLIC_STATUS` 读本地 core。端口、状态持久化与假数据注入见 [core 本地开发](../core/README.md#本地开发)。`workers/core/.dev.vars` 的 `UPSTREAM_API_URL` 只控制 core 的公开状态兜底，不启用 AI 调试权限。

聊天凭据放 `workers/ai/.dev.vars`：`ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`、`TURNSTILE_SECRET_KEY`、`CHAT_HISTORY_SECRET` 必须齐全，否则聊天回 503；设计与签名计划另需 `BUILD_SESSION_SECRET`、`BUILD_COORDINATOR` 绑定，以及与该 key 同一工作区的 `DESIGN_AGENT_ID`、`DESIGN_ENVIRONMENT_ID`（`wrangler.toml` 与 `wrangler.test.toml` 的 `[vars]` 已填；换工作区时用新 key 跑 `pnpm --dir workers/ai designer:setup`，按名字找或建并打印两个 ID），缺任何一项时 `think` 档拿不到 `start_design`；issue 提交还需 `GITHUB_APP_CLIENT_SECRET`。本地 `wrangler.test.toml` 设置 `AI_DEV=true`；`src/runtime.ts#aiDevEnabled` 只在 `AI_DEV=true` 或 `PREVIEW_WORKER=true` 时启用以下调试变量：

- `CHAT_RATE_LIMIT=off`：普通聊天配额仍记账、`/usage` 仍显示用量，但不拦截；设计轮数与会话上限仍执行。
- `CHAT_FORCE_TIER=<档位或 CLEF_CHOICES 的键>`：无设计会话时跳过 Clef；合法值见根目录 `shared/god-chat-tiers.ts#GOD_CHAT_TIERS` 与 `src/chat/router.ts#CLEF_CHOICES`。有效设计会话始终由规划者回答。

生产缺省不开调试权限，不能靠 `UPSTREAM_API_URL` 或只设置调试变量绕过验人及配额。使用 `pnpm dev` 让本地页面连接生产 core 时，localhost 的 Turnstile 结果不会被当成本地测试放行；调试对话应使用上面的本地 Worker 栈。本地 `AI` 绑定调用远程 Workers AI，需要 Wrangler 具备访问权限，没有时 `pnpm dev:worker` 去掉这个绑定、路由走兜底档位（见 [core 本地开发](../core/README.md#本地开发)）；强制档位只跳过 Clef，仍会调用所选档位的真实模型。`.dev.vars` 改了要重启 `pnpm dev:worker` 才生效。

改提示词、工具说明或工具结果的措辞后，用 `pnpm --dir workers/ai chat:probe` 对真实模型连问几次再看回答（语言、说法）：它在 Node 里直接调 `src/chat/handler.ts#handleChat`，跳过 Clef 与验人，状态视图读 `workers/core/dev-fixtures/` 的夹具，用法见 `scripts/chat-probe.ts` 的 `USAGE`。

## 验证

从仓库根目录执行：

```sh
pnpm --dir workers/ai typecheck
pnpm --dir workers/ai test
pnpm exec eslint workers/ai/src
node scripts/verify-build-worker.mjs
```

`scripts/verify-build-worker.mjs` 用临时配置启动本地 workerd，以真实 Durable Object RPC 和 SQLite 验证并发一次性消费、额度、状态恢复与重启持久化；GitHub 出站（含工作流派发与 Actions OIDC 公钥）使用夹具。若依赖锁定的 workerd 不支持脚本配置的 `compatibility_date`，设置 `MINIFLARE_WORKERD_PATH` 指向支持该日期的本地 workerd 可执行文件。

`src/worker.test.ts` 验证路由边界、CORS、MCP 的公开状态 RPC、缺绑定时关闭入口与环境选择；聊天、配额和 MCP 的行为测试随实现放在本目录。涉及跨 Worker 读取或转发时，还要运行 [core 集成验证](../core/README.md#验证)。MCP 协议变更必须按上文「MCP」用真实客户端连接本地入口，不能仅以单元测试作为客户端兼容的证明。
