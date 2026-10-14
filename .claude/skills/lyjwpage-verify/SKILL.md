---
name: lyjwpage-verify
description: lyjwpage 里任何验证步骤都用它：改完后的本地门禁、UI 浏览器端到端与截图、PR 合并门槛、合并后的部署与生产核对；检查交给 Haiku 5.5 high 验证员执行。
---

# lyjwpage 验证

用在 lyjwpage 仓库里任何「验证」步骤：改完代码后的本地检查、UI 的浏览器端到端与截图、PR 合并前的门槛核对、合并后的部署与生产核对。

分工：**主线程决定验什么、判断结果；Haiku 验证员只执行检查、交回证据。** 验证员跑命令、开浏览器、轮询部署、读 PR 评审，这些输出很长但不需要判断力，交给它能省下主线程的上下文和费用。

## 什么时候派验证员，什么时候自己跑

- 派：多步检查（typecheck + 测试 + eslint + build）、任何浏览器端到端或截图、等部署并核对生产、合并前汇总所有机器评审。
- 自己跑：只有一条命令且输出很短（一次 `curl /api/version`、一个单测文件）。写简报比自己跑还贵。
- 验证员不做判断类工作：不判断机器评审意见值不值得改，不分析失败根因，不决定合并或重跑构建。

## 等待要有上限

PR 检查、机器评审、Workers Builds、`/api/version`、后台 `until` 循环，每一种等待都带上限。到点还没等到就记 FAIL「超时」，附上最后一次看到的状态，然后接着做不依赖它的下一步，不原地干等。理由：等的条件可能永远不会成立，比如 SHA 拼错、运行被取消或被新提交顶掉、评审没触发，没有上限的循环会让线程无声卡住。

- 手写的循环用 `timeout <秒>` 或计数上限包住，PR 检查和机器评审各给 15 分钟。部署核对不手写循环，由 `scripts/deploy-check.mjs` 的 `--timeout` 管上限（默认值以脚本 `--help` 为准），构建确实慢时调大这个参数。
- 等的对象要写对：SHA 用 `git rev-parse` 取完整值；PR 的检查用 `gh pr checks <PR 号>`，不按提交号查 `gh run list`，因为 PR 的运行可能挂在合成的合并提交上。刚推送后查不到运行是正常的，在同一个上限内继续重试，到点仍查不到就记「超时：没有出现运行」。`cancelled`、被更新提交顶掉（`superseded`）都算终态，不再等。

## 派法

```
Agent(
  description: "Haiku verifies <对象>",
  subagent_type: "general-purpose",
  model: "haiku",          // 当前一代 Haiku（Haiku 5.5）
  effort: "high",          // 站主指定的档位
  run_in_background: true, // 主线程可以继续干别的；下一步依赖结果时才用 false
  prompt: <下面的简报>
)
```

简报模板（每条都要写，验证员看不到对话上下文）：

1. **身份与禁区**：「你只执行检查、汇报证据。不改仓库文件、不提交、不推送、不合并、不在 GitHub 上评论或解决讨论、不改 Cloudflare / Sentry 任何设置、不触发构建、不调用任何 `mcp__hearthbot__` 工具。检查失败就带证据报告，不要去修。」
2. **改了什么**：PR 号、分支或合并提交 sha、改动的文件、用户能看到的预期行为（写成可测量的：哪个元素在哪个元素上方、左边对齐差多少 px 以内、字号与颜色、某段文字出现在 SSR HTML 里）。
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
| 脚本 | `node --test scripts/<名>.test.mjs` |

CI 的完整门禁在 `scripts/ci-checks.sh`（lint、typecheck、workspace_tests、script_tests、docs、design）。本地跑它要先设 `RUNNER_TEMP`（指到 scratchpad 里的目录），否则报 `RUNNER_TEMP: unbound variable`、一项门禁都没跑。

### 2. UI 浏览器端到端

浏览器取证先调共用脚本 `scripts/site-verify.mjs`（`--help` 看全部选项，输出 JSON，失败时 `next` 字段写下一步），不现写 Playwright 片段。每张卡的端点、可用夹具、选择器与「什么状态证明它对」在同目录 [`feature-map.json`](./feature-map.json)。

`cards` 只检查三件事：卡片在、可见、无控制台错误与同源失败请求（环境噪声除外）。`feature-map.json` 的 `proves` 写的是「这张卡对了长什么样」的目标描述——里面的内容、数值、布局条件 `cards` 不查，由验证员用 `shot` 截图和 `page.evaluate` 量值自己取证。

