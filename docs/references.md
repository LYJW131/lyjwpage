# 参考文献

> 类型：reference

塑造本项目做法的外部来源：文章、演讲、仓库、官方文档。每条写它是什么、我们从中取了什么、落在哪些文件。采用了新的外部做法就在对应主题下追加一条；落地处变了（文件改名、规则删掉、评估结论翻转）同一提交里改这里。只引用、没取任何做法的链接不进来，留在引用它的文档里。

状态：**采用**（已落进仓库）、**部分采用**、**待定**（评估过，还没落进仓库）、**不采用**（评估过，写明为什么，免得反复重评）。

## Agent 编排与定时自动化

- **[Building effective agent automations](https://claude.dev/blog/building-effective-agent-automations/)**（claude.dev）
  - 是什么：Anthropic 写的定时 agent 自动化实践。
  - 取了什么：按书签读、不按时间窗；读不到算失败、不当成没动静；写入明确成功才记账；每次运行重读偏好；最小权限和花费上限。
  - 状态：采用。落在 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「状态与偏好」、[lyjwpage-anthropic-updates](../.claude/skills/lyjwpage-anthropic-updates/SKILL.md)「状态与偏好」和每日代码审查定时任务，要点存于项目记忆 [agent-automation-practices](../.claude/memory/agent-automation-practices.md)。
- **[Creating in-house source control](https://www.anthropic.com/engineering/redesigning-source-control)**（Anthropic Engineering）
  - 是什么：Anthropic 自研版本控制 Scion 的设计与迁移，附带 agent 规模下的工程体会。
  - 取了什么：「superfan」，即一个 Claude 专盯一个组件的遥测和日志，抓传统告警漏掉的细微异常；评审区分只改注释和改逻辑、别为假想风险过度设计，本项目已有同类规则。
  - 状态：部分采用。superfan 落在 [lyjwpage-collector-superfan](../.claude/skills/lyjwpage-collector-superfan/SKILL.md)，先只盯 collector Worker。
- **[here's how i shipped 2,500 PRs last month](https://x.com/poteto/status/2102050467505430555)**（poteto / Lauren Tan，X 上的演讲视频）
  - 是什么：一个人同时驱动大量 agent 的做法。主线是「先让环境值得信任，并行是信任的结果」。
  - 取了什么：纠错阶梯，即每次纠正 agent 都落到能挡住它的最高一层（代码库 → lint / CI → 规则 → skill → 人工 review）；验证 skill 做成「共用 CLI + 功能地图」；让一个「园丁」专找正在被复制的坏写法，先写 lint 止血。
  - 状态：部分采用。纠错阶梯落在根 `AGENTS.md`「规则 → 由什么强制」表与 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「复盘需求偏差」的修正分档，配套检查是 `scripts/rules-check.ts`、`scripts/ui-copy-check.ts` 和 `design-scale-check.ts` 扩项；验证 skill 见下面 pstack 一条；园丁并进每日代码审查定时任务，发现记在缓冲 issue #280（定时任务登记见 [ops-facts.md](./ops-facts.md)）。外环（错误 → 分诊 → 两次复现 → 留给 lyjw 否决 → 另开线程修）落在 [lyjwpage-collector-superfan](../.claude/skills/lyjwpage-collector-superfan/SKILL.md) 第 3b 步，读 Workers Observability，不读 Sentry。
  - 相关：她的长文 [Loops You Can Trust](https://x.com/poteto/status/2069824386283319343)、[The Complete Guide to pstack Pt. 1](https://x.com/poteto/status/2094457600259842065)、[Pt. 2](https://x.com/poteto/status/2097732320606507506)。
- **[LIVE: Poteto (creator of pstack) on shipping 1,000's of PR's a month at SpaceX](https://www.youtube.com/watch?v=MN9dGgmLyso)**（Matt Pocock 对 poteto 的直播访谈，YouTube）
  - 是什么：上面那场演讲的延伸问答，讲这套做法每天怎么运转：内外循环、协调者、合并后抽检、full autopilot。
  - 取了什么：skill 只写流程，确定性的步骤下沉成脚本；园丁的发现先进缓冲文档、成批看出共同根因；合并后抽检，多个 agent 犯同样的错就改环境；常问「我在哪成了瓶颈」，让 agent 自己拿到原本要人转述的信息；翻过去的对话找反复纠正处，变成 lint 或 skill。
  - 状态：部分采用。「lyjw 成了瓶颈」落在 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「复盘需求偏差」；缓冲文档与合并后抽检随园丁并进每日代码审查定时任务（缓冲 issue #280）；相关错误归成一批落在 [lyjwpage-collector-superfan](../.claude/skills/lyjwpage-collector-superfan/SKILL.md) 第 3b 步。不采用 full autopilot（agent 自己合并、合并后才审）：前提是验证已经足够可信，本仓库 UI 改动要 lyjw 看图再合。
- **[pstack](https://github.com/cursor/plugins/tree/main/pstack)** 与 **[verification-skill-example](https://github.com/poteto/verification-skill-example)**（poteto）
  - 是什么：上面那套做法的 skill 实现，含协调者 playbook、纠错 skill `correct`、验证 skill 模板。
  - 取了什么：验证 skill = 共用 CLI + 功能地图（materialized memory），验证员不各自写一次性脚本；CLI 对 agent 友好：输出 JSON、报错写下一步、破坏性操作带 `--dry-run`。派活简报固定栏目、常驻指令原样贴入；写代码的不判自己的活，验证结论绑 head SHA；验证 skill 分 Launch / Doctor / Drive / Evidence / Cleanup 五节。
  - 状态：部分采用。共用 CLI 与功能地图落在 [site-verify.ts](../scripts/site-verify.ts) 与 [feature-map.json](../.claude/skills/lyjwpage-verify/feature-map.json)，由 [lyjwpage-verify](../.claude/skills/lyjwpage-verify/SKILL.md) 调用；合并后的构建与版本核对同样下沉成脚本 [deploy-check.ts](../scripts/deploy-check.ts)（访谈里「skill 只写流程、机械步骤进脚本」）；写代码的不判自己的活落在 lyjwpage-verify「3b」（大改逻辑的 PR 合并前派判定员，结论按 head SHA 记在 PR 评论里）；pstack 的验证账本（`ledger.tsv`：按 PR 加 head SHA 记一行分级结论，补丁没变的沿用，见 poteto-mode 的 [orchestrate](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/orchestrate.md)「Verification」与 [shipping](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/shipping.md)）落成 lyjwpage-verify「回执」：验证员签分级回执、主线程发成 PR 评论，[verify-receipt.ts](../scripts/verify-receipt.ts) 按 head 与相对 main 的补丁（逐字节、只忽略行号；不用 `git patch-id`，它忽略空白）判回执还算不算数，主线程不重跑回执里的检查；不采用她的异族模型验证员（只能派 Claude）；先复述再动手落在根 `AGENTS.md`「工作方式」与 `HUMAN.md`「7」。不采用简报九栏：项目的协作规则限定简报只带 lyjw 原话、记忆里的约束和分叉默认，常驻约束随记忆贴入已由项目记忆 handoff-carry-user-constraints 覆盖。
- **[Automating eval design and hillclimbing with Claude](https://claude.dev/blog/automating-eval-design-and-hillclimbing/)**（claude.dev）
  - 是什么：用 Claude 设计评测、按证据迭代提示词。
  - 取了什么：一次只改一处、改动可归因到根因，不把失败样例原文贴进提示词。
  - 状态：采用。落在 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「判断候选」的「一个 skill 一次只改一处根因」。

## 写 skill 与写给 agent 的文档

- **[Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)**（Claude 文档）、**[Claude Code skills](https://code.claude.com/docs/en/skills)**（Claude Code 文档）、**[Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)**（Anthropic Engineering）
  - 是什么：官方的 skill 写法与 frontmatter 规范。
  - 取了什么：描述写清做什么和何时用、触发词靠前；正文简洁，细节拆到一级引用文件；渐进披露；Claude A 写、Claude B 测。
  - 状态：采用。落在 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「写 skill 与偏差修正」，仓库里的 skill 都按它写。
- **[The new rules of context engineering for Claude 5 generation models](https://claude.dev/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models/)**（claude.dev）
  - 是什么：新一代模型的上下文写法。
  - 取了什么：少写硬约束，去掉互相冲突的指令，skill 当轻量指南。
  - 状态：采用。落在 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「参考」，是写和改 skill 的依据。
- **[mattpocock/skills](https://github.com/mattpocock/skills)**（Matt Pocock）
  - 是什么：一组通用工程 skill，主线是面谈 → 规格 → 拆票 → TDD → 双轴评审 → 复盘。
  - 取了什么：从 `diagnosing-bugs` 借排查纪律，先造一条能稳定复现症状的命令，再列可证伪的假设；从 `git-guardrails-claude-code` 借禁区做成钩子；`writing-for-agents` 的写法要点先按 Anthropic 最新文档核对，只并入一致的部分。
  - 不借：先问透的 grilling，和本项目偏行动的规矩冲突；规格与拆票依赖 issue 跟踪器，本项目用线程；PR 模板 lyjw 不要。
  - 状态：部分采用。排查纪律落在 [lyjwpage-diagnose](../.claude/skills/lyjwpage-diagnose/SKILL.md)；禁区钩子是 [guard-forbidden-commands.mjs](../scripts/guard-forbidden-commands.mjs)，由 [.claude/settings.json](../.claude/settings.json) 的 PreToolUse 挂上；写法要点落在 [writing.md](../.claude/skills/lyjwpage-skill-mining/writing.md)。

## 模型选择与子代理

- **[What a task costs on Opus 5.5](https://claude.dev/blog/what-a-task-costs-on-opus-5-5/)**（claude.dev）、**[Using Claude Code: Spending your effort](https://claude.dev/blog/spending-your-effort/)**（claude.dev）、**[Subagents](https://code.claude.com/docs/en/sub-agents)**（Claude Code 文档）
  - 是什么：各类任务的成本、effort 档位怎么选、子代理的 `model` / `effort` 字段。
  - 取了什么：搜索、读日志、读长历史这类出错容易发现的活放 Sonnet 或 Haiku，判断和改代码留在主模型；要验证、有边界情况的用 high；子代理看不到对话，关键规则要在简报里重说。
  - 状态：采用。落在 [lyjwpage-verify](../.claude/skills/lyjwpage-verify/SKILL.md)（验证交给 Haiku 验证员）和 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「派读者读线程」（Sonnet 读者）。

## 设计系统与 UI

- **[Vercel design.md](https://vercel.com/design.md)** 与博文 **[How our agents build on-brand pages with design.md](https://vercel.com/blog/how-our-agents-build-on-brand-pages-with-design-md)**（Vercel）
  - 是什么：教 agent 做 Vercel 署名报告页的公开 skill，配一套评测循环。
  - 取了什么：只取方法，不取视觉语言。具体是：每个间距只有一个主人；规则冲突时的优先级；同级数值不因内容更长单独缩字号；一组条形共用轨道和比例尺；分开诊断「太多」和「太吵」；能机检的规则交给代码。
  - 状态：采用。落在 [DESIGN.md](../DESIGN.md)、[lyjwpage-ui-design](../.claude/skills/lyjwpage-ui-design/SKILL.md)，以及只减不增的门禁 [design-scale-check.ts](../scripts/design-scale-check.ts)（`pnpm design:scale`）。
- **[Google Labs DESIGN.md 格式](https://github.com/google-labs-code/design.md)**
  - 是什么：给 agent 读的设计规范文件格式。
  - 取了什么：章节顺序。
  - 状态：采用。落在 [DESIGN.md](../DESIGN.md)。
- **[ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)**（nextlevelbuilder）
  - 是什么：按关键词检索的设计知识库，覆盖风格、配色、字体和 UX 规则。
  - 取了什么：`--domain ux`、`--domain chart` 的单条规则可以查。它的设计系统生成器与本站风格冲突，不用。项目里不安装。
  - 状态：部分采用。落在 [lyjwpage-ui-design](../.claude/skills/lyjwpage-ui-design/SKILL.md)「外部设计 skill 怎么用」。
- **[frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design)**（Anthropic）、**[Impeccable](https://github.com/pbakaus/impeccable)**（pbakaus）
  - 是什么：前者是给全新页面定视觉方向的 skill；后者带布局、排版命令和反模式检测。
  - 取了什么：前者只在做全新独立页面时参考；后者适合大改版时做一次外部审查。
  - 状态：部分采用。落在 [lyjwpage-ui-design](../.claude/skills/lyjwpage-ui-design/SKILL.md)「外部设计 skill 怎么用」。
- **[LobeHub Icons](https://lobehub.com/icons)**
  - 是什么：AI 与开发者品牌的图标集。
  - 取了什么：品牌和产品图标先查它，按深路径导入 `@lobehub/icons`；它的模型→厂商关键字表 `modelMappings`（包内 features 目录的 modelConfig）在构建时读成数据，给模型排行榜配厂商图标，不导入它会连带 `@lobehub/ui` 的 `ModelIcon` 组件。
  - 状态：采用。落在 [DESIGN.md](../DESIGN.md)「Components」的图标条目；模型表落在 `scripts/model-icons.ts`（`virtual:model-icons`）与 `src/lib/model-icon.ts`，各厂商单色图标由 `scripts/build-site-assets.tsx` 渲染成静态 SVG。

## Cloudflare 平台

- **[Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)**（Cloudflare 文档）
  - 是什么：DO 和普通 Worker 怎么分工。
  - 取了什么：依赖旧状态、要与原子更新一起做的计算留在 DO；参数处理、展示计算、第三方请求等放到普通 Worker。
  - 状态：采用。现状落在 [state-storage.md](./state-storage.md)（`StateHub` 只做串行合并与公开读批次，取数和展示在普通 Worker）；取舍依据见审计快照 [do-execution-audit.md](./do-execution-audit.md)。
- **[Workers Builds 的 GitHub 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)** 与 **[Preview 的 Service Binding](https://developers.cloudflare.com/workers/previews/resources/#service-bindings)**（Cloudflare 文档）
  - 是什么：Worker 原生 Git 部署，以及分支预览里的绑定行为。
  - 取了什么：Worker 只走 Workers Builds，不在 Actions 里发布；预览的 Service Binding 指向目标 Worker 的生产部署，所以分支上试新后端要走 Worker 分支预览。
  - 另取：Workers Builds 的新版 Previews 才会在 PR 上贴预览地址，而 `preview_urls` 不写默认关，所以站点显式打开。
  - 状态：采用。落在 [workers-builds.md](./workers-builds.md) 与 [wrangler.jsonc](../wrangler.jsonc) 的 `preview_urls`。
- **[Workers best practices：Worker 之间用 Service Binding](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#use-service-bindings-for-worker-to-worker-communication)**（Cloudflare 文档）
  - 是什么：Worker 互调的推荐方式。
  - 取了什么：站点域名上的 `/api/*` 按数据归属分流，后端一律经 Service Binding 原样转交，不跨域 `fetch`，因为跨域会改写 `CF-Connecting-IP`、让按 IP 的限流失效；浏览器因此只连站点一个域名。
  - 状态：采用。落在根 [AGENTS.md](../AGENTS.md)「禁区」与 [site-policy.ts](../src/lib/site-policy.ts) 的 `classifyGatewayRequest`。
- **[Workers Caching 的缓存键](https://developers.cloudflare.com/workers/cache/cache-keys/)**（Cloudflare 文档）
  - 是什么：Worker 版本 ID 默认是缓存键的一部分，`cross_version_cache` 要显式打开。
  - 取了什么：解释了为什么每次部署后首页从空缓存开始；不开 `cross_version_cache`，改成没有快照的卡按降级信封渲染、那份首页 `no-store`。
  - 状态：采用。落在 [state-storage.md](./state-storage.md) 首屏一节与 [card-boundary.tsx](../src/components/card-boundary.tsx)。
- **Cloudflare Access 的 Instant Auth（`auto_redirect_to_identity`）**（Cloudflare 控制台设置，讨论里没留链接）
  - 是什么：只允许一种登录方式时跳过选择页，直接跳到身份提供方。
  - 取了什么：站点分支预览用它省掉登录方式选择页，点开预览直接登录。
  - 状态：不再使用。站点分支预览不设登录，理由见 [workers-builds.md](./workers-builds.md)「分支预览」。
- **[Workers Observability](https://developers.cloudflare.com/workers/observability/)** 与 Workers Issues、Web Analytics（Cloudflare 文档）
  - 是什么：Cloudflare 自带的报错分组、日志与 Web Vitals。
  - 取了什么：完全替代 Sentry：心跳与在线条自建在 D1 `health_buckets`，报错数取 Observability 遥测查询，Vitals 取 Web Analytics，浏览器报错经 `/relay` 进 site Worker 日志，告警出口用 Workers Issues。
  - 已开：五个 Worker 的 Workers Issues（各自 wrangler 配置的 `observability.issues.enabled`；core 与 site 的分支预览关掉，见 [workers-builds](./workers-builds.md)「分支预览」），五个都开 `upload_source_maps` 让 Worker 调用栈对回源码。
  - 状态：采用（PR #198）。线上排查按根 [AGENTS.md](../AGENTS.md)「排查线上错误」；没有错误录像，浏览器栈要按 release 重新构建出 map 才能反解（见 [lyjwpage-diagnose](../.claude/skills/lyjwpage-diagnose/SKILL.md)「取证」）。
- **[Durable Object 的 transfer 迁移](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/#transfer-migration)**（Cloudflare 文档）
  - 是什么：把 DO 类从一个 Worker 转到另一个。
  - 取了什么：聊天 DO 迁到 AI Worker 时的有序切换。
  - 状态：采用。落在 [ai-worker-migration.md](./ai-worker-migration.md)。
- **[Workers KV Instant](https://blog.cloudflare.com/workers-kv-instant/)**（Cloudflare 博客）
  - 是什么：KV 的即时一致模式。
  - 状态：不采用，实时层仍留在 DO。评估时的限制、价格和重新评估的条件只记在项目记忆 [kv-instant-evaluation](../.claude/memory/kv-instant-evaluation.md)，平台调整后按那里的条件重评。

## 密钥管理

- **[Infisical](https://infisical.com/pricing)**（及其 [Cloudflare Workers 同步](https://infisical.com/docs/integrations/secret-syncs/cloudflare-workers)）
  - 是什么：开源的密钥管理平台，可自建或托管。
  - 状态：不采用。对一个人维护的仓库，收益抵不过多一个持有全部密钥的第三方和整套重灌的成本；套餐与集成能力会变，要重新考虑时按当时的产品现状重评，不沿用旧结论。密钥清单仍以 [ops-facts.md](./ops-facts.md) 为准，灌 Secret 走 [lyjwpage-mac-session](../.claude/skills/lyjwpage-mac-session/SKILL.md)。

## 前端与工具链

- **[TypeScript 7.0 RC 公告](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/)**（Microsoft）与 **[Nx 的 TypeScript 7 指南](https://nx.dev/docs/kb/typescript-7)**
  - 是什么：Go 实现的原生 TypeScript 编译器，以及迁移办法。
  - 取了什么：`tsc` 换成 TypeScript 7；typescript-eslint 还要旧的 JS API，所以按指南两版并装；Worker 的 tsconfig 去掉 7 不再支持的 `baseUrl`。
  - 状态：采用。落在根 [AGENTS.md](../AGENTS.md)「项目入口与验证」的 `typescript` 别名说明与根 `package.json`。
- **[React Compiler](https://react.dev/learn/react-compiler)**（React 文档）
  - 是什么：编译期自动记忆化。
  - 取了什么：站点构建经 `@vitejs/plugin-react` 的 `reactCompilerPreset` 接入。
  - 状态：采用。落在 [vite.config.ts](../vite.config.ts)。
- **[markdown-cjk-friendly](https://github.com/tats-u/markdown-cjk-friendly)**（`remark-cjk-friendly`）
  - 是什么：修正 CommonMark 在中日韩标点旁不认 `**` 收尾的 remark 插件。
  - 取了什么：对话里「？」后紧跟中文的加粗会原样显示星号，接上它和配套的删除线插件。
  - 状态：采用。落在 [chat-markdown-plugins.ts](../src/lib/chat-markdown-plugins.ts)。
- **[TanStack Start 1.0 is Stable](https://tanstack.com/blog/tanstack-start-1-0)** 与 **[We stopped using RSC on tanstack.com](https://tanstack.com/blog/we-stopped-using-rsc-on-tanstack-com)**（Tanner Linsley）
  - 是什么：TanStack Start 稳定版公告；tanstack.com 发现 RSC 主要在替一套过大的 Markdown 与高亮依赖遮丑，改为把依赖做小、回到普通 SSR。
  - 取了什么：先量首屏包里谁大。聊天的 react-markdown 与 remark 插件原本在首页路由块里，拆成按需加载的独立块，聊天卡片进入视口时预加载。
  - 状态：部分采用。落在 [lazy-chat-markdown.tsx](../src/components/lazy-chat-markdown.tsx)。不迁到 TanStack Start：React Router 已有类型化路由与 Workers 上的 SSR，Start 主打的 server function 与根 [AGENTS.md](../AGENTS.md)「禁区」的站点侧不写后端相冲。不换 `@tanstack/markdown`：它没有 remark 插件链，会丢掉 `remark-cjk-friendly` 的中文加粗修正。

## 交互与文案参照

- **ChatGPT 的聊天输出**（[chatgpt.com](https://chatgpt.com)，在 lyjw 的浏览器里实测，没有文章）
  - 是什么：它不在回答里塞 HTML，而是让模型挑组件、用自家设计系统内联画出数字卡、图表、时间线，只有要跑逻辑的部分进隐藏沙箱。
  - 取了什么：首页对话的图示改成站点原生组件，HTML 沙箱只作兜底；预览卡固定尺寸、可重来、可全屏，切换视图不卸载。
  - 状态：采用。落在 [chat-visual.tsx](../src/components/chat-visual.tsx) 与 [chat-html-preview.tsx](../src/components/chat-html-preview.tsx)。
- **Claude 界面的 thinking 提示**（lyjw 点名参照，没有文章）
  - 是什么：一道高光从左往右扫过的「思考中」标签。
  - 取了什么：对话等待时显示 `THINKING` 扫光，模型流出思考时可展开。
  - 状态：采用。落在 [god-chat.tsx](../src/components/god-chat.tsx)。
- **Apple 中国官网的产品标语**（lyjw 给的截图，没有链接）
  - 是什么：短、笃定、具体的中文标语写法。
  - 取了什么：摘要卡标题写成 3 到 5 个汉字的标语口吻。试过的书法字体被 lyjw 否掉，没有保留。
  - 状态：采用。落在 [compose.ts](../workers/ai/src/digest/compose.ts) 的提示词。
