# lyjwpage-review

lyjwpage 自己的 PR 评审 agent，替代 Cursor Bugbot 与 Security Review。用 Cursor Agent SDK（`@grok/agent-sdk`）写成，跑在 Cursor 托管上，模型是 `grok-4.7`（effort `xhigh`、fast），走 lyjw 的 Cursor 第一方额度。

- 触发：与 Devin Review 一致，PR 打开、重开、转为待审时审一次；草稿和之后的推送不审（`bot/channels/github.ts`）。
- 取证：开轮前主机备好 `pr/diff.patch`、`pr/meta.md` 和 head 的整棵文本源码树 `repo/`，模型只有 `read` / `grep` / `glob` / `ls`，跑在沙箱里（`bot/lib/workspace.ts`、`bot/agent.ts`）。
- 输出：调一次 `post_findings`，发一条 PR review；落在 diff 里的行挂行内评论，行首标记与 Devin 一致，`scripts/pr-gate/threads.ts#severityOf` 能分档（`bot/lib/review-body.ts`）。
- 提示词：`bot/instructions.md`，按 `repo/REVIEW.md` 判什么该报。

## 本地

```bash
npm install
npx agent-sdk validate --dir .
npm run check
```

模型轮次要 Cursor 凭据（`agent-sdk login`）。评测见 `evals/`：`evals/data/cases.json` 是从历史 PR 的 Codex / Devin 评审里取的标注用例。
