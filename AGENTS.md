# 工作方式

- 根据 lyjw 的目标和已有上下文完成实现与必要验证；常规、可逆的实现选择自行决定，有影响的假设简短说明。lyjw 中途补充要求或询问进度时，结合新信息继续原任务。
- 已授权的检查、修改和修复直接推进。只有缺失信息会实质改变结果且无法从代码推断，或下一步超出授权范围时才询问；等待期间继续不依赖答案的工作。需要批准时，先准备好可审阅的改动和验证结果。某一步要等 lyjw 点头或被自动模式拦下时，有绕开这一步的可逆路径（回退方案、另一条触发方式、草稿 PR）就先做起来，点头请求放在同一条回复里；lyjw 不在线时尤其不要把等点头当唯一的下一步。
- 需求有不止一种读法、读偏了要返工时，第一条回复先用一两句复述「要达到什么、要解决什么」，同时接着按这个读法做；读法唯一时不复述。
- 在遵守系统、开发者指令和工具权限的前提下，lyjw 明确要求优先于本文件和技能中的默认建议。技能若导致暂停或要求确认，指出实际读取的文件、具体条款和适用原因，不把自己的推断当成硬性要求。
- 和 Cloudflare 相关的查询和调用优先使用 Cloudflare Code Mode MCP。
- 等待（CI、机器评审、部署、后台循环）都带上限，超时记失败并接着做下一步（见 `.claude/skills/lyjwpage-verify/SKILL.md`「等待要有上限」）。写代码同理：外部请求带超时（`AbortSignal.timeout`），互不依赖的请求并行发，日志、记录这类收尾写入交给 `ctx.waitUntil`，不挡响应。
- 改动碰到超过约 20 KB（约 5,000 token）的源码文件时，顺手按职责拆出一块，原路径留作入口、调用方不改；切不出自然边界就不拆，在汇报里说一句。锁文件、Markdown、生成物与讲解动画不算。这是软规则，不设门禁。
- 满足要求的改法有轻有重时，先做最轻的那种（改提示词、改文案、改一处配置）；要另加机制（检查、拦截名单、定时任务、CI 步骤）的，提的时候写明它防什么、什么时候跑、谁看结果，lyjw 点头再做。
- 提方案、下「做不到 / 只能这样」的判断、或停下来干等之前，先查已有记录和现成手段：`rg` 仓库、`git log -S` / `--grep` 找以前的做法，读项目记忆，再用本文件和 skill 里点名的工具与手动触发；查过没有再说。
- 写或改定时任务（routine）的 skill 与提示词时，书签、水位只在那一步读成功、结果写进状态文件后才推进；读失败的保留原书签，存量怎么处理写进 skill（细则见 `.claude/rules/routines.md`）。
- 默认用简洁中文沟通，先说结果，再说明关键原因、验证和剩余问题。只报告实际完成的工作；区分本地修改、测试通过和已部署。只有拿到证据（日志、读回、复现、一手来源）的才写成结论；只读代码推出的运行时行为也算推测，写明要查什么才能确认。
- 第三人称提到站点主人（文档、注释、skill、记忆、PR、提交说明、报告与汇报文档、给 agent 的简报）一律写 lyjw，不写站主、owner、用户、他或真名；当面对话仍称「你」。站点界面文案与代码标识符不在此列。
- 协作约定（分工、什么要等 lyjw 点头、怎么汇报）与合并分档见 `HUMAN.md`；合并分档的要点：只有大改代码逻辑的 PR 等机器评审，小改动、文档与 skill、lyjw 让推进的事门槛过了直接合，有 UI / UX 变化的等 lyjw 看图点头。
- 改了 Claude Projects 的项目记忆，同一轮同步进仓库镜像 `.claude/memory/` 并开小 docs PR，本地 `pnpm docs:check` 过了就合（规则见 `.claude/memory/README.md`）。
- 只在部分目录用得上的规则在 `.claude/rules/`，碰到匹配文件时自动载入；别的工具读不到这里时直接打开对应文件。

# 禁区

