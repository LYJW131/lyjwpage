# CodeQL 告警自动修复

> 类型：runbook

`.github/workflows/codeql-autofix.yml` 在 main 上的 CodeQL 扫描成功后运行：列出未关闭的 CodeQL 告警，每条告警从默认分支开一条 `codeql-fix/alert-<编号>` 分支，在上面起一个 Cursor 云端 agent 修复，完成后由 Cursor 开 PR。一条告警一个 PR。实现在 `scripts/codeql-autofix.mjs`，Cursor 接口在 `scripts/cursor-cloud.mjs`，入口 `scripts/run-codeql-autofix.mjs`。

## 规则

- 分支即标记：`codeql-fix/alert-<编号>` 已存在就跳过这条告警，不重复派。PR 被关掉、或 agent 判断是误报没改，都会留着分支；删掉分支，下次运行就重派。agent 没能启动时脚本自己删分支。
- 告警按安全等级、严重度、编号排序；单次运行新派的数量上限是 `scripts/codeql-autofix.mjs#DEFAULT_LIMIT`，手动运行可用 `limit` 输入覆盖，超出的标 `deferred`，下次再派。
- 提示词由 `buildAlertPrompt` 生成：只修这一条、修根因，不许加压制注释、改 CodeQL 配置或跳过测试；判断为误报或需要大改设计时不改代码并说明原因。
- 任务会等这批 agent 结束（上限 `DEFAULT_WAIT_MS`），把告警、结果、PR 与 agent 链接写进 job summary；没改代码的附上 agent 的说明。Actions 取消任务时会一并取消还在跑的 Cursor 运行。
- 只认 `push` / `schedule` 触发的 CodeQL 运行；PR 上的扫描不触发。脚本固定从默认分支检出。

## 配置

1. Cursor 账号的 GitHub 集成能读写本仓库，Cursor 以 API key 所属账号开 PR，这样 PR 的 CI 照常触发。
2. 仓库 Secret `CURSOR_API_KEY`：Cursor Dashboard → API Keys 生成的用户 key。
3. 可选仓库 Variable `CURSOR_MODEL`，写法 `<模型 id> <参数>=<值> …`，留空用 `scripts/cursor-cloud.mjs#DEFAULT_MODEL`；可用的 id 与参数查 `GET https://api.cursor.com/v1/models`。

## 手动运行

Actions → CodeQL Autofix → Run workflow；勾 `dry_run` 只列出会派哪些告警，不建分支、不起 agent。

## 本地验证

`node --test scripts/codeql-autofix.test.mjs`。
