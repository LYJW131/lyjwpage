# 规则由什么强制

> 类型：reference

能做成机器检查的规则都做成检查。下表列出每条规则由哪个钩子、lint 或 CI 步骤拦；加了新的强制手段在这里加一行。

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
| 剥 HTML 注释或标签删到不再缩短，不只删一遍（`scripts/strip-html.ts`、`src/lib/strip-scripts.ts#stripUntilStable`） | `pnpm rules:check` |
| 界面文案用英文 | `pnpm ui:copy`（基线 `scripts/ui-copy-baseline.json`） |
| `@` 引入的规则文件与 `.claude/rules/` 都在合并前规则漂移检查的范围里（`scripts/rule-drift.ts#RULE_PATHS`） | `scripts/rule-drift.test.ts`（CI 的脚本测试） |
| 三份存量基线只减不增（例外由 lyjw 打 `baseline-exception` 标签放行，agent 不打） | `pnpm baselines:check` |