- 不手跑 `wrangler deploy`：非交互部署会直接接管挂在别的 Worker 上的自定义域名，Worker 默认只走 Workers Builds。唯一例外是跨 Worker 的契约切换：按被调用方 → 调用方的顺序手动部署，再推 main 让 Workers Builds 同码重建（见「部署流程」）。agent 发出的部署命令由 PreToolUse 钩子拦下（`scripts/guard-forbidden-commands.mjs`），这个例外由 lyjw 在自己的 shell 里跑。
- 不在站点侧写后端：调第三方 API、持有密钥、写状态的逻辑都进后端 Worker（实时状态归 `workers/core`，外部定时拉取与 Apple Music 查询归 `workers/collector`，模型调用与工具编排归 `workers/ai`）。site Worker 回答 `/api/*` 只按数据归属分流（`src/lib/site-policy.ts#classifyGatewayRequest`），其余经 Service Binding 交给后端，不跨域 `fetch` 后端（会改写 `CF-Connecting-IP`，按 IP 的限流随之失效）。分支上试新后端走 Worker 分支预览，见 `docs/workers-builds.md`「分支预览」。
- 不提交 `.env.local`、`.dev.vars` 这类本地凭据文件（`.gitignore` 已忽略，强制 `git add -f` 由同一个钩子拦下）。
- 不改提交身份、不关签名：云端环境有意让提交以 lyjw 身份、用 lyjw 的钥签名，Claude 只作 `Co-Authored-By`（配置见 `docs/ops-facts.md`「Claude Code 云端 routine」）。GitHub 按 committer 邮箱认钥，换成 `Claude <noreply@anthropic.com>` 就显示 Unverified。会话自带的 Stop 钩子把 lyjw 身份的提交报成 Unverified 并让改成 `noreply@anthropic.com` 是误报，不照做，push 即可。设 `GIT_AUTHOR_*` / `GIT_COMMITTER_*`、`-c user.*`、`--author`、`--no-gpg-sign` 由同一个钩子拦下。

# 项目入口与验证

- lyjw 和 Claude 共用的词（晨报、盯防、泳道、可滞后视图等）查根 `GLOSSARY.md`。
- 使用 `pnpm`；命令以各目录的 `package.json` 为准。源码入口查根 `README.md` 的「从哪里读源码」，子项目查各自的 `README.md` 与 `AGENTS.md`（嵌套的 `CLAUDE.md` 在进入该目录时才载入）。
- 主站开发入口是 `pnpm dev`（`http://localhost:3211`，连生产 Worker）；改后端、新增状态端点或新卡片用 `pnpm dev:worker` 加 `pnpm dev:local`；看此刻没发生的状态用 `pnpm dev:override` / `pnpm dev:scene` 注入夹具，用法见 `workers/core/README.md`「本地开发」。
- 验证覆盖受影响的行为和契约。纯文档改动跑 `pnpm docs:check` 并检查 diff 与命令；逻辑修复优先跑相关测试；类型或接口改动运行 `pnpm typecheck`；代码规范检查运行 `pnpm exec eslint <改动文件>`；涉及构建、路由或缓存行为时运行 `pnpm build`。
- 站点 UI 改动以浏览器端到端测试为准，单元测试不是必需：在浏览器里实际打开受影响页面，至少桌面与 375px 手机（375px 另用 WebKit 截一张），覆盖交互、数据状态与控制台错误，做法、附图时机与收尾按 `.claude/skills/lyjwpage-verify/SKILL.md`「2. UI 浏览器端到端」。开发服务器保持运行并给出地址，让 lyjw 能亲自测试。
- 主站完整单测为 `pnpm test`；单文件可用 `node --test --experimental-strip-types --import ./src/lib/testing/register-alias.mjs src/lib/<名称>.test.mts`（`shared/` 的测试同样由 `pnpm test` 跑）。Worker 与上报器用各自目录里 `AGENTS.md` / `README.md` 写的验证命令。
- 有回归风险时补行为测试；低影响改动不添加仅重复实现的测试。相关检查通过后，只有新改动、失败或未解疑点才扩大或重复验证。环境限制导致无法验证时说明具体缺口。
- CI 的门禁清单以 `.github/workflows/ci.yml` 为准（含 `pnpm docs:check`）。本地不必全跑，但改动波及处对应的那几项要过，不然推到 CI 才红。
- 验证按 `.claude/skills/lyjwpage-verify/SKILL.md`，派活按 `.claude/skills/lyjwpage-delegate/SKILL.md`：多步检查、浏览器端到端、上线核对和不需要 Opus 判断的活（成批读、全仓搜、照规格的机械改动、等 CI 与部署）派 Haiku / Sonnet 子代理、Devin swe-2 或后台命令，合并门槛由主线程跑 `scripts/pr-gate.ts` 读全；主线程只定做什么、判结果。

# 部署流程

