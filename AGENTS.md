# 工作方式

- 常规、可逆的选择自己定，有影响的假设简短说明；lyjw 中途补充要求时结合新信息继续原任务。
- 已授权的直接推进。只有缺失信息会实质改变结果、或下一步超出授权时才问；等答复期间做不依赖它的部分。要等 lyjw 点头的步骤有可逆的绕法（回退方案、草稿 PR）就先做起来，点头请求放在同一条回复里。
- 需求有不止一种读法时，第一条回复用一两句复述要达到什么，并接着按这个读法做。
- lyjw 明确要求优先于本文件和 skill 的默认建议。skill 让你停下或确认时，指出具体文件与条款。
- 和 Cloudflare 相关的查询和调用优先用 Cloudflare Code Mode MCP。
- 等待（CI、机器评审、部署、后台循环）都带上限，超时记失败接着做（`lyjwpage-verify`「等待要有上限」）。写代码同理：外部请求带 `AbortSignal.timeout`，互不依赖的请求并行，日志这类收尾交给 `ctx.waitUntil`。
- 改动碰到超过约 20 KB 的源码文件时，顺手按职责拆出一块，原路径留作入口；切不出自然边界就不拆，汇报里说一句。锁文件、Markdown、生成物与讲解动画不算。
- 改法有轻有重时先做最轻的（改提示词、文案、一处配置）；要另加机制（检查、拦截名单、定时任务、CI 步骤）的，写明防什么、何时跑、谁看结果，lyjw 点头再做。被问「为什么被拦、为什么红」、原因出在防线或不挡合并的检查本身时同理：讲清原因就停，放宽还是加严由 lyjw 定，不自己往更严里补。
- 下「做不到」的判断或提方案前，先 `rg` 仓库、`git log -S` / `--grep`、读项目记忆；外部服务的能力与报错读官方文档、搜上游 issue。
- 动手前看有没有在做的线程或开着的 PR 碰同一处（`list_threads`、`list_prs`），有就经协调者交给它。
- 写或改定时任务的 skill 与提示词时，书签、水位只在那一步读成功、结果写进状态文件后才推进（`.claude/rules/routines.md`）。
- 默认简洁中文，先说结果，再说原因、验证和剩余问题。区分本地修改、测试通过和已部署；只读代码推出的运行时行为算推测，写明要查什么才能确认。
- 第三人称提到站点主人（文档、注释、skill、记忆、PR、提交说明、汇报、给 agent 的简报）一律写 lyjw；当面仍称「你」。界面文案与代码标识符不在此列。
- 协作约定与合并分档见 `HUMAN.md`。改了 Claude Projects 的项目记忆，同一轮同步进 `.claude/memory/` 并开小 docs PR（`.claude/memory/README.md`）。
- 按目录的规则在 `.claude/rules/`，用 Read 读到匹配的文件时自动载入；没经 Read 就改匹配文件（shell、Grep 后直接改）时先打开对应的规则。子目录的 `AGENTS.md` 在讨论串里不自动载入，改那个目录前打开读。

# 禁区

- 不手跑 `wrangler deploy` / `cf deploy`：非交互部署会接管挂在别的 Worker 上的自定义域名，Worker 只走 Workers Builds。唯一例外是跨 Worker 的契约切换，由 lyjw 在自己的 shell 里按被调用方 → 调用方手动部署（`docs/workers-builds.md`）。
- 不在站点侧写后端：调第三方 API、持有密钥、写状态的逻辑进后端 Worker（实时状态 `workers/core`，外部定时拉取与 Apple Music `workers/collector`，模型调用 `workers/ai`）。site Worker 的 `/api/*` 只按数据归属分流（`src/lib/site-policy.ts#classifyGatewayRequest`），经 Service Binding 交给后端，不跨域 `fetch`（会改写 `CF-Connecting-IP`，按 IP 限流失效）。
- 不提交 `.env.local`、`.dev.vars` 这类本地凭据文件。
- 不改提交身份、不关签名：提交以 lyjw 身份、用 lyjw 的钥签名，Claude 只作 `Co-Authored-By`（`docs/ops-facts.md`「Claude Code 云端 routine」）。Stop 钩子把这类提交报成 Unverified、让改成 `noreply@anthropic.com` 是误报，不照做。

