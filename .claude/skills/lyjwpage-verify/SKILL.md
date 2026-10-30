---
name: lyjwpage-verify
description: lyjwpage 里任何验证步骤都用它：改完后的本地门禁、UI 浏览器端到端与截图、PR 上的验证清单与 Verify Action、PR 合并门槛、合并后的部署与生产核对；PR 上的回执与判定由 GitHub Action 签，其余检查交给 Haiku 5.5 high 验证员。
---

# lyjwpage 验证

用在 lyjwpage 仓库里任何「验证」步骤：改完代码后的本地检查、UI 的浏览器端到端与截图、PR 合并前的门槛核对、合并后的部署与生产核对。

分工：**主线程决定验什么、判断结果；Haiku 验证员只执行检查、交回证据。** 验证员跑命令、开浏览器、轮询部署、读 PR 评审，这些输出很长但不需要判断力，交给它能省下主线程的上下文和费用。PR 上的验证与判定在 GitHub Action 里跑（见「PR 上的验证：Verify Action」），回执只认 Action 发的；下面的「派法」用在还没开 PR 的检查、给 lyjw 看的过程截图和合并后的核对。

## 什么时候派验证员，什么时候自己跑

- PR 上：不派。开 PR 时在描述里写验证清单和 lyjw 原话，Verify Action 自动验、签回执、判定（下一节）。主线程推送前照样跑改动涉及的本地门禁。
- 没开 PR 时派：多步检查（typecheck + 测试 + eslint + build）、任何浏览器端到端或截图、等部署并核对生产。
- 自己跑：只有一条命令且输出很短（一次 `curl /api/version`、一个单测文件），以及合并门槛汇总（`scripts/pr-gate.ts`，见第 3 节）。写简报比自己跑还贵。
- 验证员不做判断类工作：不判断机器评审意见值不值得改，不分析失败根因，不决定合并或重跑构建。

## PR 上的验证：Verify Action

`.github/workflows/verify.yml` 在 PR 打开、推送、转为待审、改了描述或目标分支时跑（草稿不跑，同一 PR 的新运行顶掉旧的）。没有手动触发：手动触发跑在默认分支的缓存作用域里，PR 代码能写脏所有 PR 共读的缓存；要补跑就重跑这个 PR 已有的那次运行（`gh run rerun <run-id>`）。脚本是 `scripts/verify-action.ts`（`--help` 看子命令）。

- `plan`：按 `pr-gate` 的分档（`scripts/verify-receipt/notes-only.ts#prTier`）定回执至少的等级；只改文档与 skill 的不验。PR 贴着 `skip-verify` 标签时整个不跑，验证员和判定员都不派，摘掉标签就照常验一次；lyjw 定给改立绘这类和站点 UI 关系不大的 PR 用，合并前由线程自己手动验，这时没有回执，`pr-gate` 的回执提醒照常出、不挡合并。
- `verify`：Haiku（effort high）当验证员，工作方法就是本文件的「检查清单」与「回执」。界面档先等站点分支预览部署到 head（上限 20 分钟），在 `<预览名>.preview.lyjw.dev` 上验；预览没就绪就在 runner 里起 `pnpm dev`。令牌只读，不能评论、不能推送。原始结果另存一份小产物 `verify-ab-cc`，留给下一条的 A/B 对照。
- `verify-pi`：A/B 对照的 B 组，同样的准备步骤和提示词交给 pi 验证员，结果只进产物：`verify-ab-pi` 是读数用的 result.json、usage.json 与结论，`verify-out-pi` 是含 transcript 的全量，不发回执，`publish` 不等它；自身出错只标出来：pr-gate 不把它算进 pending 与 failing（`scripts/pr-gate/checks.ts#ADVISORY_CHECKS`），没跑成或还在跑记进 notes 提醒；步骤都 `continue-on-error` 好让产物照样上传，最后一步在 pi 没交结果时让 job 红。读数：下载两组的 `verify-ab-*`，同一 head 上两组按 `scripts/verify-action/report.ts#reconcile` 各算一次等级，逐项比结论，分歧的人工裁定。pi 验证员仍是 Haiku（thinking high），用 pi 的 SDK 自搭的 runner（`scripts/verify-agent.ts`，装在 `.github/actions/verify-agent`）走 Anthropic API（Secret `ANTHROPIC_API_KEY`）：工具是只读的 read / grep / find / ls（只许读工作区、产物目录、临时目录、pi 的 SDK 目录与 runner 自带的 skill 目录）、bash、只许写产物目录的 write，加上 `pr_diff`、`run_tests`、`pr_view`，以及 `claims`（声明台账）、`compare_base`（同一命令在目标分支与 HEAD 上对照）、`docs_sync`（改了的说法在文档与 `.claude/` 里有没有跟着改），结果经 `submit_report` 按 schema 交、交上来不再复核（等级由回执按行重算）；判定做法写在 `scripts/verify-agent/playbook.ts#PLAYBOOK`，探针写法是按需加载的 skill `scripts/verify-agent/skills/verify-probes`；装 runner 的 action 由 verify-pi 在用之前从默认分支另检出到 `.verify-agent-main/`，runner 再由它从工作区的 `origin/<默认分支>` 取（同一 job 里先跑过的 PR 代码仍能改这个引用和预先下好的 action，单个 job 内堵不死），钥匙经文件传、读完即删，bash 子进程和 runner 自己调的 git（bash 能写 `.git/config`）都去掉令牌与密钥、Linux 上进 bwrap 的 PID 命名空间；读写守卫按解开符号链接后的真实路径判。
- `verify` 里脚本能跑的不交给 Haiku：Haiku 之前先跑撤回证明（上面「1. 本地门禁」那段），之后读 head 上 CI `check` 的结论（最多等 5 分钟，不等 CI 才启动），两项写进回执的「脚本：」一行（`scripts/verify-action/machine.ts#machineLine`），不影响回执等级。
- `judge`：PR 贴了 `needs-judge` 标签（或作者不是 lyjw 的账号）时同时派 Opus（effort high）当判定员，和验证员并行，见「3b」。
- `publish`：截图推到孤立分支 `verify-shots`、折叠进评论的「截图」（至多 `MAX_SHOTS` 张，验证员只把能看出改动对不对的放进 shots/）；按清单对照验证员的结果定回执等级（`scripts/verify-action/report.ts#reconcile`：清单某项 FAIL 记 `verifier-failed`；漏项、SKIPPED、没有检查行、PASS 没写证据、`live-ui-verified` 没有截图都记 `verifier-blocked`）；判定按明细收口（`judgeVerdict`：没列要求、有没做到或没写依据的要求、有回归或待修项，都签 FAIL）。再以 lyjw131[bot] 发回执与判定两条评论（publish job 拿 App 令牌，只跑默认分支上的脚本，PR 改的 publish 逻辑合进 main 后才生效）。PR 的 head 已经变了就什么都不发；验证员或判定员读过之后描述或目标分支又改了，或 job 成功却没交回读到的版本，那一条不发（`scripts/verify-action.ts#staleRead`；改描述或目标分支触发的新运行会重做）。

