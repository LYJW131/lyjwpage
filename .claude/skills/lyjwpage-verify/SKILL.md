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
5. **汇报格式**：第一行写自己的模型 ID；然后一张表「检查 | PASS / FAIL / SKIPPED | 证据」（命令与退出码、输出末几行、sha、px 数值、文件路径、报错原文）；再列「没验到的及原因」。要求「不要往好里说，不确定就给原始数值」。

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
| `workers/*`、`reporters/*` | 该目录 `AGENTS.md` / `README.md` 里写的验证命令 |
| 脚本 | `node --test scripts/<名>.test.mjs` |

CI 的完整门禁在 `scripts/ci-checks.sh`（lint、typecheck、workspace_tests、script_tests、docs）。

### 2. UI 浏览器端到端

- 起服务：`pnpm dev`（3211，连生产 Worker）。要注入此刻没发生的状态：`pnpm dev:worker` + `pnpm dev:local`，再 `pnpm dev:override <端点> <夹具>`（夹具在 `workers/core/dev-fixtures/`，收尾 `--clear` / `--off`）。云端会话由 SessionStart 钩子生成 `.dev.vars`，无 Cloudflare 凭据也能起本地 Worker 栈。
- 首屏（SSR）要渲染指定数据：本机起一个 node 代理转发 `https://lyjw.me`、只改被测端点，`PUBLIC_BACKEND_URL=http://localhost:<端口> pnpm dev`，node 用 `NODE_USE_ENV_PROXY=1` 走代理。只改浏览器请求用 Playwright `context.route`。
- Playwright 用全局安装（容器里已验证可用）：

  ```js
  import { createRequire } from "node:module";
  const { chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(url, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(4000);
  ```

  - 不要用 `waitUntil: "networkidle"`：页面在轮询并开着 WebSocket，永远不会 idle。
  - 控制台里 `WebSocket connection to 'wss://…/ws…' failed … 426` 是容器代理造成的，单列为环境噪声，不算站点错误。
- 宽度：至少 1280 桌面与 375 手机（高 812）；改到布局行数或网格时加 iPad（820 / 1024）；有深色样式的改动加 `colorScheme: "dark"`。
- 每个宽度：测可量化的预期（元素 boundingBox、computed style），截元素图或整页图，收集控制台错误与 `pageerror`。
- SSR 相关：`curl -sS <url>` 看原始 HTML，或用 `javaScriptEnabled: false` 的上下文截图。
- 首帧、跳动类问题：录帧或按时间点截图（DOMContentLoaded 后第一帧、水合后、拿到新数据后），给出每一跳的毫秒数。
- 云端没有 Safari / WebKit：凡是 WebKit 才有的行为，写进「没验到」，请站主实机看。
- 收尾：验证员只关自己开的浏览器。开发服务器和 `dev:override` 注入由主线程起、主线程管，保留到这轮改动提交推送并确认部署后再清（AGENTS.md「项目入口与验证」）。

### 3. PR 合并门槛（验证员汇总，主线程判断）

- 只有大改代码逻辑的 PR 才等机器评审；UI、文档、skill 和小改动 CI 绿了就合，不等评审（站主定的规矩）。下面的汇总只用于要等评审的 PR。
- 当前 head 提交上的所有 check run 结论（含 `Workers Builds: site` 等），以及哪些还在跑。
- 读全 `get_reviews`、`get_review_comments`、`get_comments`（GitHub MCP 工具，没加载就用 ToolSearch 加载；仓库 `LYJW131/lyjwpage`）。逐条列出每个机器评审（Claude review、Devin、Codex、Cursor Bugbot、CodeQL）的意见：所在文件行、严重度标记、讨论是否已解决、最后一条是不是我们的回复、它评审的是哪个提交。
- Codex 已跑了几轮（每次推送自动算一轮，上限 3 轮）。Cursor Bugbot 额度用完时当它不存在，不等它也不提（站主定的规矩）；它真跑出来的意见照常列。
- 验证员只列清单；哪条要修、哪条回复说明不修，由主线程决定。

### 4. 合并后部署与生产核对

- 先看合并改到了哪些 Worker 的监视路径（`docs/workers-builds.md`「构建监视路径」）。没碰到 site 的（只改文档、只改别的 Worker），`/api/version` 本来就不会变，跳过下面的版本等待，只核对碰到的那几个 Worker 的构建和受影响的生产行为。
- 碰到 site 时，每 20 秒轮询 `curl -sS -H 'Cache-Control: no-cache' https://lyjw.me/api/version` 与 `https://lyjw131.com/api/version`，最多 10 分钟，直到 `.commit` 等于合并提交的完整 sha。
  - 是更新的提交且以合并 sha 为祖先（`git merge-base --is-ancestor`）：通过（被后来的部署覆盖）。
  - 10 分钟后仍是更旧的提交：FAIL，可能是两次合并并行构建、旧版本后完成。只报告，是否重跑 main 的构建由主线程决定（生产动作，要站主点头，从不手跑 `wrangler deploy`）。
- 合并提交上对应 Worker 的 Workers Builds 检查结论（`Workers Builds: site`，改到哪个 Worker 就看哪个）。GitHub MCP 的检查工具只看得到 PR head 上的检查；main 上合并提交的检查用只读的 `gh api repos/LYJW131/lyjwpage/commits/<sha>/check-runs`。
- 在生产域名上复测这次受影响的行为（同第 2 节的方法，URL 换成 `https://lyjw.me/`；涉及 ESA 缓存的也看 `https://lyjw131.com/`）。看完立刻关浏览器：开着的页面会按轮询节奏一直请求 API。
- 定时任务产出的东西（摘要、采集）要等到下一个整点任务跑过再核对，不要在任务跑之前判失败。

## 主线程收到报告后

磨合期：这一节在 skill 里时，主线程不只抽查，要逐条核对 Haiku 交回的证据，重跑一两项对比结果。发现 skill 写漏、写错，或者简报模板不够用，直接改本文件，单独提一个小 PR，过合并门槛后自己合，不用问站主。站主说磨合结束后删掉这一段。

- 先抽查一条证据：至少打开一张截图看一眼（验证员对视觉判断可能出错），核对一个 sha 或数值。
- 有 FAIL：自己分析根因、修，再派一次验证员复测。
- 全 PASS：按项目规矩汇报。UI 截图：云端会话里站主看不到开发服务器，每一轮都把截图发到讨论串（`attached_outputs` 附 `/mnt/project-files/...`，站主定的规矩）；站主在看开发服务器时按 AGENTS.md，只在首次交付附图。合并后汇报写明线上 `/api/version` 的 sha 和生产实测结果。
- 汇报只写实际验到的，「没验到」那一栏原样告诉站主。