```bash
node scripts/site-verify.mjs doctor --url http://localhost:3211        # 先体检：站点可达、playwright、Chrome、夹具开关
node scripts/site-verify.mjs cards --url http://localhost:3211         # 逐卡检查存在与可见 + 控制台错误
node scripts/site-verify.mjs shot --url http://localhost:3211 --widths 1280,375 --out /tmp/shots  # 两宽度整页截图
node scripts/site-verify.mjs shot --url http://localhost:3211 --card pulse --theme both --out /tmp/shots  # 单卡明暗 clip
```

- 起服务：`pnpm dev`（3211，连生产 Worker）。要注入此刻没发生的状态：`pnpm dev:worker` + `pnpm dev:local`，再 `node scripts/site-verify.mjs override --endpoint <端点> --fixture <夹具> --dry-run`，确认命令后去掉 `--dry-run` 执行（夹具名从 feature-map.json 的 `endpoints` 里挑；收尾 `--clear` / `--off`）。云端会话由 SessionStart 钩子生成 `.dev.vars`，无 Cloudflare 凭据也能起本地 Worker 栈。
- 首屏（SSR）要渲染指定数据：本机起一个 node 代理转发 `https://lyjw.me`、只改被测端点，`PUBLIC_BACKEND_URL=http://localhost:<端口> pnpm dev`，node 用 `NODE_USE_ENV_PROXY=1` 走代理。只改浏览器请求用 Playwright `context.route`；只看 SSR 长什么样用 `shot --ssr`，看文字用 `curl -sS <url>`。
- 宽度：至少 1280 桌面与 375 手机；改到布局行数或网格时加 iPad（`--widths 1280,820,1024,375`）；有深色样式的改动加 `--theme dark`（或 `both`）。
- 控制台里 `WebSocket connection to 'wss://…/ws…' failed … 426` 是容器代理造成的环境噪声，脚本单列为 `envNoise`，不算站点错误。页面常开 WebSocket、在轮询，没有 networkidle：脚本按 `--settle` 毫秒等待（默认 4000），别自己写 networkidle。
- 脚本量不到的量化预期才自己补 `page.evaluate`：改到同一排里的卡片或替换卡片里的部件时，量改动前后同排各卡的高度、改动处与相邻同类文字的 `font-size` / `font-weight`，在报告里给出前后数值；站主一眼就能看出差几像素。量间距、字号、点击区还有 `node .claude/skills/lyjwpage-ui-design/ui-audit.mjs`。
- 首屏跳动用 `reload`：先加载一次暖缓存再刷新，报三样东西——首帧时还没加载完的字体（`fontsAfterPaint`）、首帧后只变了一两次的文字（`textJumps`，带 before → after）、录屏里只变了一两次的画面（`frameJumps`，带前后帧文件）。浏览器时钟默认拨快 2 分钟（`--skew`），模拟站主刷到的是缓存过几分钟的首屏 HTML；只开一次页面、不刷新、时钟和服务端一致时，这类跳动根本不出现。
  ```bash
  node scripts/site-verify.mjs reload --url http://localhost:3300 --out /tmp/reload                  # Chromium：录屏 + 文字 + 字体
  PLAYWRIGHT_BROWSERS_PATH=<装了 WebKit 的目录> node scripts/site-verify.mjs reload --engine webkit --url http://localhost:3300 --out /tmp/reload-wk
  ```
- 什么时候必须跑 `reload`：改到首页首屏、字体或 `@font-face`、缓存头、SSR 或水合、任何按时间算出来的文字（时钟、相对时间、进度）。跑在**生产构建**上（`pnpm build` 后 `DEV_SITE_PORT=<端口> pnpm start`）或 Workers 预览 / 生产地址；`pnpm dev` 的字体、模块加载和缓存头都和线上不同，开发服务器上没跳不算数。要比修复前后，就把修复前的构建也起在另一个端口一起跑。
- `reload` 的每一条 `textJumps` / `frameJumps` 都要在报告里归类，不能只报 ok 与否：时间类文字（时钟、几分钟前、进度）在水合时跳到此刻是缺陷；轮询或推送带来的新数值（计数、费用）是数据刷新；正在播放卡的进度和歌词在水合时从快照跳到此刻是站主接受过的行为（项目记忆 now-playing-first-screen-decisions）。`liveText` / `liveRegions` 是反复变化的地方，只列不判。`fontsAfterPaint` 只在 Chromium 上可靠：它按 `--latency` 给走网络的请求加往返延迟，每次都要重新验证的字体会晚到，WebKit 没有这个开关。
- 云端没有真 Safari：Playwright 的 WebKit 能装在 scratchpad 里（`PLAYWRIGHT_BROWSERS_PATH=<目录> npx playwright install webkit`，版本跟 `doctor` 报的 playwright 一致），`reload --engine webkit` 查文字与字体、不录屏。只有真机才有的行为（地址栏、触控、系统字体），写进「没验到」，请站主实机看。
- 收尾：验证员只关自己开的浏览器。开发服务器和 `dev:override` 注入由主线程起、主线程管，保留到这轮改动提交推送并确认部署后再清（AGENTS.md「项目入口与验证」）。

