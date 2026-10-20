# 参考文献

> 类型：reference

塑造本项目做法的外部来源：文章、演讲、仓库、官方文档。每条写它是什么、我们从中取了什么、落在哪些文件。采用了新的外部做法就在对应主题下追加一条；落地处变了（文件改名、规则删掉、评估结论翻转）同一提交里改这里。只引用、没取任何做法的链接不进来，留在引用它的文档里。

状态：**采用**（已落进仓库）、**部分采用**、**待定**（评估过，还没落进仓库）、**不采用**（评估过，写明为什么，免得反复重评）。

## Agent 编排与定时自动化

- **[Building effective agent automations](https://claude.dev/blog/building-effective-agent-automations/)**（claude.dev）
  - 是什么：Anthropic 写的定时 agent 自动化实践。
  - 取了什么：按书签读、不按时间窗；读不到算失败、不当成没动静；写入明确成功才记账；每次运行重读偏好；最小权限和花费上限。
  - 状态：采用。落在 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「状态与偏好」、[lyjwpage-anthropic-updates](../.claude/skills/lyjwpage-anthropic-updates/SKILL.md)「状态与偏好」和每日代码审查定时任务，书签只在成功后推进一条写进根 `AGENTS.md`「工作方式」，细则在 [`.claude/rules/routines.md`](../.claude/rules/routines.md)，要点存于项目记忆 [agent-automation-practices](../.claude/memory/agent-automation-practices.md)。
- **[How the Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/)**（claude.dev）
  - 是什么：Claude Code 团队的分层评审、评审收敛规则和人留在哪些环节。
  - 取了什么：「When we change direction」一节，即方向分歧早在讨论里提、做完的 PR 关掉不算损失；评审收敛规则里的三轮后重看方法、按缺陷类别一次修完、不重复已发的发现；「Reading the evidence」里说不出检查漏了什么就别批准；短 REVIEW.md 的写法（什么算出错、不报什么、要行号证据、总结先写条数）。
  - 状态：部分采用。方向落在 [HUMAN.md](../HUMAN.md)「3. 什么 Claude 自己定，什么来问你」的「探索与换方向」，要点存于项目记忆 [explore-directions](../.claude/memory/explore-directions.md)；收敛与证据落在 [lyjwpage-verify](../.claude/skills/lyjwpage-verify/SKILL.md) 「3. PR 合并门槛」与「主线程收到报告后」、HUMAN.md「5. PR 与合并」；评审指引在根 [REVIEW.md](../REVIEW.md)，由根 `AGENTS.md`「Code Review Rules」一行 `@REVIEW.md` 引入。高风险路径另等人审没有采用（lyjw 选维持现状）。
- **[Creating in-house source control](https://www.anthropic.com/engineering/redesigning-source-control)**（Anthropic Engineering）
  - 是什么：Anthropic 自研版本控制 Scion 的设计与迁移，附带 agent 规模下的工程体会。
  - 取了什么：「superfan」，即一个 Claude 专盯一个组件的遥测和日志，抓传统告警漏掉的细微异常；评审区分只改注释和改逻辑、别为假想风险过度设计，本项目已有同类规则。
  - 状态：部分采用。superfan 落在 [lyjwpage-collector-superfan](../.claude/skills/lyjwpage-collector-superfan/SKILL.md)，先只盯 collector Worker。
- **[here's how i shipped 2,500 PRs last month](https://x.com/poteto/status/2102050467505430555)**（poteto / Lauren Tan，X 上的演讲视频）
  - 是什么：一个人同时驱动大量 agent 的做法。主线是「先让环境值得信任，并行是信任的结果」。
  - 取了什么：纠错阶梯，即每次纠正 agent 都落到能挡住它的最高一层（代码库 → lint / CI → 规则 → skill → 人工 review）；验证 skill 做成「共用 CLI + 功能地图」；让一个「园丁」专找正在被复制的坏写法，先写 lint 止血。
  - 状态：部分采用。纠错阶梯落在根 `AGENTS.md`「规则 → 由什么强制」表与 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「复盘需求偏差」的修正分档，配套检查是 `scripts/rules-check.ts`、`scripts/ui-copy-check.ts` 和 `design-scale-check.ts` 扩项；验证 skill 见下面 pstack 一条；园丁并进每日代码审查定时任务，发现记在缓冲 issue #280（定时任务登记见 [ops-facts.md](./ops-facts.md)）。外环（错误 → 分诊 → 两次复现 → 修复草稿 PR，lyjw 在 PR 上否决）落在 [lyjwpage-collector-superfan](../.claude/skills/lyjwpage-collector-superfan/SKILL.md) 第 3b、3c 步，读 Workers Observability，不读 Sentry。
  - 相关：她的长文 [Loops You Can Trust](https://x.com/poteto/status/2069824386283319343)、[The Complete Guide to pstack Pt. 1](https://x.com/poteto/status/2094457600259842065)、[Pt. 2](https://x.com/poteto/status/2097732320606507506)。
- **[LIVE: Poteto (creator of pstack) on shipping 1,000's of PR's a month at SpaceX](https://www.youtube.com/watch?v=MN9dGgmLyso)**（Matt Pocock 对 poteto 的直播访谈，YouTube）
  - 是什么：上面那场演讲的延伸问答，讲这套做法每天怎么运转：内外循环、协调者、合并后抽检、full autopilot。
  - 取了什么：skill 只写流程，确定性的步骤下沉成脚本；园丁的发现先进缓冲文档、成批看出共同根因；合并后抽检，多个 agent 犯同样的错就改环境；常问「我在哪成了瓶颈」，让 agent 自己拿到原本要人转述的信息；翻过去的对话找反复纠正处，变成 lint 或 skill。
  - 状态：部分采用。「lyjw 成了瓶颈」落在 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「复盘需求偏差」；缓冲文档与合并后抽检随园丁并进每日代码审查定时任务（缓冲 issue #280）；相关错误归成一批落在 [lyjwpage-collector-superfan](../.claude/skills/lyjwpage-collector-superfan/SKILL.md) 第 3b 步。不采用 full autopilot（agent 自己合并、合并后才审）：前提是验证已经足够可信，本仓库 UI 改动要 lyjw 看图再合。
- **[pstack](https://github.com/cursor/plugins/tree/main/pstack)** 与 **[verification-skill-example](https://github.com/poteto/verification-skill-example)**（poteto）
  - 是什么：上面那套做法的 skill 实现，含协调者 playbook、纠错 skill `correct`、验证 skill 模板。
  - 取了什么：验证 skill = 共用 CLI + 功能地图（materialized memory），验证员不各自写一次性脚本；CLI 对 agent 友好：输出 JSON、报错写下一步、破坏性操作带 `--dry-run`。派活简报固定栏目、常驻指令原样贴入；写代码的不判自己的活，验证结论绑 head SHA；验证 skill 分 Launch / Doctor / Drive / Evidence / Cleanup 五节。
  - 状态：部分采用。共用 CLI 与功能地图落在 [site-verify.ts](../scripts/site-verify.ts) 与 [feature-map.json](../.claude/skills/lyjwpage-verify/feature-map.json)，由 [lyjwpage-verify](../.claude/skills/lyjwpage-verify/SKILL.md) 调用；合并后的构建与版本核对同样下沉成脚本 [deploy-check.ts](../scripts/deploy-check.ts)（访谈里「skill 只写流程、机械步骤进脚本」）；写代码的不判自己的活落在 lyjwpage-verify「3b」（大改逻辑的 PR 合并前派判定员，结论按 head SHA 记在 PR 评论里）；pstack 的验证账本（`ledger.tsv`：按 PR 加 head SHA 记一行分级结论，补丁没变的沿用，见 poteto-mode 的 [orchestrate](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/orchestrate.md)「Verification」与 [shipping](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/shipping.md)）落成 lyjwpage-verify「回执」：验证员签分级回执、主线程发成 PR 评论，[verify-receipt.ts](../scripts/verify-receipt.ts) 按 head 与相对 main 的补丁（逐字节、只忽略行号；不用 `git patch-id`，它忽略空白）判回执还算不算数，主线程不重跑回执里的检查；不采用她的异族模型验证员（只能派 Claude）；先复述再动手落在根 `AGENTS.md`「工作方式」与 `HUMAN.md`「7」。不采用简报九栏：项目的协作规则限定简报只带 lyjw 原话、记忆里的约束和分叉默认，常驻约束随记忆贴入已由项目记忆 handoff-carry-user-constraints 覆盖。
- **[create-formal-verification-skill](https://github.com/cursor/plugins/tree/main/pstack/skills/create-formal-verification-skill)** 与 [maintain-formal-verification-skill](https://github.com/cursor/plugins/tree/main/pstack/skills/maintain-formal-verification-skill)（pstack，[发布推文](https://x.com/poteto/status/2111926622278521253)）
  - 是什么：元 skill，从代码里挑出错代价最高、测试最难覆盖的一块，按问题选工具（顺序类问题默认 TLA+，逐输入的性质用 kani 这类跑在代码上的验证器），生成项目内的形式化验证 skill；配套的 maintain 在代码变了以后把模型重新对齐，分清模型过期和代码 bug。
  - 取了什么：按它的做法对访客构建 `workers/ai/src/build/coordinator.ts#BuildCoordinator` 试跑过一次 TLA+ 审计（按 f0927832 的代码建模）：准备租约、派发、上传发布、草稿清扫、超时与维护者关 PR 交错，四条安全性质（最多派发一次、实现提交先记后推、清扫不关已推实现的 PR、已发布的不被清扫）全部成立，五个改坏变体抓到四个，另一个因 `closableDraft` 与 `closeFailedDraft` 双重检查仍安全。附带结论：`closeFailedDraft` 在 GitHub 侧只核对会滞后的 PR head，误关靠 DO 侧 `setImplementationHead` 要求 `validated` 挡住。
  - 状态：不采用常驻。没找到 bug；其余 Durable Object 已把读、判、写放进同步事务，可验的少；模型要随代码维护，常驻不划算。模型只留在 Claude 项目共享目录的 formal-verification 文件夹，不进仓库；访客构建协议大改时可拿它重跑。查 bug 时按需建模的做法见下一条。
- **[I used Opus 5.5 to formally verify the Claude Agent SDK using Lean](https://x.com/bcherny/status/2102543349102338309)** 与[补充说明](https://x.com/bcherny/status/2102898067133595992)（Boris Cherny，Anthropic，X）
  - 是什么：让 Claude 给代码里最易出竞态的状态机建 Lean / TLA+ 模型，几句提示词产出 16 个修 bug 的 PR。补充里说明做法分四步（建模、在模型里找反例、复现、修代码），且不是整个代码库都被验证。
  - 取了什么：四步流程，只在查竞态、顺序、重试类 bug 时用，只用 TLA+；用故意改坏的变体证明检查会失败。另取 Lucas Cordeiro 演讲 [Formal Verification of LLM-Generated Code](https://ssvlab.github.io/lucasccordeiro/talks/fattw2026_slides.pdf) 的一条：模型能补验证里的细节，规则本身要人确认。
  - 状态：采用，按需。落在 [lyjwpage-formal-model](../.claude/skills/lyjwpage-formal-model/SKILL.md)，由 [lyjwpage-diagnose](../.claude/skills/lyjwpage-diagnose/SKILL.md) 第 2 步指过去。不用 Lean：本项目难点在并发与状态。
- **[How to be more ambitious: A tutorial for humans with models](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/)**（Felix Rieseberg，Anthropic）
  - 是什么：把「用 AI 要更有野心」拆成高度（给目标不给任务）、深度（专家的工具、离谱的目标、外部裁判）、广度（名词换动词、按领域组队）。
  - 取了什么：「深一层」四问提示，lyjw 派活时贴。外部裁判本项目已有（验证回执脚本、CI 门禁、机器评审）。
  - 状态：部分采用。四问落在 `HUMAN.md`「2. 怎么说一句话最快」；高度落在 [lyjwpage-collector-superfan](../.claude/skills/lyjwpage-collector-superfan/SKILL.md) 第 3c 步，复现了的错误批次直接开修复草稿 PR，lyjw 在 PR 上否决。深度落在首屏：按 PageSpeed 拆出的 LCP 瓶颈把 modulepreload 挪到 `</body>` 前并降为低优先级、先画一帧再水合、屏外图懒加载（`src/lib/defer-module-preloads.ts`、`src/app/entry.server.tsx`、`src/app/entry.client.tsx`、`src/components/live/watching-card.tsx`、`src/components/live/playstation-card.tsx`）。不采用部署后的 LCP 预算检查：站点自己的 PageSpeed 卡片（collector 的 `pagespeed` 任务）每天都看得到，lyjw 认为不必再加。不采用：名词换动词与组队，属写提示的习惯，没有可落地的文件。
- **[Automating eval design and hillclimbing with Claude](https://claude.dev/blog/automating-eval-design-and-hillclimbing/)**（claude.dev）
  - 是什么：用 Claude 设计评测、按证据迭代提示词。
  - 取了什么：一次只改一处、改动可归因到根因，不把失败样例原文贴进提示词。
  - 状态：采用。落在 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「判断候选」的「一个 skill 一次只改一处根因」。
- **[magpie](https://github.com/yetone/magpie)**（yetone）
  - 是什么：由 agent 写、评、合、发的桌面应用仓库，工作流写在它的 AGENTS.md、LESSONS.md、docs/code-standards.md 与 test 工作流里。
  - 取了什么：合并钉住验过的 head（它用 `gh pr merge --match-head-commit`）；修复要证明「撤掉就红」；每晚审当天提交、找返工的记成教训，同类见满 3 天升成规则；main 上的 CI 不被下一次推送取消。
  - 状态：部分采用。钉 head 落在 [merge-message.ts](../scripts/merge-message.ts) 输出的 `expectedHeadSha` 与 [lyjwpage-verify](../.claude/skills/lyjwpage-verify/SKILL.md)「3. PR 合并门槛」；撤回证明落在 [lyjwpage-verify](../.claude/skills/lyjwpage-verify/SKILL.md)「1. 本地门禁」，由 [revert-proof.ts](../scripts/revert-proof.ts) 在临时 worktree 里执行；返工账落在 04:00 每日审查提示词的园丁一步（`docs/ops-facts.md` 里那条 routine，提示词只能从它自己的线程改），记进缓冲 issue #280，候选由 [rework-candidates.ts](../scripts/rework-candidates.ts) 列出，模型只定类别；CI 落在 [ci.yml](../.github/workflows/ci.yml) 的 `concurrency`。不采用：PR 上自动录屏截图的 UI 预览（要在 CI 跑 PR 代码并持模型 key，已有 `pnpm dev:scene` 与验证员截图）、每次必读的大教训文件（教训直接落成检查、skill 或记忆）、社区 PR 防害与拉黑（无外部贡献者）、子系统设计页（已有 `docs/` 与 `pnpm docs:check`）、提交正文记验证（回执已绑 SHA 发在 PR 评论）。

## 写 skill 与写给 agent 的文档

- **[How Claude remembers your project](https://code.claude.com/docs/en/memory)** 与 **[Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)**（Claude Code 文档）
  - 是什么：CLAUDE.md / AGENTS.md 的写法、加载方式与体量建议。
  - 取了什么：每个文件控制体量（@import 不省 token，开场照样全量加载）；只跟部分代码有关的规则改成带 `paths` 的 `.claude/rules/`，碰到匹配文件才载入；只在部分时候用的流程放进 skill；对每行问「删了会不会出错」。
  - 状态：采用。根 `AGENTS.md` 的流程细节搬进 lyjwpage-verify、lyjwpage-diagnose，按目录的规则落在 `.claude/rules/`，跨端命名表落在 `docs/api-contracts.md`；大小上限按字节由 [docs-check.ts](../scripts/docs-check.ts) 的 `ROOT_AGENTS_MAX_BYTES` 与 `NESTED_AGENTS_MAX_BYTES` 检查。
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
- **[Matt Pocock：GLOSSARY.md](https://x.com/mattpocockuk/status/2109735647267430497)**（X 帖子）
  - 是什么：给 agent 一份项目术语表，让它用你的词说话。
  - 取了什么：根目录放一份术语表，每条一句定义加出处，根 `AGENTS.md` 指过去。
  - 状态：采用。落在 [GLOSSARY.md](../GLOSSARY.md)。
- **[Matt Pocock：单文件不超过 5,000 token](https://x.com/mattpocockuk/status/2111708560715292675)**（X 帖子）
  - 是什么：提交前钩子拒绝超过 5,000 token（字节 / 4）的文件，只查 agent 写的文件，报错里写清怎么拆；回复里补充「模块不等于文件」，要保持深模块。
  - 取了什么：按职责拆大文件、原路径留作入口；只在改动碰到时拆，切不出自然边界就不拆。
  - 不借：硬门禁。整仓试拆一遍，约四分之一的拆分只为过线，可读性变差。
  - 状态：部分采用。软规则落在根 [AGENTS.md](../AGENTS.md)「工作方式」。

- **[seiso](https://github.com/scarletkc/seiso)**（scarletkc，含 [Seiso 规范](https://seiso.fog.moe/latest/convention)）
  - 是什么：给 AI 写、人和 agent 读的项目文档定的 Markdown 规范，配一个 Rust 写的 linter：每篇声明一种类型、一个事实一个出处、长期文档不写易变值、指针写到文件或符号、例外写理由。
  - 不采用：规范与根 `AGENTS.md`「文档与注释」基本重合；稳定规则只查类型声明与本地链接，`pnpm docs:check` 已覆盖且更多；实验规则在中文文档上误报多。试过整仓接入（PR #428，未合），文档本身没变好，只多一个二进制依赖和一套类型词表。

## 模型选择与子代理

- **[What a task costs on Opus 5.5](https://claude.dev/blog/what-a-task-costs-on-opus-5-5/)**（claude.dev）、**[Using Claude Code: Spending your effort](https://claude.dev/blog/spending-your-effort/)**（claude.dev）、**[Subagents](https://code.claude.com/docs/en/sub-agents)**（Claude Code 文档）
  - 是什么：各类任务的成本、effort 档位怎么选、子代理的 `model` / `effort` 字段。
  - 取了什么：搜索、读日志、读长历史这类出错容易发现的活放 Sonnet 或 Haiku，判断和改代码留在主模型；要验证、有边界情况的用 high；子代理看不到对话，关键规则要在简报里重说。
  - 状态：采用。落在 [lyjwpage-delegate](../.claude/skills/lyjwpage-delegate/SKILL.md)（各线程把机械活派给 Sonnet / Haiku 或后台命令）、[lyjwpage-verify](../.claude/skills/lyjwpage-verify/SKILL.md)（验证交给 Haiku 验证员）和 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「派读者读线程」（Sonnet 读者）。
- **[Vision · Resolution and token cost](https://platform.claude.com/docs/en/build-with-claude/vision#evaluate-image-size)**（Claude 文档）
  - 是什么：模型按 28×28 px 一块计视觉 token，每档模型有长边和 token 上限，超了先缩小再看。
  - 取了什么：给 Haiku 逐帧看的验收图按标准档上限拼，每张 2 帧时每格仍是原尺寸、哪档模型看都不会被缩；拼得更多格子就被缩小，细节开始漏，所以默认每张 2 帧。
  - 状态：采用。落在 [sheets.py](./explainer/v2/tools/sheets.py) 和 [lyjwpage-explainer](../.claude/skills/lyjwpage-explainer/SKILL.md)，实测见 [逐帧验收拼图实测](./explainer/frame-qa-calibration.md)。
- **[Opus 5.5 Motion Lab: Make Claude Animate Like a Studio](https://x.com/flxrnc/status/2105311836190978392)**（Florence，X Article）
  - 是什么：用代码出动效的做法，其中的「渲染契约」要求每帧是 t 的纯函数，并按帧号截静帧自查。
  - 取了什么：按这条契约逐章审 /explainer，同一时刻正序、乱序 seek 比截图。章代码都守约，乱序差异来自 Chrome GPU 画布画线段端点的抗锯齿，于是工具里的 2D 图层改走 CPU 光栅。
  - 状态：采用。落在 [browser.mjs](./explainer/v2/tools/browser.mjs)#openFilm。

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

- **[Streamdown 的流式动画](https://streamdown.ai/docs/animation)**（Vercel）
  - 是什么：流式 Markdown 渲染里，rehype 插件把文字节点拆成一个个 span，只有新挂载的 span 播淡入。
  - 取了什么：拆 span 的思路、跳过 `pre` / `svg` / `math`、回复结束后摘掉插件回到纯文本。没装这个库；中日韩文字改为逐字切，淡入时长按 DESIGN.md 的动效区间取。
  - 状态：采用。落在 `src/lib/chat-markdown-plugins.ts#rehypeStreamFade`、`src/app/styles/animations.css` 的 `.stream-token`，由 `src/components/god-chat.tsx` 在回复流式期间打开；回复里的原生图示同样按 `streamTokens` 拆字淡入（`src/components/chat-visual/ink.tsx#Ink`）。
- **[Clawd's Halloween](https://x.com/alexgreensh/status/2110404428691808308)**（Alex Greenshpun）与 **[anidoodle](https://github.com/alexgreensh/anidoodle)** 的 colouredPencil 画法（Apache-2.0）
  - 是什么：Opus 5.5 用 anidoodle skill 纯代码画的彩铅动画短片；skill 里每种画风写明媒介、笔触、边缘和落笔顺序。
  - 取了什么：彩铅的做法，一个主斜向的短排线、浅深两色叠层、形体边缘颜色加厚、暗部换方向交叉排线、断续出头的深色轮廓、灯旁的暖黄光晕；配色按原片关键帧取色。没装 skill，也没拷代码：排线改成按种子生成的图块，每帧拿它填形状。手写字用 [霞鹜漫黑](https://github.com/lxgw/LxgwMarkerGothic)（OFL），只取第 08 章用到的字。还取了原片把项目里的梗画成屋里摆设的做法，第 08 章每个机位的彩蛋照这个放。
  - 状态：试用，用在讲解动画第 08 章（彩铅）和第 04 章（报纸）。落在 `docs/explainer/v2/pencil.js`、`docs/explainer/v2/ch08.js`、`docs/explainer/fonts/LXGWMarkerGothic-ch08.woff2`。
  - 第 04 章取原片「THE DAILY PROMPT」报纸头版那一段的路子：同一部片里一章换一种画风，整章做成一张头版，镜头逐篇读；网点套色、新闻纸和逐字压墨的标题是自己画的，标题字用 [思源宋体](https://fonts.google.com/noto/specimen/Noto+Serif+SC)（OFL），只取这一章的字。落在 `docs/explainer/v2/ch04.js`、`docs/explainer/fonts/NotoSerifSC-600-ch04-06.woff2`、`docs/explainer/fonts/NotoSerifSC-900-ch04-06.woff2`。
  - 第 06 章同样换一种画风，做成水墨：宣纸、一笔有粗细带飞白的心电图、墨分五色的地层、朱印、裱成挂轴的状态卡，都是自己画的；旁白用 [马善政毛笔楷](https://fonts.google.com/specimen/Ma+Shan+Zheng)（OFL），只取这一章的字。落在 `docs/explainer/v2/ch06.js`、`docs/explainer/fonts/MaShanZheng-ch06.woff2`。
- **[Voxyz 的配音效提示词](https://x.com/Voxyz_ai/status/2109358372873183564)** 与 **[Openverse 音效检索](https://x.com/Voxyz_ai/status/2111140116572049485)**（[api.openverse.org](https://api.openverse.org)）
  - 是什么：给 Claude 做的视频配声音的一段提示词：每个动作配一个现成的音效文件，不在代码里合成音效；按节拍放大动作；音效压在配乐上面；导出后量响度，逐个音效抽前后帧、画波形核对，再挑几个时刻让人戴耳机听。缺音效时到 Openverse 免登录检索，只取 CC0 / CC BY / PDM、来自 freesound 的结果，署名照抄。
  - 取了什么：第 08 章的故事音效用 Openverse 检索 freesound 录音当候选，按画面动作排时刻；配乐仍在浏览器里合成。没有照搬它的 -16 LUFS / -4 dBFS 目标，响度与卡点改由 earshot 核对（见下一条）。
  - 状态：试用，只用在讲解动画第 08 章。落在 `docs/explainer/v2/sfx/`（署名在 `CREDITS.txt`）、`docs/explainer/v2/music/ch08.js` 的 `SFX`、`docs/explainer/v2/film.js#withSfx`、`scripts/build-explainer.mjs`。
- **[earshot](https://github.com/Leonxlnx/earshot)**（MIT）
  - 是什么：让模型「听」声音的命令行与 Python 库：用 CLAP / AST 模型给音频打标签、按文字描述给候选排名（`rank`）、在长录音里找最像的一段（`find`）、做强制选择（`match --alts`）；对整条混音出带卡点的听感记录（`timeline --cues`）、谱面图（`sheet`）和对照发布片的评分表（`critique`）；另带 201 个代码合成的音效库。
  - 取了什么：第 08 章 18 类音效每类 6 个 freesound 候选加库里同类音效，按画面要的声音写一句描述，用 `find` 截出最像的一段、`rank` 排名、`match` 排除易混的声音后挑定；混音后用 `timeline --cues` 查每个卡点有没有落上、有没有被盖住，按它报的偏差给渐强类音效加提前量、按各类响度重配音量，再用 `sheet` 和 `critique` 复核。音效库只当候选，最后选中的都是录音。
  - 状态：试用，用在讲解动画第 04、08 章；工具本身不进仓库，听的结果体现在 `docs/explainer/v2/sfx/`、`docs/explainer/v2/score.js` 的 `SFX_LEAD`、`docs/explainer/v2/music/ch04.js` 与 `docs/explainer/v2/music/ch08.js` 的 `SFX` 音量、`docs/explainer/v2/film.js#withSfx` 的压峰。

## Cloudflare 平台

- **[Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)**（Cloudflare 文档）
  - 是什么：DO 和普通 Worker 怎么分工。
  - 取了什么：依赖旧状态、要与原子更新一起做的计算留在 DO；参数处理、展示计算、第三方请求等放到普通 Worker。
  - 状态：采用。现状落在 [state-storage.md](./state-storage.md)（`StateHub` 只做串行合并与公开读批次，取数和展示在普通 Worker）；取舍依据见审计快照 [do-execution-audit.md](./do-execution-audit.md)。
- **[Workers Builds 的 GitHub 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)** 与 **[Preview 的 Service Binding](https://developers.cloudflare.com/workers/previews/resources/#service-bindings)**（Cloudflare 文档）
  - 是什么：Worker 原生 Git 部署，以及分支预览里的绑定行为。
  - 取了什么：Worker 只走 Workers Builds，不在 Actions 里发布；预览的 Service Binding 指向目标 Worker 的生产部署，所以分支上试新后端要走 Worker 分支预览。
  - 另取：Workers Builds 的新版 Previews 才会在 PR 上贴预览地址；`core` 显式开 `preview_urls`，`site` 走 `preview.lyjw.dev` 自定义域名预览并关掉 `preview_urls`。
  - 状态：采用。落在 [workers-builds.md](./workers-builds.md)、[workers/core/wrangler.toml](../workers/core/wrangler.toml) 的 `preview_urls` 与 [wrangler.jsonc](../wrangler.jsonc) 的 `routes`。
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
- **[Introducing Clairic](https://blog.cloudflare.com/clairic-extraction-model/)**（Cloudflare 博客）
  - 是什么：Workers AI 上的 System One 抽取模型 `@cf/cloudflare/clairic`，一次前向传播按带类型的字段回值，带 `p_null` 与置信度。
  - 取了什么：首页对话选档时和 Clef 并行问一次 Clairic，抽出访客点名的游戏、歌、番名，作为状态预取的 `query`；门槛按线上实测定。
  - 状态：采用。落在 [router.ts](../workers/ai/src/chat/router.ts) 的 `itemInput`、`parseItem` 与 `PREFETCH_STATUS` 的 `query`。

## 联网搜索与文档检索

- **[Exa](https://exa.ai/docs/reference/search) 的搜索、抓取 API**
  - 是什么：给 agent 用的网页搜索服务，返回按查询截好的摘录，`category` 可限定新闻、论文；`/contents` 抓整页。
  - 取了什么：首页对话的 `web_search` / `web_fetch` 从 Anthropic 服务端工具换成 Worker 执行的客户端工具，只用 `lite` 档（Exa 3.0 起与原 `fast` 同一套搜索、更便宜，`fast` 列为 legacy，见 [changelog](https://exa.ai/docs/changelog)）；结果用 Claude API 的 [search_result 块](https://platform.claude.com/docs/en/build-with-claude/search-results) 回给模型，保住原生引用。和 Parallel、Exa `auto` 档、原生搜索的对照实测记在 PR 描述里。
  - 状态：采用。落在 `workers/ai/src/chat/web-search.ts` 与 `workers/ai/src/chat/reply-tools.ts`。
- **[Bangumi API](https://bangumi.github.io/api/) 与 Steam 商店的 `storesearch` / `appdetails` 接口**
  - 是什么：免 key 的动画条目搜索（评分、排名、标签）与 Steam 商店搜索、详情（价格、发售日、Metacritic）。
  - 取了什么：首页对话的 `anime_search`、`game_search`，结果同样回成 `search_result` 块。
  - 状态：采用。落在 `workers/ai/src/chat/domain-search.ts`。
- **[Context7](https://context7.com)、[Cloudflare 文档 MCP](https://docs.mcp.cloudflare.com/mcp)、[grep.app MCP](https://mcp.grep.app)、[DeepWiki MCP](https://docs.devin.ai/work-with-devin/deepwiki-mcp)**
  - 是什么：公开的只读检索 MCP 服务器，免 key：库与框架文档、Cloudflare 文档、GitHub 公开代码搜索、按仓库问答。
  - 取了什么：经 Claude API 的 [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) 接进首页对话，每个服务器只放行固定的一两个工具。
  - 状态：停用。代码留在 `workers/ai/src/chat/doc-search.ts`，请求不带 `mcp_servers`：挂上它们实测每轮响应头要多等约 2 秒；恢复步骤见 [ai Worker 说明](../workers/ai/README.md)「首页对话」。
- **Claude API 的 [tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)**
  - 是什么：工具定义设 `defer_loading` 后不进初始上下文，模型用 BM25 搜到才加载。
  - 取了什么：首页对话常驻站点工具与 `web_search` / `web_fetch`，领域工具和全部 MCP 工具按需加载，系统提示列出按需工具的类别。
  - 状态：采用。落在 `workers/ai/src/chat/doc-search.ts#TOOL_SEARCH_TOOL` 与 `workers/ai/src/chat/domain-search.ts`。

## 密钥管理

- **[Infisical](https://infisical.com/pricing)**（及其 [Cloudflare Workers 同步](https://infisical.com/docs/integrations/secret-syncs/cloudflare-workers)）
  - 是什么：开源的密钥管理平台，可自建或托管。
  - 状态：不采用。对一个人维护的仓库，收益抵不过多一个持有全部密钥的第三方和整套重灌的成本；套餐与集成能力会变，要重新考虑时按当时的产品现状重评，不沿用旧结论。密钥清单仍以 [ops-facts.md](./ops-facts.md) 为准，灌 Secret 走 [lyjwpage-mac-session](../.claude/skills/lyjwpage-mac-session/SKILL.md)。

## 前端与工具链

- **[TypeScript 7.0 RC 公告](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/)**（Microsoft）与 **[Nx 的 TypeScript 7 指南](https://nx.dev/docs/kb/typescript-7)**
  - 是什么：Go 实现的原生 TypeScript 编译器，以及迁移办法。
  - 取了什么：`tsc` 换成 TypeScript 7；typescript-eslint 还要旧的 JS API，所以按指南两版并装；Worker 的 tsconfig 去掉 7 不再支持的 `baseUrl`。
  - 状态：采用。落在 [`.claude/rules/typescript.md`](../.claude/rules/typescript.md) 的 `typescript` 别名说明与根 `package.json`。
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
- **[Fixing Smooth Scrolling with Find-on-Page](https://css-tricks.com/fixing-smooth-scrolling-with-find-on-page/)**（Chris Coyier，CSS-Tricks）
  - 是什么：把 `scroll-behavior: smooth` 挂在 `html:focus-within` 上，只有页面内有焦点时才平滑，页内查找与加载时的锚点跳转保持瞬时。
  - 取了什么：README 卡片链到 `lyjw.me/#vibe-coding`，加载时的锚点跳转若是平滑动画，要靠渲染帧推进，会被首屏数据撑开的布局带偏，不出帧的内嵌浏览器里停在顶部；这个写法让加载即落准，点过按钮后的程序化滚动仍平滑。
  - 状态：采用。落在 [theme.css](../src/app/styles/theme.css) 的 `html:focus-within`。

## 交互与文案参照

- **ChatGPT 的聊天输出**（[chatgpt.com](https://chatgpt.com)，在 lyjw 的浏览器里实测，没有文章）
  - 是什么：它不在回答里塞 HTML，而是让模型挑组件、用自家设计系统内联画出数字卡、图表、时间线，只有要跑逻辑的部分进隐藏沙箱。
  - 取了什么：首页对话的图示改成站点原生组件，HTML 沙箱只作兜底；预览卡固定尺寸、可重来、可全屏，切换视图不卸载。
  - 状态：采用。落在 [chat-visual.tsx](../src/components/chat-visual.tsx) 与 [chat-html-preview.tsx](../src/components/chat-html-preview.tsx)。
- **[OpenUI](https://github.com/thesysdev/openui)**（Thesys）
  - 是什么：生成式 UI 框架。从组件库定义生成系统提示词，模型写紧凑的 OpenUI Lang，渲染器边流式边容错地画，出错时把结构化错误回给模型。
  - 取了什么：图示的上限与例子只写一处（`shared/god-chat.ts` 的 `GOD_CHAT_VISUAL_LIMITS`、`GOD_CHAT_VISUAL_EXAMPLES`），提示词按它生成每种组件的说明，校验 `checkGodChatVisual` 站点与 Worker 共用；Worker 在回复结束后用同一份校验记下画不出来的图示；结构图从 HTML 兜底改成原生 `diagram` 组件（分层方框加相邻层连线）。规范里「解析器丢掉不合格的部分、其余照画」也采用了：图示里过长的文字截断加省略号、多出的条目截尾、坏条目、坏序列与重复 id 的节点只丢那一项，剩下的撑不起一张图才退回代码（`shared/god-chat.ts` 的 `text`、`list`、`chart`）。
  - 状态：部分采用。落在 [god-chat.ts](../shared/god-chat.ts)、[prompts.ts](../workers/ai/src/chat/prompts.ts)、[reply-fences.ts](../workers/ai/src/chat/reply-fences.ts) 与 [chat-visual.tsx](../src/components/chat-visual.tsx)。不装它的包：要为几种图示多教模型一门语言，省 token 的数据是用 GPT 分词器在大界面上测的；`lang-core` 安装时默认上报遥测。不借客户端 `Query` / `Mutation`（与根 [AGENTS.md](../AGENTS.md)「禁区」的站点侧不写后端相冲）、编辑模式与现成聊天界面（视觉方向与 [DESIGN.md](../DESIGN.md) 不同）。
- **Claude 界面的 thinking 提示**（lyjw 点名参照，没有文章）
  - 是什么：一道高光从左往右扫过的「思考中」标签。
  - 取了什么：对话等待时显示 `THINKING` 扫光，模型流出思考时可展开。
  - 状态：采用。落在 [god-chat.tsx](../src/components/god-chat.tsx)。
- **Apple 中国官网的产品标语**（lyjw 给的截图，没有链接）
  - 是什么：短、笃定、具体的中文标语写法。
  - 取了什么：摘要卡标题写成 3 到 5 个汉字的标语口吻。试过的书法字体被 lyjw 否掉，没有保留。
  - 状态：采用。落在 [compose.ts](../workers/ai/src/digest/compose.ts) 的提示词。
- **[ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/)**（ASD，航空维修手册的受控语言标准）
  - 是什么：一句一事、句子短、主动语态、一个词只表示一件事的写作规范。
  - 取了什么：给 lyjw 的报告只用 STE100 式短句写。只取写法要点，不照搬词表。
  - 状态：采用。落在 [HUMAN.md](../HUMAN.md)「7. Claude 怎么向你汇报」。
- **[Smart Brevity](https://www.axios.com/smart-brevity)**（Axios）
  - 是什么：每段用固定小标题引出、读者只扫加粗字就能决定要不要往下读的写法。
  - 取了什么：试过用「一句话 / 为什么 / 要你定 / 往深看」四个固定小标题写报告，与 STE100 版并排对照，lyjw 选定只留 STE100 版。
  - 状态：不再使用。
- **[How AI assistance impacts the formation of coding skills](https://www.anthropic.com/research/AI-assistance-coding-skills)**（Anthropic Research）、[Retrieval-based learning](https://learninglab.psych.purdue.edu/downloads/2025/2025_Karpicke_Retrieval_Based_Learning_Review.pdf)（Karpicke 综述）、[Eight Ways to Promote Generative Learning](https://link.springer.com/article/10.1007/s10648-015-9348-9)（Fiorella、Mayer）
  - 是什么：Anthropic 的随机对照实验：学新库时把活整个交给 AI 的人掌握得差，边做边问概念、要解释的人掌握得好。两篇学习科学综述讲提取练习和生成式学习（自我解释、讲给别人听、画关系图）最有效。
  - 取了什么：讲 lyjw 不熟的新概念时，接到项目已有的东西上、和相邻概念对比、至多一个先想再看的问题、请 lyjw 用一句话复述再纠正。不扣答案，不为等回答停下工作；不加定期测验。
  - 状态：采用。落在 [HUMAN.md](../HUMAN.md)「7. Claude 怎么向你汇报」与项目记忆 teach-new-concepts。
