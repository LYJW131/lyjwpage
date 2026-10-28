# lyjwpage-review

lyjwpage 自己的改动评审员：线程在云端容器里开 PR 前跑一遍，用法见 skill `lyjwpage-pr-review`。评审员是 Devin CLI 无头模式（`devin -p`），模型 `swe-2-max`（免费档）。

- 取证：开轮前从本地 git 取 merge-base 到 head 的 diff 与 head 的整棵文本源码树，连同标题和意图做成快照（`lib/git-source.ts`、`lib/workspace.ts#reviewWorkspace`）。评审员只有读文件、grep、按名找文件三个工具，不导入任何别家的规则、skill 与 MCP，工作区外的路径读不到（`lib/devin.ts#reviewerConfig`）。
- 提示词：`review.txt`，后面接上 PR 标识（`lib/prompt.ts`）。按快照里的 `REVIEW.md` 判什么该报，最后一条消息交一个 `{"findings": [...]}`（`lib/findings.ts` 解析）。
- 输出：`run.ts` 把发现按 F1、F2……打到标准输出，并把同一份 JSON、原始回复和 Devin 的导出写进 `--out` 目录。不发 PR 评论。

```bash
npm ci
npm run review -- --title <标题> --intent <意图文件> [--base origin/main] [--head HEAD] [--pr N] [--out <目录>]
```

## 评测

`evals/data/cases.json` 是从历史 PR 的 Codex / Devin 评审里取的标注用例，按 PR 分训练、验证、测试三组。

```bash
npm run check
npm run eval -- --variant <目录> [--split train] [--case <用例>] [--reps N]
npm run judge -- --variant <目录>
```

`eval` 给每个 (用例, 轮次) 建快照、跑一次评审员，写 `<目录>/raw/<用例>__rep<k>.json` 和 Devin 的导出 `traces/`。快照与 `run.ts` 同一个取法（浅克隆按 SHA 补取），放在 `REVIEW_EVAL_WORKSPACES`（默认 `/var/tmp/pr-review-ws`）；评审员读不到其他用例的快照与本仓库检出，免得看到后来的修复。

`judge` 用 `claude -p`（Opus 5.5，走 lyjw 的 Claude 订阅，不读任何设置与 CLAUDE.md，只给只读工具）对照标注逐条判，在同一目录写出结果、出错记录和汇总。两步都可重复跑，已完成的跳过。判法在 `evals/judge.txt`，计分在 `evals/judge.ts#score`：

- `recall`：该找到的（M）对上了几成，只算有 M 的用例。
- `false_alarms`：没对上标注、裁判判成读错了的，加上边缘情况却报成 high / medium 的。
- `neg_hits`：把回过「不改」的（N，不含 lyjw 定过的安全取舍）报成 high / medium 的次数。
- `later_hits`、`real_extra`：提前报出后来才修的、标注外裁判核实为真的，只记录不扣分。
