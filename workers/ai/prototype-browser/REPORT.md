record：设计会话的 harness 跑在访客浏览器（pi）原型与调研。按 `07287955`（建在 `c4c81a94` 上）于 2026-10-10 实测，快照不维护，不当现状引用。<!-- allow: record 核对戳 -->

# 结论

原型能在本地浏览器里跑通，但不建议把设计会话的 harness 放到访客浏览器里上生产。生产选了 Claude Managed Agents（服务端持有会话记录与沙盒），这份原型只作存档。

浏览器 harness 比 Managed Agents 快、便宜，主要省在不用在容器里用 bash 摸索仓库；和手写循环比，同一个 Opus、同一套工具，表现基本持平。它的净收益只有两条：状态在客户端、轮数按预算计量。两条都能在服务端做，而且服务端做不需要相信浏览器。

# 实测数字

用任务书那句话重放，直接从规划者开始，不经过 Sonnet 交接。工具集不含 `web_search` / `web_fetch`。每种情形只跑了 1～2 次。

| | 第 1 次 | 第 2 次（新会话） | 第 2 次的第二回合（点选答案后） |
|---|---|---|---|
| 到第一次工具调用 | 4.1 s | 4.4 s | 10.9 s |
| 到出卡片 | 24.3 s，`ask_visitor` | 18.7 s，`ask_visitor` | 40.2 s，`propose_build`，签名成功 |
| 到卡片的模型请求数 | 4 | 3 | 2 |
| 猜错路径 | 0 | 0 | 0 |
| token（输入 / 输出 / 缓存读 / 缓存写） | 10 / 1230 / 37,563 / 15,140 | 8 / 1085 / 22,780 / 15,048 | 6 / 2430 / 42,146 / 2,884 |
| 估算花费 | $0.108 | $0.102 | $0.072 |

- 跨回合保留：第二回合只补读 1 个文件就出了计划，缓存读到 42k。
- 刷新恢复：IndexedDB 能恢复会话（实测恢复 13 条和 17 条消息）。
- 375px：只量了 scrollWidth=375，没有横向溢出。
- 包体积：只含 pi 的那一套 minified 437 KB / gzip 113 KB / brotli 94 KB；本原型完整包 501 / 134 / 112 KB。typebox 占 174 KB，多半因为从根入口导入 `Type`。`--splitting` 拆包后首屏入口约 45 KB gzip，Anthropic SDK 那块约 58 KB gzip 可懒加载。

三种方案对照：

| | 浏览器 harness（本原型） | Managed Agents | 手写循环 |
|---|---|---|---|
| 到选择卡片 | 18.7～24.3 s | 约 31 s | 约 30 s |
| 模型请求数 | 3～4 | 6 | Opus 5 轮 |
| 花费 | 约 $0.10 | $0.26 | 没测 |
| 状态放哪 | 浏览器 IndexedDB，不可信 | 服务端托管 | 签名历史，不含工具结果 |
| 可审计性 | 差 | 好 | 中 |
| 实现与维护成本 | 高（代理消毒、预算 DO、pi 跟版） | 中 | 低到中 |
| 依赖风险 | 高（见调研） | 绑定托管 beta API | 只依赖 Anthropic SDK |

# pi 调研（一手来源）

来源：仓库 main 的 tarball 与 npm 上 `@earendil-works/pi-ai@1.1.0`、`@earendil-works/pi-agent-core@1.1.0`、`@earendil-works/pi-web-ui@0.75.3` 的 tarball，均于 2026-10-10 拉取。下文行号是 npm 1.1.0 的 `dist/api/anthropic-messages.js`，对应源码 https://github.com/earendil-works/pi/blob/v1.1.0/packages/ai/src/api/anthropic-messages.ts 。

## 版本、包结构与发布节奏

- MIT。npm `latest` 是 1.1.0（2026-10-07），`legacy-node20` 指向 0.74.2。
- `packages/` 下有 `ai`（pi-ai，统一 LLM API）、`agent`（pi-agent-core，Agent 与工具循环），以及 `durable`、`server`、`client`、`protocol`、`mcp`、`coding-agent`、`tui`、`chord`、`env`、`codemode`、`telemetry`、`evals`。已经没有 web-ui。
- 2026-05-07 从 `@mariozechner/pi-*` 改名为 `@earendil-works/pi-*`（提交 `3e5ad67e`、`551385e4`），旧包已 deprecated。
- 0.85.0（09-04）到 1.1.0（10-07）发了 15 个版本；0.87.1 直接跳到 0.99.0（09-29），1.0.0 在 10-01。
- 近期破坏性变更：

