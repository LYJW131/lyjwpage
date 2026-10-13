# 参考文献

> 类型：reference

塑造本项目做法的外部来源：文章、演讲、仓库、官方文档。每条写它是什么、我们从中取了什么、落在哪些文件。采用了新的外部做法就在对应主题下追加一条；落地处变了（文件改名、规则删掉、评估结论翻转）同一提交里改这里。只引用、没取任何做法的链接不进来，留在引用它的文档里。

状态：**采用**（已落进仓库）、**部分采用**、**待定**（评估过，站主还没定落哪几条）、**不采用**（评估过，写明为什么，免得反复重评）。

## Agent 编排与定时自动化

- **[Building effective agent automations](https://claude.dev/blog/building-effective-agent-automations/)**（claude.dev）
  - 是什么：Anthropic 写的定时 agent 自动化实践。
  - 取了什么：按书签读、不按时间窗；读不到算失败、不当成没动静；写入明确成功才记账；每次运行重读偏好；最小权限和花费上限。
  - 状态：采用。落在 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「状态与偏好」和每日代码审查定时任务，要点存于项目记忆 [agent-automation-practices](../.claude/memory/agent-automation-practices.md)。
- **[here's how i shipped 2,500 PRs last month](https://x.com/poteto/status/2102050467505430555)**（poteto / Lauren Tan，X 上的演讲视频）
  - 是什么：一个人同时驱动大量 agent 的做法。主线是「先让环境值得信任，并行是信任的结果」。
  - 取了什么：纠错阶梯，即每次纠正 agent 都落到能挡住它的最高一层（代码库 → lint / CI → 规则 → skill → 人工 review）；验证 skill 做成「共用 CLI + 功能地图」；让一个「园丁」专找正在被复制的坏写法，先写 lint 止血。
  - 状态：待定。
  - 相关：她的长文 [Loops You Can Trust](https://x.com/poteto/status/2069824386283319343)、[The Complete Guide to pstack Pt. 1](https://x.com/poteto/status/2094457600259842065)、[Pt. 2](https://x.com/poteto/status/2097732320606507506)。
- **[pstack](https://github.com/cursor/plugins/tree/main/pstack)** 与 **[verification-skill-example](https://github.com/poteto/verification-skill-example)**（poteto）
  - 是什么：上面那套做法的 skill 实现，含协调者 playbook、纠错 skill `correct`、验证 skill 模板。
  - 取了什么：派活简报固定栏目、常驻指令原样贴入；写代码的不判自己的活，验证结论绑 head SHA；验证 skill 分 Launch / Doctor / Drive / Evidence / Cleanup 五节。
  - 状态：待定。
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
  - 是什么：约 30 个通用工程 skill，主线是面谈 → 规格 → 拆票 → TDD → 双轴评审 → 复盘。
  - 取了什么：从 `diagnosing-bugs` 借排查纪律，先造一条能稳定复现症状的命令，再列可证伪的假设；从 `git-guardrails-claude-code` 借禁区做成钩子；`writing-for-agents` 的写法要点先按 Anthropic 最新文档核对，只并入一致的部分。
  - 不借：先问透的 grilling，和本项目偏行动的规矩冲突；规格与拆票依赖 issue 跟踪器，本项目用线程；PR 模板站主不要。
  - 状态：部分采用。

## 模型选择与子代理

- **[What a task costs on Opus 5.5](https://claude.dev/blog/what-a-task-costs-on-opus-5-5/)**（claude.dev）、**[Using Claude Code: Spending your effort](https://claude.dev/blog/spending-your-effort/)**（claude.dev）、**[Subagents](https://code.claude.com/docs/en/sub-agents)**（Claude Code 文档）
  - 是什么：各类任务的成本、effort 档位怎么选、子代理的 `model` / `effort` 字段。
  - 取了什么：搜索、读日志、读长历史这类出错容易发现的活放 Sonnet 或 Haiku，判断和改代码留在主模型；要验证、有边界情况的用 high；子代理看不到对话，关键规则要在简报里重说。
  - 状态：采用。落在 [lyjwpage-verify](../.claude/skills/lyjwpage-verify/SKILL.md)（验证交给 Haiku 验证员）和 [lyjwpage-skill-mining](../.claude/skills/lyjwpage-skill-mining/SKILL.md)「派读者读线程」（Sonnet 读者）。

## 设计系统与 UI

- **[Vercel design.md](https://vercel.com/design.md)** 与博文 **[How our agents build on-brand pages with design.md](https://vercel.com/blog/how-our-agents-build-on-brand-pages-with-design-md)**（Vercel）
  - 是什么：教 agent 做 Vercel 署名报告页的公开 skill，配一套评测循环。
  - 取了什么：只取方法，不取视觉语言。具体是：每个间距只有一个主人；规则冲突时的优先级；同级数值不因内容更长单独缩字号；一组条形共用轨道和比例尺；分开诊断「太多」和「太吵」；能机检的规则交给代码。
  - 状态：采用。落在 [DESIGN.md](../DESIGN.md)、[lyjwpage-ui-design](../.claude/skills/lyjwpage-ui-design/SKILL.md)，以及只减不增的门禁 [design-scale-check.mjs](../scripts/design-scale-check.mjs)（`pnpm design:scale`）。
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
  - 取了什么：品牌和产品图标先查它，按深路径导入 `@lobehub/icons`。
  - 状态：采用。落在 [DESIGN.md](../DESIGN.md)「Components」的图标条目。

## Cloudflare 平台

- **[Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)**（Cloudflare 文档）
  - 是什么：DO 和普通 Worker 怎么分工。
  - 取了什么：依赖旧状态、要与原子更新一起做的计算留在 DO；参数处理、展示计算、第三方请求等放到普通 Worker。
  - 状态：采用。落在 [do-execution-audit.md](./do-execution-audit.md)。
- **[Workers Builds 的 GitHub 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)** 与 **[Preview 的 Service Binding](https://developers.cloudflare.com/workers/previews/resources/#service-bindings)**（Cloudflare 文档）
  - 是什么：Worker 原生 Git 部署，以及分支预览里的绑定行为。
  - 取了什么：Worker 只走 Workers Builds，不在 Actions 里发布；预览的 Service Binding 指向目标 Worker 的生产部署，所以分支上试新后端要走 Worker 分支预览。
  - 状态：采用。落在 [workers-builds.md](./workers-builds.md)。
- **[Durable Object 的 transfer 迁移](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/#transfer-migration)**（Cloudflare 文档）
  - 是什么：把 DO 类从一个 Worker 转到另一个。
  - 取了什么：聊天 DO 迁到 AI Worker 时的有序切换。
  - 状态：采用。落在 [ai-worker-migration.md](./ai-worker-migration.md)。
- **[Workers KV Instant](https://blog.cloudflare.com/workers-kv-instant/)**（Cloudflare 博客）
  - 是什么：KV 的即时一致模式。
  - 状态：不采用。每个命名空间每秒只能写一次、按次计费的写入很贵、也没有事务；`LAG` 的写入量和并发都不合适，实时层仍留在 DO。结论与数据见项目记忆 [kv-instant-evaluation](../.claude/memory/kv-instant-evaluation.md)。

## 前端框架

- **[React Compiler](https://react.dev/learn/react-compiler)**（React 文档）
  - 是什么：编译期自动记忆化。
  - 取了什么：站点构建经 `@vitejs/plugin-react` 的 `reactCompilerPreset` 接入。
  - 状态：采用。落在 [vite.config.ts](../vite.config.ts)。