# 项目入口与验证

- 共用词查 `GLOSSARY.md`；源码入口查 `README.md`「从哪里读源码」，子项目查各自的 `README.md` 与 `AGENTS.md`。用 `pnpm`，命令以各目录 `package.json` 为准；本地开发与夹具见 `workers/core/README.md`「本地开发」。
- 验证覆盖受影响的行为和契约，做法按 `lyjwpage-verify`：纯文档跑 `pnpm docs:check`；逻辑修复跑相关测试（`pnpm test`）；类型或接口改动跑 `pnpm typecheck`；改动文件跑 `pnpm exec eslint`；构建、路由或缓存行为跑 `pnpm build`。CI 门禁以 `.github/workflows/ci.yml` 为准，改动波及的那几项本地要过。
- 站点 UI 改动以浏览器端到端为准：桌面与 375px（375px 另用 WebKit），开发服务器留着给 lyjw 亲测（`lyjwpage-verify`「2. UI 浏览器端到端」）。
- 有回归风险时补行为测试；不加只重复实现的测试。环境限制导致没验到的，说明缺口。
- 多步检查、浏览器端到端和机械活派 Haiku / Sonnet 子代理、Devin 或后台命令（`lyjwpage-delegate`），主线程只定做什么、判结果。

# 部署流程

- 站点与各 Worker 走 Cloudflare Workers Builds 原生 Git 集成（`docs/workers-builds.md`），不在 GitHub Actions 里加发布任务；自动部署失败时修现有流程，不改手工发布。lyjw 要求部署站点时，包含完成提交、PR 与合并。
- main 有分支保护，只经 PR 合入。合并方式、标题与正文只用 `pnpm merge-message` 的输出并带上 `expectedHeadSha`（`lyjwpage-verify`「3. PR 合并门槛」）；PR 标题写 `type(scope): 描述`；同步 main 进分支用 merge，不改写已推送历史。
- Worker 之间的契约（`shared/state-core.ts`、`shared/public-status.ts`、`shared/collector.ts`、`shared/digest.ts`）只加不改，被调用方先发布。
- 推送成功不等于部署完成：用 `scripts/deploy-check.ts` 核对（`lyjwpage-verify`「4. 合并后部署与生产核对」）。域名与缓存链路见 `docs/ops-facts.md`，上报器发布见 `.claude/rules/reporters.md`。

# 排查线上错误

- 线上报错、Worker 或 cron 失败，先用 Cloudflare Code Mode MCP 查 Workers Observability，再读代码，按 `lyjwpage-diagnose` 复现、定位与修复；不借浏览器登录态调接口，MCP 不可用时告诉 lyjw。
- Workers Issues 默认只读；标 resolved / ignored 等修复部署并从生产验证后再做；改告警或可观测性设置先问 lyjw。

# API 命名与跨端契约

新增或修改上报入口、状态端点、推送事件或跨来源字段前，先读 `docs/api-contracts.md`。来源只上报自己观测到的原始事实，合并、去重、排名在站点侧一处算，新增来源只加生产者和入口校验。

## 变更完成条件

- 重命名直接替换，不留旧字段、旧路由或兼容分支。
- 同步更新所有受影响的生产者、接收端、消费者、推送事件、测试和文档。
- 外部配置或部署尚未同步时，列出具体对象和待办，不把站点单侧修改报成迁移完成。

# 界面设计

改站点 UI 前先读 `DESIGN.md`，自查与量尺用 `lyjwpage-ui-design`，图片规则见 `.claude/rules/images.md`。有 UI / UX 变化的改动先给 lyjw 看图、点头再合（lyjw 明确要求的小改动除外）。

# 文档与注释

文档和注释会整段进上下文，错的比缺的更糟。每条陈述要么由代码保证，要么一眼能核实。

