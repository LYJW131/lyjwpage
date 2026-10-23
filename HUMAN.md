# HUMAN.md

> 给 lyjw 看的：你和 Claude 在这个项目里怎么分工、怎么说话最省事、什么时候会来找你。给 agent 的硬规则在 [`AGENTS.md`](./AGENTS.md)，这里不重复，只放指针。

## 一眼看完

- 在项目聊天里说一句要什么，Claude 开一个线程去做。进度看线程卡片上的状态行，结果看线程里的回复。
- 你要做的只有四种事：拍板、点头让 Claude 办凭据或给控制台权限、批准生产上的动作、说一句「合」。其余 Claude 自己推进。
- 分叉用决策卡问你，推荐项已标出。你不点，Claude 按推荐项继续；没法撤销的那一步会等你。
- PR 合并按档：文档、skill、参考文献和记忆镜像，本地跑过 `pnpm docs:check` 就合；明确的修复和小改动，本地跑过改动涉及的检查（相关测试、typecheck、eslint）就合，都不等 GitHub CI 排队，CI 之后红了当场修；大改代码逻辑的要 CI 全绿，还要处理完机器评审。大方向、大改动，以及有 UI / UX 变化的改动（你明确要求的小改动除外）等你点头。「明确的修复」只指行为坏了（报错、数据错、崩溃）；显示上和别处不一致不算，Claude 先 `git log -S` 查是不是你有意定的，看不出来就问。
- 碰到 Worker 监视路径的改动合进 main 就自动构建部署；「已部署」以 `/api/version` 返回的提交为准，不以构建检查绿了为准。

## 1. 场面上有谁

- **项目聊天**：你发需求的地方。这里只有一个 Claude 接话，它把每句话派到线程、答项目层面的问题；线程里有决策卡开着时，它会转贴到项目聊天让你直接点。进度不另维护待办列表，你直接看线程列表和各线程的状态行。
- **线程**：一件事一个线程，线程里的 Claude 从头跟到尾。它只在有结果、卡住或要你决定时才回复，平时只刷状态行。
- **你电脑上的会话**（Remote Control）：凡是要用你 Mac 的事，凭据、ssh 到机器、`gh`、你的浏览器登录态，都在这里做。它用完会歇着；线程被标成已解决不等于它离线，随便回一句就能唤醒。Claude 怎么给它派活、被自动模式拦下时要你做什么，见 `.claude/skills/lyjwpage-mac-session/SKILL.md`。
- 这些 Claude 共享一份项目记忆：你定的规矩、做过的决定进去一次，所有线程都遵守。

## 2. 怎么说一句话最快

一条消息一件事，指过去不用描述：PR 或 issue 的链接、线程卡片、截图，加一句要干什么。动词决定做到哪一步：

| 你说 | Claude 做到 |
| --- | --- |
| 「查一下 X」「读这篇」「去调研」「看看行不行」 | 只给结论和建议，不动代码；结论长就给文件或页面 |
| 「X 不对」「这里有问题」加现象 | 当成修复请求：复现、定位、开 PR、盯到 CI 绿，不先问你要不要修（做法见 `.claude/skills/lyjwpage-diagnose/SKILL.md`） |
| 「派一个去做 X，开出 pr 来」 | 实现并开 PR，等你看 |
| 「草稿就行」 | 开草稿 PR 就停 |
| 「派我电脑上的人去…」「用我的浏览器去…」 | 走 Remote Control，在你 Mac 上做 |
| 「起一个 opus 5.5 max 的线程」「派一个 fable max」 | 指定线程的模型和力度；翻文档、翻代码、读长历史这类重活，线程自己派 sonnet / haiku 子代理去干（派法见 `.claude/skills/lyjwpage-delegate/SKILL.md`） |
| 「用动态工作流」「ultracode」 | 多 agent 并行编排 |
| 「处理一下」 | Claude 自己判断该做什么：整理旧线程、决定修还是关 |
| 「现在有哪些等着处理的」 | 一条回复，先列等你的，再列可选的和不用你管的 |