开 PR 时（以及要求变了时）在描述里写这两节，标题照抄，格式由 `scripts/verify-action/body.ts#parseBody` 解析：

```
## 验证清单
- V1：<在哪看、做什么>，预期 <可测量的结果：哪个元素在哪个元素上方、对齐差几 px 以内、某段文字出现在 SSR HTML 里、哪条测试绿>
- V2：……

## lyjw 原话
> <线程根消息和后来补的要求，原文照贴>
```

- 你判断是大改动时，开 PR 前先照 [lyjwpage-pr-review](../lyjwpage-pr-review/SKILL.md) 让自家评审员审一遍、逐条答复，开 PR 后给它贴 `needs-judge` 标签（`scripts/pr-gate/tier.ts#JUDGE_LABEL`）：Action 派 Opus 判定员、Claude review 审一次，合并要等判定 PASS 与机器评审。小改动不贴（lyjw 定的：要不要叫 Opus 由线程判断）。脚本只看标签，不读描述里的文字。

- 清单写成验证员不看对话也能照做的样子：页面或命令、宽度与主题、预期数值。内容同「派法」简报模板的第 2、3 栏。
- 清单只写要读代码、开页面或下判断的项：某个行为成立、某段文字与代码一致、某个副作用不存在。CI 的 `check` 会跑的（eslint、typecheck、`docs:check`、`rules:check`、全量单测）不写进清单；覆盖改动行为的单测至多写一项，让验证员拿它定 `unit-test-verified`。
- 验证员在清单之外还会按 diff 补查（行 id 用 X1、X2……），但清单漏掉的你想看的行为，它不一定想得到。
- 描述里的 HTML 注释照样算：注释里的条目也会被验，同名标题都收、同编号条目接在一起（`scripts/verify-action/body.ts#parseBody`）。旧清单直接删，不要注释掉留着。
- 没写清单时验证员按 diff 自己挑检查，回执评论里会注明；没写原话时判定员按 PR 描述推断，并在第一条写明。
- 回执和判定只对签发时的清单与原话算数（没写原话时按描述全文；摘要记在评论里机器读的 `verify-stamp` JSON 行）：之后改了，旧的作废，等 Action 按新描述重跑；只改标题不重跑。
- 验证员与判定员读的 `.claude/`、`CLAUDE.md` 是 main 上的（claude-code-action 对 PR 一律换回 base 的，B 组的 pi 验证员由 `.github/actions/verify-agent` 换回默认分支的），PR 里改的 skill 合并后才生效；`AGENTS.md`、`REVIEW.md` 不换，读的是 PR 里的。
- 回执是 `verifier-blocked` / `verifier-failed` 或等级不够：看评论里的证据与「没验到」，修代码或补清单后推送（改描述也会重跑）。环境问题（预览没部署、Action 自己出错）在 Actions 页重跑那一次。
- Action 验不到的（只有 `dev:scene` 夹具才有的状态、真机行为），写进 PR 描述交给 lyjw；不在线程里自签回执顶替，自签的不算数。

## 等待要有上限

PR 检查、机器评审、Workers Builds、`/api/version`、后台 `until` 循环，每一种等待都带上限。到点还没等到就记 FAIL「超时」，附上最后一次看到的状态，然后接着做不依赖它的下一步，不原地干等。理由：等的条件可能永远不会成立，比如 SHA 拼错、运行被取消或被新提交顶掉、评审没触发，没有上限的循环会让线程无声卡住。

- 手写的循环用 `timeout <秒>` 或计数上限包住，PR 检查和机器评审各给 15 分钟。部署核对不手写循环，由 `scripts/deploy-check.ts` 的 `--timeout` 管上限（默认值以脚本 `--help` 为准），构建确实慢时调大这个参数。
- 等的对象要写对：SHA 用 `git rev-parse` 取完整值；PR 的检查用 `gh pr checks <PR 号>`，不按提交号查 `gh run list`，因为 PR 的运行可能挂在合成的合并提交上。刚推送后查不到运行是正常的，在同一个上限内继续重试，到点仍查不到就记「超时：没有出现运行」。`cancelled`、被更新提交顶掉（`superseded`）都算终态，不再等。

## 派法

```
Agent(
  description: "Haiku verifies <对象>",
  subagent_type: "general-purpose",
  model: "haiku",          // 当前一代 Haiku（Haiku 5.5）
  effort: "high",          // lyjw 指定的档位
  run_in_background: true, // 主线程可以继续干别的；下一步依赖结果时才用 false
  prompt: <下面的简报>
)
```

简报模板（每条都要写，验证员看不到对话上下文）：

