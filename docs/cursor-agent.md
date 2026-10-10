# PR 里的 Cursor 云端 agent

> 类型：runbook

在 PR 下评论 `/cursor <需求>`，`.github/workflows/cursor-agent.yml` 用 Cursor Cloud Agents API 起一个云端 agent，直接在 PR 的 head 分支上改代码并推送；同一条评论下方会出现一条进度评论，随 agent 自己的待办列表实时更新，结束时附推送的提交和总结。实现在 `scripts/cursor-agent.mjs`，入口 `scripts/run-cursor-agent.mjs`。

## 用法

- 普通评论：`/cursor 把空状态文案改成英文并补测试`。
- 行内 review 评论同样可用：进度评论回复在该线程，agent 会拿到文件路径、行号和 diff hunk。
- 只有 `OWNER` / `MEMBER` / `COLLABORATOR` 的评论会触发；fork 来的 PR 推不回去，会直接回一条说明。
- 同一 PR 的指令按 `concurrency` 排队执行；GitHub 只保留一个排队中的任务，连发多条时较早排队的那条会被丢弃。
- 在 Actions 里取消这次运行，会同时取消 Cursor 那边的运行。

触发词是 `/cursor` 而不是 `@cursor`：仓库装着 Cursor GitHub App，它自己会响应 `@cursor` 再起一个 agent，两边会同时往一条分支推。

## 工作方式

- 建 agent 时传 `repos[].prUrl` 与 `workOnCurrentBranch: true`，Cursor 推到 PR 的 head 分支，不开新 PR（`autoCreatePR: false`）。提示词由 `buildPrompt` 生成，要求遵守仓库的 `AGENTS.md`、先用待办工具列计划并持续更新。
- 进度来自运行的 SSE 流：待办只取完成事件里合并后的完整列表（`extractTodos`），当前动作取自 `tool-call-started`（`describeActivity`）。流断了带 `Last-Event-ID` 重连，流过期（`410`）改为轮询运行状态。
- 结束后比较运行前后的 PR head SHA，列出新提交；没变就写「No new commits」。模型输出里的 `@` 插零宽空格，不会点名真实用户。
- 脚本固定从默认分支检出：review comment 事件默认检出 PR 代码，不能在持有 `CURSOR_API_KEY` 的任务里运行 PR 里的脚本。`issue_comment` 触发的 workflow 本身也只从默认分支读取，所以合进 main 前评论不会触发。

## 配置

1. Cursor 账号的 GitHub 集成要能读写本仓库（[cursor.com/dashboard/integrations](https://cursor.com/dashboard/integrations)）。
2. 仓库 Secret `CURSOR_API_KEY`：Cursor Dashboard → API Keys 生成的用户 key。
3. 可选仓库 Variable `CURSOR_MODEL`，写法 `<模型 id> <参数>=<值> …`，留空用 `scripts/cursor-agent.mjs#DEFAULT_MODEL`。可用的 id 与参数查 `GET https://api.cursor.com/v1/models`。

## 本地验证

- `node --test scripts/cursor-agent.test.mjs`。
- 事件形状的依据是 [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints.md)「Stream A Run」与 [TypeScript SDK](https://cursor.com/docs/sdk/typescript.md) 的 `UpdateTodosToolCall`；官方声明工具载荷不稳定，形状变了先改 `extractTodos` 和对应测试。