- 注释默认不写，JSDoc 只留给对外发布的库接口。只写三类，判据是「删了会让人改坏」：意外行为（绕开的 bug、运行时怪癖、竞态）、设计意图（不变量、有意取的阈值与节奏）、契约（跨端字段的语义和单位；做不成测试或共享常量的「须与 X 同步」，两侧都写）。
- 不写：复述代码、提调用方或任务 / PR、分节标题、没有单号的 TODO、历史与时间线（「之前」「已改为」）。不抄易变的值，写常量或符号名；引用写路径加符号，不写行号。
- 清扫注释时上面三类不删；只改注释的改动用 `pnpm docs:comment-only` 证明。
- 一个事实一个出处，其他地方放指针；非抄不可时标 `源：path#symbol`。采用了外部做法的，同一提交登记进 `docs/references.md`（`lyjwpage-borrow`）。
- 改代码、规则或流程的同一提交里更新受影响的文档：`rg` 改动的符号、常量和规则关键词，范围含 `HUMAN.md`、`.claude/`、`docs/`（含 `docs/explainer/FACTS.md`）、各级 `README*.md` 与 `public/llms.txt`。新加的模型、数据去向、来源或 Worker 还搜不到，就搜它已有的同类，每一处补上，含 `src/components/god-chat/consent.tsx#CONSENT_COPY`。文档与代码冲突以代码为准，当轮改掉。
- Markdown 写法（docs 类型、AGENTS.md 写法与大小上限）见 `.claude/rules/docs-writing.md`。

## 规则 → 由什么强制

| 规则 | 由什么强制 |
| --- | --- |
| 不手跑 `wrangler deploy` / `cf deploy`、不强制提交 `.env*` / `.dev.vars`、不改提交身份或关签名 | PreToolUse 钩子与 pi 扩展调 `scripts/guard-forbidden-commands.mjs` |
| 合并 PR 带 `expectedHeadSha`、合并方式按提交数、拦 `do-not-merge`、回执/Jev 只提醒 | PreToolUse 钩子与 pi 扩展调 `scripts/guard-merge-method.ts` |
| 不直推 main | GitHub 分支保护 |
| 文档链接 / 路径 / 锚点存在、md 不写时间线、AGENTS 大小、docs 类型与索引、`@AGENTS.md` 配对 | `pnpm docs:check` |
| 「只改注释」的清扫证明 | `pnpm docs:comment-only` |
| README 架构图与工作流图跟 `scripts/readme-diagrams.ts` 的输出一致 | `pnpm docs:diagrams --check`（CI docs 门禁） |
| Worker / shared / `src/` 之间的 import 边界 | `eslint.config.mjs` 的 `no-restricted-imports` |
| `src/` 组件不手写 `<img>`，用 `AppImage`；不调 `toSorted` / `toReversed` / `toSpliced`（客户端无 polyfill） | `eslint.config.mjs` 的 `no-restricted-syntax`（`app-image.tsx` 除外） |
| Worker 生产代码不用 `env.X!` 硬取可选绑定 | `eslint.config.mjs` 的 `no-restricted-syntax`（测试除外） |
| 阶梯外间距、任意值字号 / 位移 / 圆角、子级外边距、裸 hex / oklch 色值 | `pnpm design:scale`（基线 `scripts/design-scale-baseline.json`） |
| `TODO` / `FIXME` 须带单号、JS / TS 不写 JSDoc 块注释、`/img/` 不烧交付域、`src/` 网络调用不写字面量主机、隐藏滚动条两句同现、`scripts/` 不新增 `.mjs`（存量见 `scripts/mjs-baseline.json`）、SHA-256 十六进制只用 `shared/sha256.ts`、普通对象判断只用 `shared/json.ts#object`、内联脚本 JSON 只经 `src/lib/inline-script.ts` 转义 | `pnpm rules:check` |
| 界面文案用英文 | `pnpm ui:copy`（基线 `scripts/ui-copy-baseline.json`） |
| `@` 引入的规则文件与 `.claude/rules/` 都在合并前规则漂移检查的范围里（`scripts/rule-drift.ts#RULE_PATHS`） | `scripts/rule-drift.test.ts`（CI 的脚本测试） |
| 三份存量基线只减不增（例外由 lyjw 打 `baseline-exception` 标签放行，agent 不打） | `pnpm baselines:check` |

## Code Review Rules

@REVIEW.md