几个让两边都省事的习惯：

- 报 bug 说三样：在哪个页面或卡片、什么宽度、看到了什么；对照「原来怎样」更快，像「vercel 上是登录直接跳转，现在还要点一下」这样就够。截图直接拖进来。
- 语音转文字带口头语没关系，关键名词（端点、卡片名、机器名、PR 号）说准就行；「先 186」这种只给编号的说法 Claude 能接。
- 一个想法分几条短消息发也行，每条都会转到正在做的线程。
- 跟进已有的事，在那个线程里说；在项目聊天里说也会被转过去，并告诉你转到了哪。
- 中途改方向直接说「你这里先停下来，去调查一下 X」，当前线程会改优先级。
- 被理解错了，说「你没懂我意思」加一句原则或例子，不用重写整个需求。
- 想让一件事做得更深而不是更大，派活时贴这段（取自 Felix Rieseberg 的 [How to be more ambitious](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/)）：「我要这件事更深的版本，不是更大的。先别动手：1 这个领域最顶尖的人会多做什么我没要的；2 他们从什么最原始的材料开始，而不是别人消化过的；3 他们用什么具体方法和工具；4 除了你我，什么东西能证明结果是对的。然后按这四点重写我的要求再做。」
- 定规矩用「以后…」开头，比如「以后也注意一下，不只是 ci，还要看 pr 讨论区的机器评审」，会被记进项目记忆，之后所有线程遵守。说错了说一声就删。
- 授权合并不用非得说「合」：「合」「完了直接合」「过了直接合」「推进到合并」，以及你明确让推进的事，Claude 门槛过了就自己合，这件事后续拆出的 PR 也算在内，不再回头问。「行」「同意」「就按这个改」只是同意方案；大方向、大改动和 UI / UX 变化仍等你点头（见第 3 节）。想自己再看一眼，说一句「先别合」。

## 3. 什么 Claude 自己定，什么来问你

**自己定，不问**：可逆的事。开分支、开 PR、本地改动、查询、起开发服务器、注入夹具、改文档、修 CI、回复机器评审、合入 main 解冲突、常规的实现取舍。有影响的假设会在回复里说一句。

**用决策卡问**：分叉会改变你的目标、你会看到的产出，或下一步没法撤销。卡上 2 到 4 个选项，一个标推荐并写理由。点一下就行，不用打字；不点，Claude 按推荐项继续，只有没法撤销的那一步停下来等。同一个问题只问一次，不在回复里再问。卡开在线程里时，项目聊天的 Claude 会把它转贴到项目聊天，你在哪里点都行。

**先做轻的**：同一个要求有轻有重的做法时，Claude 先做最轻的（改提示词、改文案、改一处配置）。要另加检查、拦截名单、定时任务、CI 步骤这类机制，会写明它防什么、什么时候跑、谁看结果，等你点头再做。

**探索与换方向**：这个项目允许试不同的方向。agent 开工便宜，有些做出来的东西本来就不该合。Claude 觉得有更简单的路、和以前的决定冲突、或者这件事不值得做时，尽早在线程里提，不等 PR 做完再在评审里拦。PR 做完发现方向不对，就关掉或改做，不算沉没成本；关的时候在线程里写一句为什么、换成了什么。你在线程里提不同方向也一样，Claude 照这个改，不为已经写好的代码辩护。

**一定等你一句话**：