### 3. PR 合并门槛（验证员汇总，主线程判断）

- 只有大改代码逻辑的 PR 才等机器评审；UI、文档、skill 和小改动 CI 绿了就合，不等评审（站主定的规矩）。有 UI / UX 变化的 PR 另要站主看过效果、点头才合（站主明确要求的小改动除外，见根 `DESIGN.md`「交付与合并」）。下面的汇总只用于要等评审的 PR。
- 当前 head 提交上的所有 check run 结论（含 `Workers Builds: site` 等），以及哪些还在跑。
- 读全 `get_reviews`、`get_review_comments`、`get_comments`（GitHub MCP 工具，没加载就用 ToolSearch 加载；仓库 `LYJW131/lyjwpage`）。逐条列出每个机器评审（Claude review、Devin、Codex、Cursor Bugbot、CodeQL）的意见：所在文件行、严重度标记、讨论是否已解决、最后一条是不是我们的回复、它评审的是哪个提交。
- Codex 已跑了几轮（每次推送自动算一轮，上限 3 轮）。Cursor Bugbot 额度用完时当它不存在，不等它也不提（站主定的规矩）；它真跑出来的意见照常列。
- 验证员只列清单；哪条要修、哪条回复说明不修，由主线程决定。

### 3b. 大改代码逻辑的 PR：由没写代码的 agent 判做完没有

只用于上面要等机器评审的那类 PR。写代码的线程不判自己的活：CI 绿、评审意见都处理完后，合并前派一个新的判定员。

```
Agent(
  description: "Judge PR #<号> at <head 短 sha>",
  subagent_type: "general-purpose",
  model: "opus",           // 判断活留在主模型
  effort: "high",
  run_in_background: false,
  prompt: <下面的简报>
)
```

- 简报只给：站主的原话（线程根消息和后来补的要求，原文照贴）、PR 号与当前 head 的完整 SHA、这轮验证员的证据表。不给 PR 描述和线程里的推理，让它自己读 `git diff origin/main...<sha>` 和调用方。
- 它回答三件事：diff 是否做到了站主要的（逐条对照原话）；有没有改出回归（读调用方，需要时在 main 和 head 上跑同一个场景对照）；证据表里有没有没验到却算通过的项。结论写 `PASS` 或 `FAIL`，FAIL 列出要修的项。
- 判定员只读：不改文件、不提交、不在 GitHub 上评论。主线程把结论原样发成一条 PR 评论，第一行写 `判定 <head 完整 SHA>：PASS` 或 `FAIL`。
- 结论只对那个 SHA 的补丁有效：之后再推提交，合并前跑 `scripts/verify-receipt.mjs check --pr <号> --judge`；只把 main 合进了分支、补丁没变的照旧算数，补丁变了就按新 head 重派一次。FAIL 的项修完再判，不和判定员争；确实判错了（比如误读了站主原话），在 PR 评论里写明依据，交站主定。

### 4. 合并后部署与生产核对

- 合并没碰到 site 的监视路径时（`docs/workers-builds.md`「构建监视路径」），`/api/version` 本来就不会变；下面的脚本没看到 site 的构建检查就不等版本，只核对碰到的那几个 Worker 的构建，受影响的生产行为照样要复测。
- 构建与版本等待交给共用脚本，不手写轮询：跑 `NODE_USE_ENV_PROXY=1 node scripts/deploy-check.mjs --sha <合并提交完整 sha> --expect <这次碰到监视路径的 Worker，如 site,core>`（`--help` 看选项）。`--expect` 由主线程按生产的监视路径表定好写进简报（不照 PR 上出现过的构建检查：core 的分支预览路径更宽，PR 上有 core 构建不代表合进 main 会重建 core），列出的 Worker 没有成功构建就不通过。它等合并提交上的 `Workers Builds: *` 检查跑完（同一 Worker 重跑过只认最新那条）；有 site 的构建就再等 `lyjw.me` 与 `lyjw131.com` 的 `/api/version` 跟上这个提交，被之后的提交覆盖也算通过（`superseded`）。输出 JSON，`pass` 为假时 `next` 写下一步。
  - 构建失败或超时、版本停在更旧的提交：FAIL，原样报告 `next`。是否重跑 main 的构建由主线程按下一条决定（从不手跑 `wrangler deploy`）。