| 版本 | 包 | 变更 |
|---|---|---|
| 0.86.0 | pi-ai | 流函数输入改成 `TranscriptContext` |
| 0.87.0 | agent-core | 删除 `shouldStopAfterTurn`，改用 `finishTurn` |
| 0.99.0 | pi-ai | 图像模型并入 Provider |
| 1.0.0 | agent-core | 删除实验性 harness，会话存储、compaction 等移到 `pi-durable` |
| 1.0.3 | pi-ai | Azure provider 改名 |
| 1.1.0 | pi-ai | 流函数必须返回 `AssistantMessageEventStream` |

- web-ui 在 2026-05-20 的 `b141e1fa` 整个删除，npm 最后一版 0.75.3（05-18）。它原来提供 `ChatPanel`、Artifacts、CORS 代理设置，会话存在 IndexedDB。现在没有官方替代，`packages/client` 只是协议客户端。

## 浏览器里能不能跑

- README「Browser Usage」写明支持；浏览器没有环境变量，要显式传 `apiKey`；Bedrock 与 OAuth 只能在 Node 里用。
- Anthropic 客户端固定开 `dangerouslyAllowBrowser: true`（第 758、773、803、814 行）。
- `node:` 模块都在 `typeof process` 判断或动态 import 后面，agent-core 里没有 `node:`；esbuild `--platform=browser` 一次打包成功。
- 只用 Anthropic 时其它 provider 的 SDK 不进包，但 pi-ai 把所有 SDK 都列成硬依赖；它锁 `@anthropic-ai/sdk` 0.129.0，本仓库是 0.132.1。
- pi 现在没有浏览器端会话存储，原型自己写了 IndexedDB 存储。

## Anthropic 适配保真度

- adaptive thinking 与思考摘要：支持，发 `{type:"adaptive", display}`，签名回传，`redacted_thinking` 能处理。
- `cache_control`：system、最后一个工具、最后一条消息各打一个断点。
- 服务端工具的结果块和引用会被丢弃：`content_block_start` 只处理 text、thinking、redacted_thinking、tool_use；`server_tool_use`、`web_search_tool_result`、`mcp_tool_use`、`citations_delta` 都被静默丢掉（1.1.0 dist 里匹配数为 0）。用 `onPayload` 能把工具塞进请求，但回复解析照样丢，下一轮历史里也没有。
- 没有 `mcp_servers`。
- 对话中途的 system 消息：模型 compat 声明了 `supportsMidConvoSystemMessages` 时支持（Opus 5.5 有）。
- `fallbacks` 只支持显式列表（`compat.allowedFallbackModels`，第 987 行），Opus 5.5 的 catalog 没配；不支持 `"default"`；有输出之后才兜底换模型会抛 `unsupported mid-output model fallback`（第 475 行）。
- beta 头按 compat 自动计算；传 `headers["anthropic-beta"]` 会整个替换。
- 停止原因：`pause_turn` 映射成 `stop`（第 1299 行，注释说会重新提交，实际不续跑）；`refusal` 映射成 `error`，循环结束；未知停止原因抛错。
- `AbortSignal` 贯穿 SDK 请求和 SSE 迭代。

## 工具、事件、中断、压缩、自定义 provider

- 工具用 `AgentTool` 定义，参数是 TypeBox schema 并先校验，`execute` 的返回值可带 `terminate`；默认并行，可用 `beforeToolCall` / `afterToolCall` 拦截或改写。
- 事件分 agent、turn、message、tool_execution 四层，工具执行事件带 `durationMs`。
- 没有 `maxTurns`，要用 `finishTurn` 自己数。
- 支持 `abort`、`steer`、`followUp`。
- 持久化、崩溃续跑与压缩在实验性的 `pi-durable`（Memory、Node SQLite、JSONL，也有 `openDurableObjectSqliteStorage`），core 只留 `transformContext` 钩子。
- 自定义 provider：可改 `model.baseUrl`（原型用这个）、传 `options.fetch` / `options.client`、`createProvider`，或 agent-core 的 `streamProxy`（把 `{model, context, options}` 发到 `${proxyUrl}/api/stream`）。原型没用 `streamProxy`：那样服务端要自己跑 pi-ai、再转一次消息格式；走 `baseUrl` 时 Worker 直接按 Anthropic 原生格式消毒。
- Cloudflare 上的 pi（只作对比）：`pi-durable` 能把会话存进 DO，`pi-server` 是本地 Session 路由，属于「harness 跑在服务端」的路线。

# 原型架构