1. **身份与禁区**：「你只执行检查、汇报证据。不改仓库文件、不提交、不推送、不合并、不在 GitHub 上评论或解决讨论、不改 Cloudflare 任何设置、不触发构建、不调用任何 `mcp__hearthbot__` 工具。检查失败就带证据报告，不要去修。」
2. **改了什么**：PR 号、分支或合并提交 sha、改动的文件、用户能看到的预期行为（写成可测量的：哪个元素在哪个元素上方、左边对齐差多少 px 以内、字号与颜色、某段文字出现在 SSR HTML 里）。验证期间主线程不往被验分支推新提交；要对比线上前后状态的，写明对比期间不能有部署，并点名被比较的是哪几个 Worker，让验证员开头和结尾各记一次它们的版本：site 看 `/api/version`，core、collector 等后端看该 Worker 在 Workers Builds 的最新部署；两次不同或查不到就报 `verifier-blocked`。
3. **按顺序要跑的检查**：从下面「检查清单」里挑与改动相关的，写成具体命令、URL、宽度、夹具名。
4. **产物位置**：截图存 `/mnt/project-files/<主题>/`（先 `mkdir -p`），脚本放会话 scratchpad 目录。
5. **汇报格式**：第一行写自己的模型 ID；然后一张表「检查 | PASS / FAIL / SKIPPED | 证据」（命令与退出码、输出末几行、sha、px 数值、文件路径、报错原文）；再列「没验到的及原因」；最后照下文「回执」的格式签一张回执。要求「不要往好里说，不确定就给原始数值」。

## 检查清单

### 1. 本地门禁（按改动类型挑，命令以各目录 `package.json` 为准）

| 改动 | 检查 |
| --- | --- |
| 纯文档 | `pnpm docs:check` |
| 只改注释 | `pnpm docs:comment-only`，输出里不能有「除注释外有改动」「指令性注释有改动」 |
| 逻辑 | 相关单测：`node --test --experimental-strip-types --import ./src/lib/testing/register-alias.mjs <文件>`；全量 `pnpm test` |
| 类型或接口 | `pnpm typecheck`（全仓 `pnpm -r --include-workspace-root typecheck`） |
| 任何代码 | `pnpm exec eslint <改动文件>` |
| 构建、路由、缓存 | `pnpm build` |
| 站点类名（`src/`） | `pnpm design:scale` |
| `workers/*`、`reporters/*` | 该目录 `AGENTS.md` / `README.md` 里写的验证命令 |
| 脚本 | `node --test scripts/<名>.test.mjs`；已迁到 TS 的脚本换成 `scripts/<名>.test.ts` |

修 bug 并补了回归测试的改动，要另做一次「撤回证明」。PR 上由 Verify Action 在验证员之前用脚本跑（改了 `scripts/`、`src/`、`shared/`、`workers/*/` 下的测试又改了别的文件时，`scripts/verify-action/machine.ts#proofPlan`），验证员不重跑、只引用；没开 PR 时验证员自己跑：提交后跑 `node scripts/revert-proof.ts --test <新测试文件>`（可给多个 `--test`；工作区测试命令不同的加 `--cmd`；测试离不开的辅助文件用 `--keep` 保留）。它在临时克隆（`git clone --shared`，不写 .git，只读的检出里也能跑）里把改动过的非测试文件换回 main，跑新测试，要求以断言失败报红（编译或导入出错、零个测试都不算）；再换回 HEAD 跑同一测试须绿，当前工作区不动。`verdict` 为 `proved` 才算证明成立；把它的命令、`verdict` 与 `red.tail` 末几行写进证据，并核对红的那次失败说的是那个 bug 的行为。`not-red`（测试没抓住 bug，或修复落在 `addedKept` 列的新文件里）和 `red-not-assertion` 写进「没验到」并说明原因，由主线程判断。

提交前的两项自查，跟本地门禁一起跑（派验证员的写进简报，主线程自己跑的照样跑），只报命中、不判（Codex、Devin 最常抓的就是这两类，规则在根 `AGENTS.md`「文档与注释」）：

- 同步自查：主线程列出这次改动里的规则关键词、符号、常量名，改说法的连旧说法一起列。在仓库根跑 `rg -n --hidden --glob '*.md' --glob '!.git' -e '<词 1>' -e '<词 2>' .`（整库的 md，`apps/`、子目录 README 都在内），列出仍写着旧说法、或该跟着改却没提的位置。动了仓库外配置（控制台、定时任务提示词、Access 策略）的，另查 `docs/ops-facts.md` 有没有对应条目和核对戳。
- 新增注释：`git diff -U0 "$(git merge-base origin/main HEAD)" -- '*.ts' '*.tsx' '*.mjs' '*.js' | rg '^\+.*(//|/\*)|^\+\s*\*'`，Python 与 shell 另跑 `git diff -U0 "$(git merge-base origin/main HEAD)" -- '*.py' '*.sh' | rg -e '^\+.*#' -e '^\+.*"""' -e "^\+.*'''"`（行尾的 `#` 和文档字符串都算，字符串里的 `#` 会误报，由主线程判；skill 目录里的脚本也在内）（比到工作区，已提交和没提交的都在；没跟踪的新文件先 `git add -N <文件>`），逐条列出，标出含数字、数量词或调用方名字的。

主线程逐条判，过期的同一提交改掉。

CI 的完整门禁是 `scripts/ci-checks.sh` 里的 `gates`。本地跑它要先设 `RUNNER_TEMP`（指到 scratchpad 里的目录），否则报 `RUNNER_TEMP: unbound variable`、一项门禁都没跑。

### 2. UI 浏览器端到端

浏览器取证先调共用脚本 `scripts/site-verify.ts`（`--help` 看全部选项，输出 JSON，失败时 `next` 字段写下一步），不现写 Playwright 片段。每张卡的端点、可用夹具、选择器与「什么状态证明它对」在同目录 [`feature-map.json`](./feature-map.json)。

`cards` 只检查三件事：卡片在、可见、无控制台错误与同源失败请求（环境噪声除外）。`feature-map.json` 的 `proves` 写的是「这张卡对了长什么样」的目标描述——里面的内容、数值、布局条件 `cards` 不查，由验证员用 `shot` 截图和 `page.evaluate` 量值自己取证。