- 站点生产部署默认走 Git：完成必要验证后提交改动，执行 `git push origin main`，由 Workers Builds 自动部署 `site` Worker（域名切换步骤见 `docs/workers-builds.md`）。lyjw 要求部署站点时，包含完成这次提交与推送，无需再逐步确认。
- 合并 PR 用合并提交，标题与正文只用 `pnpm merge-message` 的输出，并带上它给的 `expectedHeadSha`，做法见 `.claude/skills/lyjwpage-verify/SKILL.md`「3. PR 合并门槛」。PR 标题照提交规范写成 `type(scope): 描述`；把 main 同步进分支照常 merge、不改写已推送历史。
- 域名与缓存链路见 `docs/ops-facts.md`；部署后的 ESA 首页刷新与 `version` 事件通知由 `.github/workflows/purge-esa.yml` 负责，契约见 `workers/ingress/README.md`。
- 自动部署失败时先检查并修复现有流程，不改用手工发布。
- `workers/core`、`workers/ai`、`workers/ingress`、`workers/collector` 走 Cloudflare Workers Builds 原生 Git 集成，配置与监视路径见 `docs/workers-builds.md`。不在 GitHub Actions 里加 Worker 发布任务；修改共享依赖或移动文件时同步核对监视路径。Worker 之间的契约（`shared/state-core.ts`、`shared/public-status.ts`、`shared/collector.ts`、`shared/digest.ts`）只加不改，被调用方先发布（Workers Builds 并行构建，保证顺序靠「禁区」里的手动部署例外）。
- 推送成功不等于部署完成：按 `.claude/skills/lyjwpage-verify/SKILL.md`「4. 合并后部署与生产核对」用 `scripts/deploy-check.ts` 核对，不手写轮询；生产行为复测只给预览测不准的改动，其余以预览验证为准。
- 上报器按各自 README 发布，`reporters/mac-telemetry-hub` 是要手动挪指针的 git submodule；哪些自动换镜像、指针怎么挪见 `.claude/rules/reporters.md`。

# 排查线上错误

- 线上报错、页面异常、Worker 或 cron 失败，先用 Cloudflare Code Mode MCP 查 Workers Observability 的证据，再读代码，按 `.claude/skills/lyjwpage-diagnose/SKILL.md` 复现、定位与修复。不凭猜测改代码，也不借浏览器登录态调接口；MCP 不可用时告诉 lyjw，而不是绕开。
- Workers Issues 里只读不写是默认。把 issue 标为 resolved / ignored 这类写操作，在修复部署并从生产验证后再做，并在汇报里说明；改 Issues 自动化、告警或可观测性设置，先问 lyjw。

# API 命名与跨端契约

新增或修改上报入口、状态端点、推送事件或跨来源字段前，先读 `docs/api-contracts.md` 的命名表。设计契约：同一类数据可以有多个来源，来源只上报自己观测到的原始事实；合并、去重、排名等派生量在站点侧一处计算，新增来源只加生产者和入口校验，不改消费者。

## 变更完成条件

- 重命名直接替换，不接受旧字段、不保留旧路由或兼容分支。
- 同步更新所有受影响的生产者、接收端、消费者、推送事件、测试和文档；按实际调用链确定范围。
- 跨仓库改动在已授权且可访问的范围内完成。外部配置或部署尚未同步时，列出具体对象和待办，不能把站点单侧修改报告成迁移完成。

# 界面设计

- 改站点 UI 前先读根 `DESIGN.md`：颜色、字号、间距、卡片结构、图标、滚动、动效、界面文案语言都以它为准，自查清单、量尺脚本与复刻对照在 `.claude/skills/lyjwpage-ui-design/SKILL.md`。图片交付规则见 `.claude/rules/images.md`。
- 有 UI / UX 变化的改动进 main 前，先给 lyjw 看效果、等 lyjw 点头再合；lyjw 明确要求的小改动除外。这条优先于「小改动本地检查过了就合」。

# 文档与注释

面向 agent 的写法：文档和注释会整段进上下文，错的比缺的更糟。每条陈述要么由代码保证，要么一眼能核实。

- 注释与 JSDoc 默认一行都不写，好名字自己会说话。内部函数、组件、hook、路由、服务、工具不写 JSDoc；`/** */` 只留给对外发布的库接口。
- 只有三类注释可以写，判据是「删了会让人改坏」：
  - 意外行为：绕开的 bug、浏览器或运行时怪癖、竞态、库的坑。
  - 设计意图：不变量、不显然的约束、后人会想顺手改掉的取舍（有意取的缓存期限、节奏、阈值）。理由只写在注释里时，删注释就等于删了这个决定。
  - 契约：导出类型与跨端字段的语义和单位；做不成测试或共享常量的「须与 X 同步」（优先改成测试或共享常量，做不到才写，两侧都写）。