- 生产上的动作：手动触发 Workers Builds 重建（main 构建因 Cloudflare 临时错误失败、重跑同一提交的，和推送漏触发构建、补跑 main 最新提交的除外）、`wrangler deploy` 的那个唯一例外、切域名、改 ESA 规则（规则见 AGENTS.md「[禁区](./AGENTS.md#禁区)」与「[部署流程](./AGENTS.md#部署流程)」）。
- 删除：远端分支、KV 键、D1 数据、账号里的资源。
- 对外发消息、花钱的东西。
- 控制台与账号设置：Access 策略、GitHub 仓库设置与分支保护、App 权限、告警规则。
- Workers Issues 里的写操作：标 resolved / ignored 在修复部署并验证后才做，改自动化、告警和可观测性设置先问（见 AGENTS.md「[排查线上错误](./AGENTS.md#排查线上错误)」）。
- 合并该等你点头的 PR：大方向、大改动，以及有 UI / UX 变化的改动（你明确要求的小改动除外）；其余 PR 门槛过了 Claude 自己合，见「[5. PR 与合并](#5-pr-与合并)」。

**先不碰的**：iOS App 暂停开发，只当上报器用；除了上报链路，其余一概不管它，也不给它同步新的展示契约（见 [`apps/ios/README.md`](./apps/ios/README.md)）。

**权限提示不是决策卡**：你电脑上的会话跑在自动模式，改分支保护、写 Secret 这类动作会被它拦下，要你在那个线程里回一句「可以」。哪里弹出来就在哪里答。

## 4. 只有你能做的事

- **凭据**：新建或轮换 token，包括控制台里只显示一次的值（Cloudflare Access 的 service token、PSN 的 NPSSO 之类）时，Claude 先问你一次，点明每把钥匙和它的权限范围；你说可以，它就在你 Mac 上的会话里按 `rotate-secret` 技能自己生成、用管道灌进 Secret，值不进对话，核对时只列名字不读值。自动模式拦下写入时，你在那个线程里点一下批准。聊天里不贴凭据，不小心贴了就轮换。
- **设备在手的事**：iPhone 装机、Mac 解锁签名。
- **账号设置与批准**：装 GitHub App、改仓库设置、回答权限提示、点决策卡。

## 5. PR 与合并

- 一个线程一个分支，名字是 `claude/project-thread-<id>`。PR 开出来时给你一次链接，CI 绿、评审处理完后再说一次；中间的合 main、修 CI、回评审不打扰你。
- 合并前的门槛，缺一不可：
  1. CI：大改代码逻辑的要 CI 全绿（lint、typecheck、测试、`pnpm docs:check`，清单见 `scripts/ci-checks.sh#gates`）。文档、skill 与小改动不等 CI，改动涉及的那几项本地跑过就算，合进 main 后 CI 红了当场修；Workers Builds 不看 CI，合进 main 照常部署，挡住坏代码靠的就是这一遍本地检查。CodeQL 只扫访客构建（站点 Build 开）的 PR，两项 `Analyze` 不绿它就停在草稿、合不了；其他 PR 不扫，靠合进 main 后与每天定时扫描兜底，告警由 CodeQL Autofix 各开修复 PR（见 [codeql-autofix](./docs/codeql-autofix.md)）；改动碰到了 Worker 的监视路径时，Workers Builds 也要绿（路径见 workers-builds 的「[构建监视路径](./docs/workers-builds.md#构建监视路径)」，只改文档不触发构建）。
  2. 只有大改代码逻辑的 PR 才等机器评审；UI、文档、skill 和小改动过了第 1 条就合。但凡有 UI / UX 变化的改动，合进 main 前先给你看效果、等你点头；你明确要求的小改动除外。点头用一张决策卡问你，点「OK，合并」就行，要改哪里再打字。要等的 PR，讨论区里每条机器评审（Claude review、Devin、Codex）要么改了，要么回了为什么不改；最后一次推送后再核一遍。Codex 审过之后再推的，只改文档或注释就不等它复审；改了代码的等它最多 15 分钟，没来就照常合，汇报里说一句。Cursor Bugbot 你关掉了，不等它、也不报它没跑；它真跑出来的意见照常处理。
  3. 机器说的不一定对：Claude 自己判断值不值得改并回复理由；安全类的发现等你拍板。
  4. Codex 每个 PR 最多三轮，之后不再请它看。任何一家机器评审到第三轮还在这次改动里报新的阻塞问题，Claude 不再逐条打补丁，先重看方法，用一句话告诉你换不换。修评审发现时同类一次修完。评审代理报什么、不报什么写在 [REVIEW.md](./REVIEW.md)。
  5. Claude 判为大改动、贴了 `needs-judge` 标签的 PR，每次推送由 Verify Action 派一个没写这段代码的判定员判做没做完；小改动不叫判定员，结论按 head SHA 由 bot 记在 PR 评论里，判 FAIL 不合；之后只把 main 合进分支、补丁没变的，结论照旧算数（做法见 `lyjwpage-verify`「3b」与「回执」）。
  6. 三份存量基线（`scripts/mjs-baseline.json`、`scripts/design-scale-baseline.json`、`scripts/ui-copy-baseline.json`）只许比 main 少，PR 里多出一条 CI 就红（`pnpm baselines:check`）。确属合规例外的，Claude 在 PR 里写明理由、停下等你；你同意就给 PR 打上 `baseline-exception` 标签，CI 自动重跑放行；放行只对打标签那一次有效，之后再推送要摘了重打，免得批准后又塞进别的条目。这个标签只由你打，Claude 不打。
  7. main 的分支保护要求 PR 里的行内评审线程都解决了才能合；其余设置的现状见 ops-facts 的「[GitHub](./docs/ops-facts.md#github)」。
- 改了 JS / TS 的 PR 上有一项 `Comment check (Jev)`：Jev 逐条看新增注释，可能该删的列在检查详情里，结论是 neutral，不挡合并；Jev 看过注释时还会在 PR 上发一条评论写结论，之后每次推送原地更新同一条。Claude 自己判断删还是留。
- PR 上的 `tier: docs / ui / logic / ui+logic` 标签由 `lyjw131[bot]` 自动贴，方便你在列表里看档位；门槛每次按改动路径现算，不读这个标签。改了验证员、门槛、合并钩子、这个贴标签的代码，或判定员照读的根 `AGENTS.md`、`REVIEW.md` 的 PR 另贴红色 `verifier-changed`：这种 PR 的回执与判定出自被改过的那份，你定了不堵，只标出来，合并前你看一眼。
- 只为试一下、不打算合的测试 PR，Claude 开的时候就贴上黑色的 `do-not-merge` 标签：`Do Not Merge` 这一项检查一直是红的，`pr-gate` 不放行，合并钩子也拦（`.github/workflows/do-not-merge.yml`）。脚本只认标签，不读标题。你手动贴上也一样拦；真要合，摘掉标签。
- 这些门槛里机器核得了的部分（检查、冲突、该有的 Workers Builds、评审线程、Codex 轮数与 Claude review、Devin 审没审过、回执与判定），Claude 用 `scripts/pr-gate.ts` 一条命令读全，再自己判断；你点没点头它不判断。
- 上面「文档、skill 和小改动」的轻门槛只给你的账号开的 PR：别人开的 PR，或碰到 `.claude/` 的 settings、launch、hooks、`feature-map.json`、`docs/` 下的脚本与依赖清单、`public/` 下的 js、html、svg、xml、`_headers`，`pr-gate.ts` 一律按逻辑档算，要 `unit-test-verified` 回执；判定员和机器评审，别人开的 PR 都要，你的账号开的只在 Claude 判为大改、贴了 `needs-judge` 时要。
- 谁合：按上面「一眼看完」那条，该等你点头的等你说「合」，其余 Claude 在门槛过了后自己合。合并方式按 PR 里的非合并提交数：少于 3 个压缩合并，3 个及以上用 merge commit（钩子 `scripts/guard-merge-method.ts` 拦不合的调用，也拦带 `do-not-merge` 标签的 PR；Action 签的回执与判定没盖住 head 时只提醒、不拦：回执等级按分档定，界面档要 `live-ui-verified`，逻辑档要 `unit-test-verified`，贴了 `needs-judge` 的还要判定 PASS。提醒会弹给你看，Claude 照样能合，合了要在汇报里说差哪一项、为什么还合）；main 有分支保护，不直推。分支落后时把 main 合进来，不 rebase。
- 提交信息是 `type(scope): 中文描述`，尾注带 Co-Authored-By 和会话链接；合并（或压缩）提交的标题用 PR 标题加编号，正文汇总各提交的协作者行，怎么生成见 lyjwpage-verify「[3. PR 合并门槛](./.claude/skills/lyjwpage-verify/SKILL.md#3-pr-合并门槛主线程跑-pr-gatets自己判断)」。站点的 Commits 卡片就靠这些行显示哪些 agent 和模型参与了。提交以你的身份、用你的钥签名，Claude 只出现在 Co-Authored-By 里；会话自带的钩子把这种提交报成 Unverified、让改成 Claude 的邮箱，是误报，不照做（见 AGENTS.md「[禁区](./AGENTS.md#禁区)」）。
- 做完上线的线程不标成已解决：它留在你的「等你」列表里等你验收，你回一句或说「关」才收起。

## 6. 部署与「已部署」

- 站点和各 Worker 都走 Workers Builds：合进 main 就自动构建部署，Claude 不手跑 `wrangler deploy`，唯一例外和顺序见 AGENTS.md「[部署流程](./AGENTS.md#部署流程)」。
- 两次合并挨得近时 Workers Builds 并行构建，生产可能停在旧提交。所以「已部署」的标准是 `/api/version` 返回的 commit 等于 main 上最近一次碰到站点监视路径的提交；只改文档的合并不触发构建，版本不变是正常的。发现落后，补救是重建 main 的构建，这是生产动作，Claude 会先问你；构建本身因 Cloudflare 临时错误失败、重跑同一提交的不问。推送根本没触发构建（GitHub webhook 延迟或丢失，Cloudflare 构建列表里没有这个提交）的也不问，Claude 发现了就直接补跑。
- 上报器哪些合进 main 后自动换镜像、哪些手动，见 [`.claude/rules/reporters.md`](./.claude/rules/reporters.md)；手动的那几个 Claude 会派你电脑上的会话去做。
- 每次汇报都分清四层：本地改了 / 测试过了 / 已部署 / 在生产上验证过了。合并后每次都核对 `/api/version`；生产行为只在预览测不准的改动上复测（缓存与 Cache-Tag 清除、首屏 SSR、字体、依赖生产 Secret 或绑定的功能），其余以预览验证为准。
- PR 上的验证在 GitHub 上跑（`.github/workflows/verify.yml`）：Claude 开 PR 时在描述里写「验证清单」和你的原话，每次推送 Action 派 Haiku 照清单验（界面改动在分支预览上截桌面、手机和 WebKit 图），Claude 判为大改动的同时派 Opus 判定员对照你的原话判做没做到。回执和判定由 github-actions[bot] 贴成 PR 评论，截图嵌在评论里，你看图点头就在那儿看；合并前 `scripts/verify-receipt.ts` 只认这个 bot 贴的，Claude 自己贴的不算。Claude 不重跑回执里验过的，只抽查一条证据（看一张截图或核一个数）再汇报。没开 PR 时的检查、等部署和核对生产，Claude 仍交给 Haiku 子代理（见 `.claude/skills/lyjwpage-verify/SKILL.md`）。
- 所有等待（CI、机器评审、部署、后台循环）都有上限，到点记失败、附上最后看到的状态，接着做不依赖它的事，不会无声卡住（见 `lyjwpage-verify`「等待要有上限」）。

## 7. Claude 怎么向你汇报

- 线程卡片的状态行是进度，不通知你；回复才通知。回复只在三种时候来：有结果、卡住了、要你决定。开头先说要你做什么，没有就说不用你动。
- 你离开超过半小时后，回复会更短，先说需要你做什么。
- 给你看的时间一律写新加坡时间（UTC+8），不写 UTC，你不用自己换算。
- 在文档、PR、记忆、skill、报告与汇报文档（晨报、定时任务的报告等）和给其他 Claude 的简报里第三人称提到你时，一律写 lyjw，不写站主、owner、用户、他或真名；跟你当面说话仍称「你」。
- 项目聊天里 Claude 只说一行，细节都在线程里，链接点过去。
- 超过十几行的东西给文件、页面或 Artifact，不刷屏。
- 给你看的报告（调研、对比、技术报告）发成 Artifact，不发 .md；只出一版，用 STE100 式短句（一句一事、主动句、一个词只指一件事），文字压低、不抢眼。
- 要你拍板、又不止一步的计划发成一页交互式计划书（原版 html-plan 插件）：折叠着读就是摘要，带编号的决定是要你定的事，选完按 Respond，把答复复制贴回线程（见 [lyjwpage-html-plan](./.claude/skills/lyjwpage-html-plan/SKILL.md)）。
- 说错了改口用删除线加 [Edit: …]，不悄悄覆盖。
- 站点的视觉与交互规范在 [DESIGN.md](./DESIGN.md)：间距、字号、颜色、卡片结构都按它来；觉得哪里不舒服，指出来，Claude 改规范或改卡片。
- 细微的 UI 改动（间距、对齐、大小、颜色）给前后叠在一起的对比图，或带量尺参考线和 px 标注的并排图；整块重做的不用。
- UI 改动第一次交付附桌面和 375px 两张图，375px 另附一张 WebKit（iPhone 的引擎）截的；云端线程里你看不到开发服务器，每一轮都附图；你在看开发服务器时，改完自测但不再截图（见 lyjwpage-verify「[2. UI 浏览器端到端](./.claude/skills/lyjwpage-verify/SKILL.md#2-ui-浏览器端到端)」）。
- 云端线程里等你审的 PR，site 分支预览部署到最近一次改了代码的提交后（只改文档的提交不重建预览），Claude 再发一条带预览地址（`<预览名>.preview.lyjw.dev`）的消息叫你，让你能亲手点。
- 每条结论都带证据：链接、文件与符号、命令输出，或者明说是推断。
- 要你点头的汇报附一行「这些检查测不到什么」；Claude 说不出来，就先补验再找你。
- 讲你不熟的新概念时，Claude 会让你多想一步：接到项目里你见过的东西上讲，和相邻概念对比，至多在关键点前问一个问题（答案就在下面），最后请你用一句话复述，它只纠正差的那一处。答案不扣着，活也不停下来等你回答。
- 你的要求有不止一种读法时，第一条回复先用一两句复述 Claude 理解的目标，同时接着做；读偏了回一句就能纠正。

## 8. 定时任务与自动化

- 每天一次的代码审查定时任务：从上次游标起对 main 的改动跑 /code-review 和 /simplify，有值得改的就开 `chore(review):` PR，检查和机器评审都处理完后自动合并。时间、游标位置和它的边界见 ops-facts 的「[Claude Code 云端 routine](./docs/ops-facts.md#claude-code-云端-routine)」。
- 每天一次的提炼 skill 与偏差复盘定时任务：从上次书签起读各线程，把反复出现的流程和你反复纠正的做法写成或改进 `.claude/skills/` 下的 skill；再对照每件做完的事你第一次怎么说、最后交付了什么，找出弯路，改 Claude 的默认做法（`AGENTS.md`「工作方式」、`HUMAN.md`、项目记忆）或让它在该问的地方早点问；还读新合并 PR 里被采纳的 Codex / Devin 建议，同类在两个以上 PR 出现的做成 lint、`rules:check` 或钩子（另开 `chore(checks):` PR），判定不了的写进 skill。开 `docs(skills):` 小 PR，本地 `pnpm docs:check` 过了就合；动禁区、合并门槛或放松审批的改动只提议、等你一句话。磨合期里它每跑一次都在自己的线程汇报并问你反应，回「有用 / 没用 / 写偏了」或只回编号都行，它据此改 skill 和它自己；说「磨合结束」就不再每次汇报。流程见 `.claude/skills/lyjwpage-skill-mining/SKILL.md`。
- 每天 08:41（新加坡时间）的 Anthropic 官方动态定时任务：按书签拉 Anthropic 官方博客、文档、release notes、Claude Code 与 SDK 更新日志，几个官方账号、Anthropic 工程师和前沿作者（如 poteto、Matt Pocock）的 X，以及 Simon Willison、Latent Space、Cloudflare changelog、Hacker News 热帖的新内容，逐条判断能否吸收进本站，写进共享目录 `anthropic-updates/<日期>.md`，晨报读它转告你。它自己不发言、不开 PR；想吸收哪条，晨报后说一句，另开线程按上面的合并门槛做。流程见 `.claude/skills/lyjwpage-anthropic-updates/SKILL.md`。
- 每天 4 次（新加坡时间 01:53、07:53、13:53、19:53）的 collector 盯防定时任务：一个只盯采集 Worker 的 Claude，读站点公开状态端点和 collector 的 Cloudflare 日志，找时间戳在走、内容却不对的细微异常（部分成功沿用旧值、数据冻住、任务悄悄跳过），顺带把其他 Worker 新出现的错误分诊、两次复现后归成批，写进共享目录 `superfan-collector/<日期>.md` 供晨报读取；复现了的批次它直接开修复草稿 PR（每次最多一个；碰 UI、契约或生产数据的仍由你在晨报后决定要不要开线程修），你关掉 PR 就是否决，说合才按第 5 节门槛合；新出现的要紧异常才在「Anthropic 官方动态日更 + collector 盯防」线程里说一声。流程见 `.claude/skills/lyjwpage-collector-superfan/SKILL.md`。
- 每天 03:15（新加坡时间）的记忆镜像同步定时任务：把项目记忆目录传给 `pnpm memory:mirror`，同步进仓库的 `.claude/memory/`（用法见 [`.claude/memory/README.md`](./.claude/memory/README.md)），有变化就开 `docs(memory):` PR，本地 `pnpm docs:check` 过了就合，没变化不出声。配置见 ops-facts 的「[Claude Code 云端 routine](./docs/ops-facts.md#claude-code-云端-routine)」。
- 每天 10:56（新加坡时间）的晨报定时任务：在「晨报 · 定时任务」线程里发一条，汇总上面几个定时任务的结果，列出要你做的事、隔夜合并的 PR、失败或没读到的任务和能吸收的 Anthropic 动态；一天只发这一次，之后不更新。它只读，不开 PR、不在项目聊天发言。配置见 ops-facts 的「[Claude Code 云端 routine](./docs/ops-facts.md#claude-code-云端-routine)」。
- 所有自动化都遵守：按游标不按时间窗；读不到就报失败，不当作没事；动手前再核一次线上状态；写操作确认成功才记账；最小权限和花费上限。
- 想加、改、停一个定时任务，在项目聊天说一句就行。

## 9. 项目记忆

- 进记忆的：你定的工作方式、做过的决定、仓库外事实的指针。
- 不进记忆的：仓库里已经写着的东西、单次对话的细节、任何凭据。
- 记忆写错了，说一声就改或删。
- 仓库里有一份镜像 [`.claude/memory/`](./.claude/memory/MEMORY.md)，内容同项目记忆、去掉了凭据和私有链接，方便你直接翻看或在 GitHub 上看改动历史。Claude 改了项目记忆，会在同一轮开个小 PR 把镜像改齐，本地 `pnpm docs:check` 过了就合。

## 10. 你会在什么时候被打断

- 决策卡、权限提示，和「只有你能做的事」那一节里的事。
- 线程卡住（失败、丢了工作、等权限）时，项目聊天里会有一行告诉你卡在哪。
- 不会打扰你的：进度推进、修 CI、回机器评审、合入 main、重跑预览构建，以及因 Cloudflare 临时错误失败的 main 构建。