```
浏览器（不可信）                              原型 Worker（可信）                    外部
pi Agent + IndexedDB ──/api/design/turn──▶ admitDesign 扣 1 个设计轮数，签 5 分钟的 run 票据
pi-ai Anthropic（baseUrl=Worker）──/api/design/llm/v1/messages（x-api-key=票据）──▶
   验票 → DesignBudget DO 准入（单飞/请求数/费用/输出/墙钟）→ 消毒 messages
   → 注入 model/system/tools/thinking/effort → 转发 ──▶ api.anthropic.com
   ◀── 原样 SSE；tee 出一路读 usage 记账
浏览器执行工具：find_repo_files → api.github.com；read_repo_file/read_project_doc → raw.githubusercontent.com；
  get_site_status → Worker /status/<STATUS_VIEWS 路径> → 公开 api；ask_visitor 本地画卡片并 terminate；
  propose_build → /api/design/plan → checkBuildPlan + issuePlan（与生产同一份代码）
```

独立成一个原型 Worker：不改 `god-chat.tsx`，也不扩 `shared/ai-paths.ts`（扩路径会连带改 api 转发入口和预览入口）。原型直接 import `src/chat/design.ts`、`src/build/*`、`BuildCoordinator`，计划校验与签名用生产同一份代码。

## 安全模型

1. 服务端决定一切参数：代理只读请求里的 `messages` 与 `max_tokens`，model、system、tools、`mcp_servers`、thinking、beta 头一律忽略并由服务端重拼。实测伪造 Fable 模型、自定义 system、`exec` 工具与 `mcp_servers` 发过去，上游实际跑 `claude-opus-5-5`，工具是固定的六个。
2. 消息消毒：只留 user 与 assistant；只留 text、user 的 `tool_result`（压成纯文本）、assistant 带签名的 thinking / redacted_thinking、白名单工具名的 `tool_use`；第一条必须是 user；请求体大小、条数、单块长度有上限；浏览器传来的 `cache_control` 全部去掉。
3. 按回合计预算：访客每发一条先扣 1 个设计轮数（`BUILD_DESIGN_LIMITS` 照旧），再签 run 票据；`DesignBudget` 单飞并限制请求数、输出 token、估算费用（输入也算，transcript 由浏览器提供）和墙钟。实测两个并发请求得 200 与 409，第 13 次请求得 429，拿设计令牌冒充票据得 401。进入设计会话前照旧走 `ChatQuota` 与 Turnstile。
4. 计划签名留在 Worker：路径写 `.github/workflows/ci.yml` 的计划被拒，拒绝原文与生产一致。
5. 剩余风险是工具结果不可信：浏览器能伪造文件内容与历史，但没有新增特权产物（签名计划路径服务端校验，构建时 routine 克隆真实 main，上传另有校验）；后果是计划质量变差、浪费访客自己那一回合的预算。单回合预算内访客能把 Opus 拉去答规划以外的问题。

## 读仓库与会话记录

- 读文件树直连 GitHub API（匿名按访客 IP 每小时 60 次，页面内存只取一次），读文件直连 `raw.githubusercontent.com`，两者都返回 `ACAO: *`。额度算在访客 IP 上，HTTP 缓存命中时一次读取 4～26 ms；代价是 Worker 看不到读了什么。
- 会话记录在 IndexedDB，能刷新恢复并在恢复的会话上继续。上云最自然的位置是代理，但存下来的是浏览器「声称」的历史；既然服务端反正要存一份可信记录，不如让服务端直接持有 transcript 并执行工具。

# 缺口与未验证项

- 样本只有 1～2 个；手写循环没用同一句话重测。
- Stop 中途取消能否真的掐断上游计费没测（代码上取消信号贯穿）。
- `DesignBudget` 的费用上限与输出上限从没被触发（先到的是请求数上限）；`settle` 写回的 usage 没读出核对；费用只按顶层 usage 算，没处理拒答兜底的多跳计费。
- 控制台错误的捕获钩子在第二次运行前才装，第一次运行与页面加载期间的错误没捕获。
- 代理直连 Anthropic，没走 `AnthropicEgress`；没接 Turnstile、`ChatQuota`，也没跑 Sonnet 到 Opus 的交接；`/api/design/start` 只在 `aiDevEnabled` 时开放。
- 没接 web 工具，也没验证用 `onPayload` 硬塞服务端工具后下一轮的具体错误。
- 浏览器侧类型检查剩 1 个错误在 `src/build/http.ts`（DOM 与 workers-types 的 `Blob` 冲突），Worker 侧类型检查与 eslint 通过。
- `PLANNER_PROMPT` 原样使用，里面还提到 web 工具。