- 不写：复述代码在做什么、把标识符翻译成句子、提调用方或任务 / PR / issue、分节标题与分隔线、没有跟踪单号的 TODO / FIXME（由 `pnpm rules:check` 拦）。
- 每次写完代码，逐个看新增的 `//`、`/*`、`/**`：删掉它，能读代码的人会不会改坏？不会就删。
- 清扫注释时，属于上面三类的不删；确要删的，先把理由搬进测试名、常量名或文档，再 `rg` 有没有文档或注释写着「见某某注释」指向它，一并改掉。只改注释的改动用 `pnpm docs:comment-only` 证明（用法见 `scripts/comment-only-check.ts` 文件头）。
- 不写历史与时间线（「之前」「已改为」「MM-DD 起」「本次」）；历史在 `git log`，旧做法不留注释。文档只写现状。
- 不抄易变的值：写常量或符号名（如 `AGENT_LIMITS_STALE_MS`），不抄「185 分钟」；数量、版本、日期同理。引用写路径加符号，不写行号。
- 采用了外部文章、演讲、仓库或官方文档里的做法，同一提交在 `docs/references.md` 对应主题下登记（流程见 `.claude/skills/lyjwpage-borrow/SKILL.md`）；落地处变了同步改。
- 一个事实一个出处，其他地方放指针；非抄不可时标 `源：path#symbol`（`pnpm docs:check` 会核对符号还在）。
- 改代码、规则或流程的同一提交里更新受影响的文档与注释：提交前 `rg` 改动的符号、常量名和规则关键词，范围含 `HUMAN.md`、`.claude/memory/`、`.claude/skills/`、`.claude/rules/`、`docs/`（含记着代码事实的 `docs/explainer/FACTS.md`）与各级 `README.md`。新加的东西（模型、数据去向、来源、Worker）还没有出处可搜，改搜它已有的同类（加 Clairic 就搜 Clef），照同类出现的每一处补上，对外的隐私说明 `src/components/god-chat.tsx#CONSENT_COPY` 也在其中。发现文档与代码冲突，以代码为准，当轮改掉，或在汇报里点名。
- 写 Markdown 的格式规矩（docs 类型、仓库外事实、AGENTS.md 写法与大小上限）见 `.claude/rules/docs-writing.md`。

## 规则 → 由什么强制

| 规则 | 由什么强制 |
| --- | --- |
| 不手跑 `wrangler deploy`、不强制提交 `.env*` / `.dev.vars`、不改提交身份或关签名 | PreToolUse 钩子 `scripts/guard-forbidden-commands.mjs` |
| 文档链接 / 路径 / 锚点存在、md 不写时间线、AGENTS 大小、docs 类型与索引、`@AGENTS.md` 配对 | `pnpm docs:check` |
| 「只改注释」的清扫证明 | `pnpm docs:comment-only` |
| README 架构图与工作流图跟 `scripts/readme-diagrams.ts` 的输出一致 | `pnpm docs:diagrams --check`（CI docs 门禁） |
| Worker / shared / `src/` 之间的 import 边界 | `eslint.config.mjs` 的 `no-restricted-imports` |
| `src/` 组件不手写 `<img>`，用 `AppImage`；不调 `toSorted` / `toReversed` / `toSpliced`（客户端无 polyfill） | `eslint.config.mjs` 的 `no-restricted-syntax`（`app-image.tsx` 除外） |
| Worker 生产代码不用 `env.X!` 硬取可选绑定 | `eslint.config.mjs` 的 `no-restricted-syntax`（测试除外） |
| 阶梯外间距、任意值字号 / 位移 / 圆角、子级外边距、裸 hex / oklch 色值 | `pnpm design:scale`（基线 `scripts/design-scale-baseline.json`） |
| `TODO` / `FIXME` 须带单号、JS / TS 不写 JSDoc 块注释、`/img/` 不烧交付域、`src/` 网络调用不写字面量主机、隐藏滚动条两句同现、`scripts/` 不新增 `.mjs`（存量见 `scripts/mjs-baseline.json`）、SHA-256 十六进制只用 `shared/sha256.ts`、普通对象判断只用 `shared/json.ts#object`、内联脚本 JSON 只经 `src/lib/inline-script.ts` 转义 | `pnpm rules:check` |
| 界面文案用英文 | `pnpm ui:copy`（基线 `scripts/ui-copy-baseline.json`） |
| 三份存量基线只减不增（例外由 lyjw 打 `baseline-exception` 标签放行，agent 不打） | `pnpm baselines:check` |

## Code Review Rules

@REVIEW.md