```bash
node scripts/site-verify.ts doctor --url http://localhost:3211        # 先体检：站点可达、playwright、Chrome、夹具开关
node scripts/site-verify.ts cards --url http://localhost:3211         # 逐卡检查存在与可见 + 控制台错误
node scripts/site-verify.ts shot --url http://localhost:3211 --widths 1280,375 --out /tmp/shots  # 两宽度整页截图
node scripts/site-verify.ts shot --url http://localhost:3211 --widths 375 --engine webkit --out /tmp/shots  # iPhone 引擎再截一张
node scripts/site-verify.ts shot --url http://localhost:3211 --card pulse --theme both --out /tmp/shots  # 单卡明暗 clip
node scripts/site-verify.ts readme-cards --url <预览地址>              # README 卡写死的卡高与内容实高对不对得上
```

- 起服务：`pnpm dev`（3211，连生产 Worker）。要注入此刻没发生的状态：`pnpm dev:worker` + `pnpm dev:local`，再 `node scripts/site-verify.ts override --endpoint <端点> --fixture <夹具> --dry-run`，确认命令后去掉 `--dry-run` 执行（夹具名从 feature-map.json 的 `endpoints` 里挑；收尾 `--clear` / `--off`）。云端会话由 SessionStart 钩子生成 `.dev.vars`，无 Cloudflare 凭据也能起本地 Worker 栈。
- 首屏（SSR）要渲染指定数据：`pnpm dev:local` 的 SSR 与浏览器读同一个本地 Worker，注入同时管两边，不用再起 node 代理。截图、前后对比、要多张卡互相对得上（摘要数字与 Pulse 表盘、明暗两张）时用场景一次注入整份快照：`pnpm dev:scene <场景>`（写法与 `--capture`、`--age` 见 `workers/core/README.md`「本地开发」）。前后对比先 `--capture` 一次，修复前后的本地构建各注入同一场景，不拿漂着的生产数据当基线。只改浏览器请求用 Playwright `context.route`；只看 SSR 长什么样用 `shot --ssr`，看文字用 `curl -sS <url>`。
- 宽度：至少 1280 桌面与 375 手机，375 另用 `--engine webkit` 截一张（iPhone 的引擎；只在 WebKit 上出的显示问题 Chromium 截不到）；改到布局行数或网格时加 iPad（`--widths 1280,820,1024,375`）；有深色样式的改动加 `--theme dark`（或 `both`）。
- 改到 canvas、WebGL 或按窗口宽度挂载的动画时，页面开着用 `page.setViewportSize` 把宽度拉过它的断点再拉回，截图确认画面还在、按新尺寸重画；有无 WebGL 的回退路径的，再用 `--disable-webgl` 启动的 Chromium 把触发和调宽再走一遍。
- 控制台里 `WebSocket connection to 'wss://…/ws…' failed … 426` 是容器代理造成的环境噪声，脚本单列为 `envNoise`，不算站点错误。页面常开 WebSocket、在轮询，没有 networkidle：脚本按 `--settle` 毫秒等待（默认 4000），别自己写 networkidle。
- 脚本量不到的量化预期才自己补 `page.evaluate`：改到同一排里的卡片或替换卡片里的部件时，量改动前后同排各卡的高度、改动处与相邻同类文字的 `font-size` / `font-weight`，在报告里给出前后数值；lyjw 一眼就能看出差几像素。量间距、字号、点击区还有 `node .claude/skills/lyjwpage-ui-design/ui-audit.mjs`。
- 做 UI 浏览器验证时顺手对分支预览跑一次 `readme-cards`：README 卡的高度写死在路由里，卡里的组件、样式或上报数据变了行数、行高都会对不上（`pnpm dev` 里 NumberFlow 是空壳，高度量不准）。
- 首屏跳动用 `reload`：先加载一次暖缓存再刷新，报三样东西——首帧时还没加载完的字体（`fontsAfterPaint`）、首帧后只变了一两次的文字（`textJumps`，带 before → after）、录屏里只变了一两次的画面（`frameJumps`，带前后帧文件）。浏览器时钟默认拨快 2 分钟（`--skew`），模拟 lyjw 刷到的是缓存过几分钟的首屏 HTML；只开一次页面、不刷新、时钟和服务端一致时，这类跳动根本不出现。
  ```bash
  node scripts/site-verify.ts reload --url http://localhost:3300 --out /tmp/reload                  # Chromium：录屏 + 文字 + 字体
  node scripts/site-verify.ts reload --engine webkit --url http://localhost:3300 --out /tmp/reload-wk
  ```
