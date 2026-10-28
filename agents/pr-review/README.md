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

## 判分

`npm run judge -- --variant <目录>` 读 `<目录>/raw/<用例>__rep<k>.json`（每份是 agent 一次的 `post_findings` 入参），用 `claude -p`（Opus 5.5，走 lyjw 的 Claude 订阅）对照标注逐条判，写出 `results.jsonl`、`errors.jsonl`、`summary.json` 与 `traces/`，可重复跑、已判的跳过。判法在 `evals/judge.md`，计分在 `evals/judge.ts#score`：

- `recall`：该找到的（M）对上了几成，只算有 M 的用例。
- `false_alarms`：没对上标注、裁判判成读错了的，加上边缘情况却报成 high / medium 的。
- `neg_hits`：把回过「不改」的（N，不含 lyjw 定过的安全取舍）报成 high / medium 的次数。
- `later_hits`、`real_extra`：提前报出后来才修的、标注外裁判核实为真的，只记录不扣分。