- main 上的构建失败时，主线程先读构建日志（Cloudflare Builds API 的 `/builds/builds/<build_uuid>/logs`）。是平台临时错误（部署步 Cloudflare 内部错误、代码与 typecheck 都过了）就直接用 Builds API 对同一 trigger 带 `commit_hash` 重跑，不用问站主，跑完核对结论并在汇报里提一句；main 头已有更新的同 Worker 提交时重跑 main 头，免得回滚。代码或配置导致的失败照常先修。
- 在生产域名上复测这次受影响的行为（同第 2 节的方法，URL 换成 `https://lyjw.me/`；涉及 ESA 缓存的也看 `https://lyjw131.com/`）。看完立刻关浏览器：开着的页面会按轮询节奏一直请求 API。
- 定时任务产出的东西（摘要、采集）要等到下一个整点任务跑过再核对，不要在任务跑之前判失败。

## 回执

验证员签回执，主线程按回执办事，不把回执里已经验过的检查再跑一遍（借自 poteto 的验证账本，见 `docs/references.md`）；磨合期内例外，照「主线程收到报告后」的磨合期一段逐条核对。回执是验证员报告的最后一段，原样照抄：

```
验证回执 <被验提交的完整 SHA>：<等级>
证据：<截图路径、命令与退出码、生产 URL，一项一行>
没验到：<原样照抄报告里那一栏，没有写「无」>
验证员：<模型 ID>，没写这段代码
```

- 等级从高到低：`live-ui-verified`（在真页面上按站主会用的方式跑过：开发服务器、Workers 预览或生产）、`unit-test-verified`（覆盖改动行为的测试跑过）、`type-check-only`（只过了类型、lint、构建）。没跑成写 `verifier-blocked`（环境问题，环境好了重派），跑出问题写 `verifier-failed`（先修，修完重派）；这两档都不算通过。CI 绿只是验证员的一项输入，不算回执。
- 改了行为的不收 `type-check-only`。UI 改动要 `live-ui-verified`；后端与脚本至少 `unit-test-verified`。
- 有 PR 时，主线程把回执原样发成一条 PR 评论，第一行不动；还没开 PR 的，随汇报交给站主，开 PR 时再发。一行命令就能验完、主线程自己跑的，主线程照同样格式自签，验证员那一行写主线程的模型 ID 和「自验」。
- 合并前跑 `NODE_USE_ENV_PROXY=1 node scripts/verify-receipt.mjs check --pr <号> --need <等级>`（要等机器评审的 PR 加 `--judge`）。它取 PR 评论里最新的回执与判定：按的就是当前 head（`exact`），或者只把 main 合进了分支、相对 main 的补丁没变（`git patch-id` 相同，`carried`），就照旧算数；补丁变了（`stale`）就按新 head 重派验证员。
- 回执只说「验过什么、到什么程度」，不替主线程判断合不合；合并门槛照第 3 节与「3b」。

## 主线程收到报告后

磨合期：这一节在 skill 里时，主线程不只抽查，要逐条核对 Haiku 交回的证据，重跑一两项对比结果。发现 skill 写漏、写错，或者简报模板不够用，直接改本文件，单独提一个小 PR，过合并门槛后自己合，不用问站主。站主说磨合结束后删掉这一段。

- 先看回执：等级够、盖住要验的提交才往下走。磨合期内照上一段逐条核对、重跑一两项；磨合期结束后不重跑回执里的检查，只抽查一条证据：至少打开一张截图看一眼（验证员对视觉判断可能出错），核对一个 sha 或数值；抽查对不上，回执作废、重派验证员，并改本文件把漏洞补上。
- 有 FAIL：自己分析根因、修，再派一次验证员复测。
- 全 PASS：按项目规矩汇报。UI 截图：云端会话里站主看不到开发服务器，每一轮都把截图发到讨论串（`attached_outputs` 附 `/mnt/project-files/...`，站主定的规矩）；站主在看开发服务器时按 AGENTS.md，只在首次交付附图。合并后汇报写明线上 `/api/version` 的 sha 和生产实测结果。
- 汇报只写实际验到的，「没验到」那一栏原样告诉站主。