- 什么时候必须跑 `reload`：改到首页首屏、字体或 `@font-face`、缓存头、SSR 或水合、任何按时间算出来的文字（时钟、相对时间、进度）。跑在**生产构建**上（`pnpm build` 后 `DEV_SITE_PORT=<端口> pnpm start`）或 Workers 预览 / 生产地址；`pnpm dev` 的字体、模块加载和缓存头都和线上不同，开发服务器上没跳不算数。要比修复前后，就把修复前的构建也起在另一个端口一起跑。
- `reload` 的每一条 `textJumps` / `frameJumps` 都要在报告里归类，不能只报 ok 与否：时间类文字（时钟、几分钟前、进度）在水合时跳到此刻是缺陷；轮询或推送带来的新数值（计数、费用）是数据刷新；正在播放卡的进度和歌词在水合时从快照跳到此刻是 lyjw 接受过的行为（项目记忆 now-playing-first-screen-decisions）。`liveText` / `liveRegions` 是反复变化的地方，只列不判。`fontsAfterPaint` 只在 Chromium 上可靠：它按 `--latency` 给走网络的请求加往返延迟，每次都要重新验证的字体会晚到，WebKit 没有这个开关。
- 云端没有真 Safari，用 Playwright 的 WebKit 代替：`shot --engine webkit` 截图，`reload --engine webkit` 查文字与字体、不录屏。WebKit 没装时这几个子命令的 `next` 写安装命令（`playwright install --with-deps webkit`，云端约 30 秒）。只有真机才有的行为（地址栏、触控、系统字体），写进「没验到」，请 lyjw 实机看。
- README 实时卡片（`/cards/*.svg`）：和首页原卡并排对照的要求见 `lyjwpage-ui-design`「交付前清单」。出图里不跑脚本、不取外部资源（`docs/screenshots.md`「实时卡片」），所以对照前先列出这张卡里靠浏览器脚本、页面级样式或图标定义、展开交互才有的内容，对照时逐项看出图里有没有。出图在生产构建上看（`pnpm dev` 里 NumberFlow 读数是空的）；README 里的最终显示另在 375 宽用 WebKit 看一次（WebKit 缩小 SVG 时会裁切）。
- 收尾：验证员只关自己开的浏览器。开发服务器和 `dev:override` / `dev:scene` 注入由主线程起、主线程管（`pnpm dev:scene --reset` 一次清完），保留到这轮改动提交推送并确认部署后再清，期间把地址给 lyjw 自己测。在生产域名上验证完就关掉页面：开着的可见标签会按轮询节奏一直请求 API。
- 附图时机：同一项 UI 改动只在首次交付附效果图；之后 lyjw 提的修改若没有另行要求，视为 lyjw 正看着开发服务器，改完照常自测、不再单独截图。云端会话例外，见「主线程收到报告后」。要自写交互脚本时从 `scripts/site-verify.ts` 引 `resolvePlaywright` / `launchBrowser`，不自己找 Playwright 路径。
- PR 描述里的前后对比：有 UI / UX 变化的 PR，写代码的线程开 PR 时在描述最前面（说明之后、「验证清单」之前）放一张 Before | After 两列表格，不折叠（lyjw 定的，仿 t3code 的 PR 写法）。同一视图、同宽、同主题各截一张：Before 用 main 的构建或 lyjw.me，After 用本分支的开发服务器或预览；数据会漂的用 `pnpm dev:scene` 注入同一场景。至多两行：桌面 1280 一行，375 一行；没改到手机布局的只放桌面。另有「没变的」要证明（相邻卡片、旁边的交互）可再加一行，标题写 `(unchanged)`。图推到孤立分支 `verify-shots` 的 `threads/<分支名，/ 换成 ->/` 下（Verify Action 也往这个分支推，不碰构建监视路径），描述里用 `https://raw.githubusercontent.com/LYJW131/lyjwpage/verify-shots/threads/<目录>/<文件>` 引用。推法照 `.github/workflows/verify.yml` 的 `shots` 步：在 scratchpad 里 `git init`、浅取 `verify-shots`、加图、提交、`git push origin HEAD:verify-shots`，被拒就重取 rebase 再推，至多 3 次。这张表给人看，回执与判定照旧由 Verify Action 签；细微改动给 lyjw 的叠图或参考线仍发在讨论串里，不进这张表。

### 3. PR 合并门槛（主线程跑 `pr-gate.ts`，自己判断）

