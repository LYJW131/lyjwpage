# 术语表

lyjw 和 Claude 在线程、PR、文档里共用的词。每条一句话说是什么，再给出处；细节以出处为准，这里不抄。

## 站点与数据

| 词 | 是什么 | 出处 |
| --- | --- | --- |
| 首屏 | 首页随 HTML 一起直出的那份状态快照，先于浏览器拉 API 显示；按视图缓存，什么时候主动失效见出处 | `docs/state-storage.md`「首屏与浏览器」 |
| 卡 / 卡片 | 首页上一块状态，如充电宝卡、在听卡、agent 状态卡 | `DESIGN.md` |
| Pulse | 首页按时间铺开的活动图 | `src/components/live/pulse-card.tsx` |
| 泳道 | Pulse 里的一行，按领域分：Coding、Tokens、Listening 等 | `src/components/live/pulse-card.tsx#LANES` |
| 可滞后视图 | 允许落后一会儿的状态视图，站点直接读 `LAG` KV，不经 core | `shared/lag-views.ts#LAG_VIEW_LOADERS` |
| 实时状态 | 归 core Worker 的状态，经 Service Binding 读 | 根 `AGENTS.md`「禁区」 |
| 上报器 | 跑在 lyjw 自家机器上、往 `/api/ingest/<来源>` 推数据的程序 | `reporters/` |
| 来源 | 上报入口按数据归属命名的那一段，不按上报程序命名 | `shared/ingest/prepare.ts#INGEST_SOURCES` |
| 别处播放 | 不在 Mac / HomePod 上、由 Apple「最近播放」推断出来的在听 | `shared/pulse-listening.ts#playingElsewhere` |
| 近况卡标语 | 近况卡标题，只从固定的中文标语池里挑 | `workers/ai/src/digest/taglines.ts#DIGEST_TAGLINES` |

## 首页对话

| 词 | 是什么 | 出处 |
| --- | --- | --- |
| 杂鱼 / 先知 / 神 | 对话的三档人设（Small Fry / Prophet / God），各对应一个模型 | `shared/god-chat-tiers.ts#GOD_CHAT_TIER_INFO` |
| Clef | 先给访客消息分档、拦掉垃圾的小模型 | `workers/ai/src/chat/router.ts` |
| 升档 | 杂鱼答不了时调 `request_upgrade`，同一条回复交给先知 | `workers/ai/src/chat/handler.ts` |
| 设计会话 | 访客想改站点时开的 Managed Agents 会话 | `workers/ai/README.md` |
| 规划者 | 设计会话里只读仓库、出计划的那个 agent | `workers/ai/src/chat/design.ts#PLANNER_PROMPT` |
| 构建 | 访客确认计划后由 GitHub Actions 跑的改站流程 | `docs/build-routine.md` |

## 协作与流程

| 词 | 是什么 | 出处 |
| --- | --- | --- |
| 晨报 | 项目聊天每天早上的汇报，列出要 lyjw 决定的事 | `HUMAN.md`「8. 定时任务与自动化」 |
| 盯防 | 专盯 collector Worker 的定时任务，也叫 superfan | `.claude/skills/lyjwpage-collector-superfan/SKILL.md` |
| Anthropic 动态 | 每天拉官方与前沿作者更新、判断能否吸收的定时任务 | `.claude/skills/lyjwpage-anthropic-updates/SKILL.md` |
| 每日审查 | 每天对 main 新改动跑 /code-review 与 /simplify 的定时任务 | `docs/ops-facts.md`「Claude Code 云端 routine」 |
| 园丁 | 每日审查里专找正在被复制的坏写法的一步，发现记进缓冲 issue | `docs/references.md` |
| 提炼 skill | 从线程里提炼流程、复盘需求偏差的定时任务 | `.claude/skills/lyjwpage-skill-mining/SKILL.md` |
| 验证员 / 回执 | 派去跑检查的 Haiku，和它签的检查结果表 | `.claude/skills/lyjwpage-verify/SKILL.md` |
| 机器评审 | PR 上 Claude、Devin、Codex 的自动评审 | `HUMAN.md`「5. PR 与合并」 |
| 门禁 | CI 必须通过的检查清单 | `.github/workflows/ci.yml` |
| 基线 | 存量违规的清单，只许减不许增 | 根 `AGENTS.md`「规则 → 由什么强制」 |
| 夹具 / 场景 | 注入假数据看此刻没发生的状态；场景是一整份互相对得上的快照 | `workers/core/README.md`「本地开发」 |
| 分支预览 | 非生产分支改到监视路径时，Workers Builds 自动部署的预览站点 | `docs/workers-builds.md`「分支预览」 |
| 讲解片 | `/explainer` 上的讲解动画 | `docs/explainer/README.md` |