- 合并前、每次被 PR 事件叫醒，主线程先 `git fetch origin main`，再跑 `NODE_USE_ENV_PROXY=1 node scripts/pr-gate.ts --pr <号>`，不派验证员汇总、不分页翻评论。它只读，输出一份 JSON，`ready` 为真时退出 0，字段与选项见 `--help`。读的是：冲突与草稿；head 上每项检查与 commit status（同名只认最新），哪些还在跑；CI 的 `check` 出没出现；按 PR 改动与分支 Preview 的监视路径算出该有的 `Workers Builds:` 检查（结论要是 success）；没解决的行内评审线程（发起人、严重度、最后一条是不是 lyjw 的账号回的、链接）；各机器评审最后审的提交与 Codex 已用轮数；`verify-receipt.ts check` 的回执与判定；有没有 `baseline-exception` 标签；`notes` 里另有不挡合并的提示，含 `Comment check (Jev)` 列出的可能该删的新注释，逐条判断，该删的删掉再推。读不到 GitHub 时退出 1，`error` 写原因。
- 规则漂移：`ruleDrift.files` 不为空，说明分支开工后 main 上改了规则文件（`AGENTS.md`、`DESIGN.md`、`HUMAN.md`、`REVIEW.md`、`.claude/skills/` 与 `.claude/rules/` 下的 md），开工时读的规则可能已经过时。合并前用 `git diff <ruleDrift.since> origin/main -- <这些文件>` 读改动，拿 PR 的改动逐条对一遍新规则，不符合的当轮改掉或在汇报里点名。它不影响 `ready`。CI 已经强制的规则不用对，并入 main 后 CI 会自己拦。
- 分档：脚本按改动路径给 `tier`，只改文档与 skill（`docs`，`public/` 下的 `.txt` / `.md` 如 `llms.txt` 也算）、碰到界面（`ui`）、改逻辑（`logic`），默认的 `--need` 与 `--judge` 跟着档走。lyjw 的账号开的 PR 里，JS / TS 文件相对合并基点只改了注释（同 `pnpm docs:comment-only` 的判法，`scripts/verify-receipt/notes-only.ts#prTier`）的按 `docs` 算，不因路径进界面档或逻辑档（上面那些会执行的文件除外，照旧按 `logic`）；`pr-gate`、合并钩子与 Verify Action 都照这个算，PR 上的 `tier:` 标签只看路径。`.claude/` 的 settings、launch、hooks 与 `feature-map.json`、`docs/` 下的脚本与依赖清单、`public/` 下的 js、html、svg、xml、`_headers` 会让会话或站点执行东西，按 `logic` 档算，不算文档或界面。`author` 给出 PR 作者；作者不是 lyjw 的账号（`verify-receipt.ts#TRUSTED_AUTHOR_IDS`）时，不论改了什么都按 `logic` 档要回执与判定，`--need`、`--no-judge` 不放行。只有大改代码逻辑的 PR 才等机器评审；UI、文档、skill 和小改动不等评审，文档、skill 与小改动也不等 CI：改动涉及的检查本地跑过就合（lyjw 定的规矩，见 `HUMAN.md`「5. PR 与合并」），这时 `checks.pending` 不挡合并，`failing` 照样要修；大改还是小改由写 PR 的线程判断：大改贴 `needs-judge` 标签（见「PR 上的验证」），`--judge` 默认跟着它走。有 UI / UX 变化的 PR 另要 lyjw 看过效果、点头才合（lyjw 明确要求的小改动除外，见根 `DESIGN.md`「交付与合并」）；`ready` 不含这一项，脚本只在 `notes` 里提示。
- 回执等级照分档默认，只认 Verify Action 签的（见「回执」）。合并钩子按分档默认查回执，不够时只提醒、不拦（lyjw 定的）；`--need` 降档只改 `pr-gate` 的输出。回执不够还要合时（例如验证员标的是 lyjw 已接受的取舍，或检查脚本在 main 上同样失败），在 PR 评论里写明差哪一项、为什么还合，合并汇报里告诉 lyjw。
- `todo` 每条写了缺什么、去哪做；照着办完再跑一次。评审线程的 `level`：红圈（🔴）与 P0 / P1 是 `blocking`，永不算可选；安全类（`security`）等 lyjw 拍板；`optional`、`pre-existing`、`info` 可以只回复理由。哪条要修、哪条回复说明不修，由主线程判断；`lastByLyjw` 为真且确实改了的，直接点解决。
- 只为试验开的 PR（测验证员、测工作流、试方案，不打算合）开好就贴 `do-not-merge` 标签（`scripts/guard-merge-method.ts#DO_NOT_MERGE_LABEL`）：`.github/workflows/do-not-merge.yml` 的检查常红、`pr-gate` 不放行、合并钩子拦下；脚本只认标签，不读标题。试完关掉 PR，不摘标签。
- 合并方式按 PR 里的非合并提交数：少于 3 个压缩合并（`squash`），3 个及以上用合并提交（`merge`），不用 GitHub 默认的 `Merge pull request #N from …`：在 PR 分支上 `git fetch origin main` 后跑 `pnpm merge-message <PR 号> "<PR 标题>"`，把输出的 `merge_method` / `commit_title` / `commit_message` / `expectedHeadSha` 原样传给合并接口；PreToolUse 钩子 `scripts/guard-merge-method.ts` 拦下方式不对、缺 `expectedHeadSha`、带 `do-not-merge` 标签或读不到标签的合并；回执没按分档等级盖住 head、贴了 `needs-judge` 却没有 PASS 判定、head 上有 FAIL 判定或读不到回执时只提醒、照样放行（`receiptReason`；回执等级不收 `--need`），合了要在汇报里说差哪一项；head 上 `Comment check (Jev)` 列出可能该删的新注释、PR 改了 JS / TS 它却没出现、还在跑、没跑成或读不到时也只提醒（`commentReason`，`pr-gate` 的 `notes` 同样列出），逐条判断，该删的删掉推送后再合。`expectedHeadSha` 是本地验过的 head，PR 上多出没验过的提交时合并会失败，这时拉下新提交重新验证，不去掉这个参数。标题是 `<PR 标题> (#N)`，正文列 PR 内各提交主题，接着是各提交正文里以 `回滚：` 开头的行（去重），末尾汇总这些提交的 `Co-Authored-By` 与提交作者，去重后只留认得出身份（agent 或 GitHub noreply）且不是仓库主人 lyjw 的，站点「最近提交」靠它显示参与的 agent 与模型；同步 main 的合并不显示（`src/lib/recent-commits.ts#recentCommitsFrom`）。
- Codex 每次推送自动审一轮，上限 3 轮；到上限或最近一轮没审成（`status: "failed"`，多半是额度用完）就不再等它。Claude review 只审要判定的 PR（`tierOf` 的 `judge` 为真：贴了 `needs-judge` 或作者不是 lyjw 的账号），在开 PR、转为待审或贴上 `needs-judge` 时审一次（认「## Code review」汇总评论，报错或 @claude 问答这类普通评论不算），Devin 每个 PR 也只审一次（认 pull review），它们的 `lastReviewed` 不是 head 不算缺；要判定的 PR 里两家一次都没审过时进 `todo`，等待带上限，超时在汇报里记没跑成。Codex 已审过这个 PR 之后的复审：后续推送只改了文档、注释或 skill 的，不等它复审新 head；改了代码的等它复审，上限 15 分钟（同「等待要有上限」），到点没出现就记一句「Codex 没复审这次推送」，其余门槛过了照常合，不当成没通过、不原地等。Cursor Bugbot lyjw 已关掉：不等它、不报它没跑；它真跑出来的意见照常处理。
- 先分真问题和边缘（lyjw 定的：来回修边缘情况只会拖慢收敛、徒增复杂度）。按这次改动的用意正常使用就会出错的（功能不对、报错、数据错、回归、安全）才修；要罕见输入、假设的时序、外部服务异常才触发的边缘情况与防御性加固，回一句「边缘情况，不改：<为什么>」，不管评审标的是什么级别；文档、注释、测试名对不上的顺手改，和别的修复同一次推送，不单为它推送。回执明细里验证员写的「另：」同样处理。
- 评审修复只推一轮：开 PR 后等第一批评审（Codex、Devin、回执）到齐，上限照「等待要有上限」，再把该修的一次修完、推一次。这次推送之后的新发现，只修真问题，其余照上一条回复不改；门槛过了就合，不再等下一轮评审找更罕见的情况。
- 修一条评审发现前，先给它起个类别名，用 `rg` 在 PR 改到的文件里搜同类，一次修完、放进同一次推送；回复那条线程时写上类别名和其他实例改在哪。Codex 每次推送算一轮，漏修的同类会再花一轮。
- 评审收敛：任何一家机器评审到第三轮，还在这次改动的代码里报新的阻塞问题，就停止逐条打补丁，重看实现方法，在线程里用一句话告诉 lyjw 方法换不换、为什么。方向不对就关掉或改做（见 `HUMAN.md`「探索与换方向」）。

### 3b. 大改动的 PR：由没写代码的 Opus 判做完没有

写代码的线程不判自己的活。贴了 `needs-judge` 标签（或作者不是 lyjw 的账号）的 PR，Verify Action 每次推送都派一个 Opus（effort high）判定员，和验证员并行跑（lyjw 定的：不等验证员，每次推送都判）。没要判定的 PR，head 上若已有 FAIL 判定照样不合。

- 判定员只拿 PR 描述里的「lyjw 原话」、PR 号与 head，自己读 PR 相对目标分支的 diff（`git diff origin/<目标分支>...HEAD`）和调用方。它回答两件事：diff 是否做到了 lyjw 要的（逐条对照原话）；有没有改出回归（读调用方，需要时在目标分支和 head 上跑同一个场景对照）。结论 `PASS` 或 `FAIL`，FAIL 列出要修的项。「证据表里有没有没验到却算通过的项」由 publish 按清单对照来查（见「PR 上的验证」）。
- 判定员只读，不看验证员的证据。结论由 publish job 发成评论：第一行 `判定 <head 完整 SHA>：PASS`（或 `FAIL`）给人看，脚本只读第二行的 `verify-stamp` JSON（`scripts/verify-receipt.ts#stampLine`）。
- 结论只对那个 SHA 的补丁有效：只把 main 合进了分支、补丁没变的照旧算数，补丁变了 Action 会按新 head 重判。FAIL 的项修完再推，不和判定员争；确实判错了（比如误读了 lyjw 原话），在 PR 评论里写明依据，交 lyjw 定。
- 判断活仍归主线程：机器评审意见改不改、失败的根因、合不合，由主线程照第 3 节定。

### 4. 合并后部署与生产核对

- 合并没碰到 site 的监视路径时（`docs/workers-builds.md`「构建监视路径」），`/api/version` 本来就不会变；下面的脚本没看到 site 的构建检查就不等版本，只核对碰到的那几个 Worker 的构建。
- 构建与版本等待交给共用脚本，不手写轮询：跑 `NODE_USE_ENV_PROXY=1 node scripts/deploy-check.ts --sha <合并提交完整 sha> --expect auto`（`--help` 看选项）。`auto` 按合并提交与第一个父提交的差异套生产的监视路径（`scripts/build-watch-paths.ts#BUILD_WATCH_PATHS`）算出要等的 Worker，输出的 `expected` 就是算出的结果；不照 PR 上出现过的构建检查定（core 的分支预览路径更宽，PR 上有 core 构建不代表合进 main 会重建 core）。手写 `--expect site,core` 仍可用。列出或算出的 Worker 没有成功构建就不通过。它等合并提交上的 `Workers Builds: *` 检查跑完（同一 Worker 重跑过只认最新那条）；有 site 的构建就再等 `lyjw.me` 与 `lyjw131.com` 的 `/api/version` 跟上这个提交，被之后的提交覆盖也算通过（`superseded`）。输出 JSON，`pass` 为假时 `next` 写下一步。
  - 构建失败或超时、版本停在更旧的提交：FAIL，原样报告 `next`。是否重跑 main 的构建由主线程按下一条决定（从不手跑 `wrangler deploy`）。
- main 上的构建失败时，主线程先读构建日志（Cloudflare Builds API 的 `/builds/builds/<build_uuid>/logs`）。是平台临时错误（部署步 Cloudflare 内部错误、代码与 typecheck 都过了）就直接用 Builds API 对同一 trigger 带 `commit_hash` 重跑，不用问 lyjw，跑完核对结论并在汇报里提一句；main 头已有更新的同 Worker 提交时重跑 main 头，免得回滚。代码或配置导致的失败照常先修。
- 推送没触发构建（GitHub webhook 延迟或丢失）：`deploy-check` 报预期的 Worker 没有成功的构建检查，或叫 lyjw 看分支预览前（`HUMAN.md`「5. PR 与合并」）预览的 `/api/version` 还不是最近一次改了代码的提交，先用 Builds API 列这个 Worker 的构建（`/builds/workers/<script_tag>/builds`）。列表里没有这个提交就直接对同一 trigger 带 `commit_hash` 补跑，不用问 lyjw（`HUMAN.md`「6. 部署与「已部署」」）；补完重跑 `deploy-check` 或重核预览版本，再往下走。
- 碰到 site 的合并，合并前先存一份生产首页：`curl -s https://lyjw.me/ > <scratchpad>/old-home.html`；部署核对通过后跑 `node scripts/site-verify.ts skew --url https://lyjw.me --old-html <scratchpad>/old-home.html`，WebKit 再加 `--engine webkit` 跑一遍。它模拟 Safari 恢复后台标签时按缓存取回的旧 HTML：旧 HTML 引用的 `/assets/*` 要全部从 R2 存档取到、只加载 1 次、有样式、已水合。`ok` 为假时照 `next` 报 FAIL；文件取不到先看这次 site 构建日志里的 `[asset-archive]` 行。
- 生产行为复测只给分支预览测不准的改动：缓存与 Cache-Tag 清除、首屏 SSR、字体、依赖生产 Secret 或绑定的功能。其余改动以预览上的验证为准，合并后只核对构建与 `/api/version`。要复测时在生产域名上做（同第 2 节的方法，URL 换成 `https://lyjw.me/`；涉及 ESA 缓存的也看 `https://lyjw131.com/`）。看完立刻关浏览器：开着的页面会按轮询节奏一直请求 API。
- 定时任务产出的东西（摘要、采集）要等到下一个整点任务跑过再核对，不要在任务跑之前判失败。

## 回执

验证员签回执，主线程按回执办事，不把回执里已经验过的检查再跑一遍（借自 poteto 的验证账本，见 `docs/references.md`）。PR 上的回执由 Verify Action 签发，评论第一行与下面相同，第二行是机器读的 `<!-- verify-stamp {"sha":…,"level":…,"body":…,"base":…} -->`（`base` 只有回执带），脚本只认这一行；正文只摆「全过」或没过的项、至多三条「没验到」，检查与证据截短，全表与截掉的原文折进「明细」（`scripts/verify-action/report.ts#receiptComment`）；没开 PR 时派的验证员照下面的格式把回执写在报告最后一段：

```
验证回执 <被验提交的完整 SHA>：<等级>
证据：<截图路径、命令与退出码、生产 URL，一项一行>
没验到：<原样照抄报告里那一栏，没有写「无」>
验证员：<模型 ID>，没写这段代码
```

- 第一行不手写：用 `node scripts/verify-receipt.ts sign --sha <简报给的 SHA> --level <等级>` 的输出原样粘贴。它用 `git rev-parse` 展开完整 SHA、只收下面五档等级，提交不存在或等级写错就退出 2。手抄过 40 位 SHA 会错字，脚本按 SHA 认回执，错一位整张作废。
- 等级只能写下面五档之一，原样照抄，不自拟新名字（如 `local-ui-verified`）：本地开发服务器或本地生产构建上的真页面检查属于 `live-ui-verified`，没上生产写进「没验到」。
- 等级从高到低：`live-ui-verified`（在真页面上按 lyjw 会用的方式跑过：开发服务器、Workers 预览或生产）、`unit-test-verified`（覆盖改动行为的单测跑过；验证员临时写的脚本不算）、`type-check-only`（只过了类型、lint、构建）。高等级包含低等级：签 `live-ui-verified` 的，覆盖改动的单测也要跑过并列进证据（PR 上 lint、类型这类门禁由 CI 跑，结论由脚本记在回执「脚本：」一行，合并前 `pr-gate.ts` 另查 CI；没开 PR 时验证员自己跑改动涉及的门禁），同时改了页面和后端的 PR 不能只测页面就签这一档。没跑成写 `verifier-blocked`（环境问题，环境好了重派），跑出问题写 `verifier-failed`（先修，修完重派）；这两档都不算通过。CI 绿只是验证员的一项输入，不算回执。
- 改了行为的不收 `type-check-only`。UI 改动要 `live-ui-verified`；后端与脚本至少 `unit-test-verified`。
- PR 上只认 lyjw131[bot] 发的回执与判定（Verify Action 的 publish job，按数字 id 认，见 `scripts/verify-receipt.ts#RECEIPT_SIGNER_IDS`）；线程用 lyjw 的账号贴的同格式评论不算，主线程不自签、不转贴子代理的回执。没开 PR 时派的验证员的回执随汇报交给 lyjw。
- 合并前跑 `NODE_USE_ENV_PROXY=1 node scripts/verify-receipt.ts check --pr <号> --need <等级>`（贴了 `needs-judge` 的 PR 加 `--judge`；没加时 head 上的 FAIL 判定也不放行）。它取 PR 评论里最新的回执与判定：按的就是当前 head（`exact`），或者只把 main 合进了分支、相对 main 的补丁没变（逐字节相同，含空白与二进制，只忽略行号；`carried`），就照旧算数；补丁变了，但从回执的提交到 head 只改了文档档的文件或代码注释（注释由 `docs:comment-only` 的同一套比较证明；`notes-only`，只限 lyjw 的账号开的 PR，`scripts/verify-receipt.ts#notesOnlyFor`），也照旧算数，Verify Action 的 plan 这时不再跑验证员，只在 job 摘要里写「沿用 <sha> 的回执」。从回执的提交到 head 改了规则文档或验证员自己的文件（`scripts/verify-receipt/notes-only.ts#isRuleOrVerifierFile`，合进来的 main 带的也算）时，`carried` 与 `notes-only` 都不成立。其余（`stale`）等 Action 按新 head 重验。只沿用通过的回执，没通过的照样重验。重验时，上一份回执（通过与否都算）清单与目标分支没变（回执戳里记着签发时的 `base`）、按的提交是 head 的祖先、之间有改动且没改规则文档或验证员自己的文件，验证员就以它为底：上次没过的与之后改动碰得到的项重验，其余行写「沿用 <sha>：」带上次的证据，不重跑（`scripts/verify-action/previous.ts#previousReceipt`）。
- 回执只说「验过什么、到什么程度」，不替主线程判断合不合；合并门槛照第 3 节与「3b」。

## 主线程收到报告后

- 先看回执：等级够、盖住要验的提交才往下走。不重跑回执里的检查，只抽查一条证据：至少打开一张截图看一眼（验证员对视觉判断可能出错，PR 上的截图折叠在回执评论的「截图」里），核对一个 sha 或数值；抽查对不上，在 PR 评论里写明哪条不对、补清单后推送让 Action 重验，并改本文件或 `scripts/verify-action/prompts.ts` 把漏洞补上。
- 有 FAIL：自己分析根因、修，再推送让 Action 复测（没开 PR 的再派一次验证员）。FAIL 的是边缘情况或文档措辞（验证员判错了档）的，照第 3 节「先分真问题和边缘」处理，并改 `scripts/verify-action/prompts.ts` 把口子补上。
- 全 PASS：按项目规矩汇报。UI 截图：云端会话里 lyjw 看不到开发服务器，每一轮都把截图发到讨论串（`attached_outputs` 附 `/mnt/project-files/...`，lyjw 定的规矩）；lyjw 在看开发服务器时按第 2 节「附图时机」，只在首次交付附图。合并后汇报写明线上 `/api/version` 的 sha 和生产实测结果。
- 汇报只写实际验到的，「没验到」那一栏原样告诉 lyjw。
- 要 lyjw 点头的汇报（UI 效果、大方向、基线例外）附一行「这些检查测不到什么」，例如只测了暗色、没测 WebKit 的滚动、没测真实推送。说不出来就是还没验够，先补验再找 lyjw。
