# 从合并 PR 的机器评审里找能前置的问题

目标：Codex、Devin Review 在 PR 里指出、又被采纳改掉的问题，下次写代码时一开始就避开，不再靠评审兜。做法是把同类问题归到一处约束上：能机械判定的做成检查，判定不了的写进写代码那一刻会读到的 skill 或规则。

## 范围与书签

- 书签在 `/mnt/project-files/skill-mining/state.json` 的 `prs`：`lastMergedAt`（ISO）与 `lastNumber`，合起来是已连续处理完的最后一个 PR。没有书签时从上一次完成的运行的开始时间起（`runs/` 里最近一份结论为 `完成` 的记录；失败或部分完成的不算，否则它没读完的 PR 会被跳过），没有就从最近一天起，`lastNumber` 记 0。
- 列 PR、取评论、判采纳都由脚本做（下一节）：它按 `(合并时间, PR 号)` 从小到大只取严格大于书签的，一次最多 `scripts/review-sieve.ts#DEFAULT_LIMIT` 个，其余记在输出的 `backlog`，运行记录里写「积压 N 个」。
- 评审者只看 Codex 和 Devin Review（`scripts/review-sieve.ts#BOTS`）。两家都没留过评论的 PR 也算已处理，书签照常越过。

## 先跑脚本分堆

不派 PR 读者。步骤 4 的线程读者派出后，主线程在仓库根跑（输出可能几十 KB，存进 scratchpad 再读）：

```
NODE_USE_ENV_PROXY=1 node scripts/review-sieve.ts --last-merged-at <prs.lastMergedAt> --last-number <prs.lastNumber> > <scratchpad>/review-sieve.json
```

脚本取每个新合并 PR 的行内评审线程、整体评审正文、普通评论和提交列表，只认 lyjw 两个账号的回复，按下面的规则分三堆（实现与关键词在 `scripts/review-sieve.ts#classify`，改规则连同它的测试一起改）：

- `adopted`（采纳）：同一评审线程里的回复写了提交 SHA（短或长），且是这个 PR 的提交。
- `uncertain`（可能采纳）：回复说成立、已修、下一个提交修，却没写本 PR 里的 SHA；写的 SHA 不在本 PR 的提交里（分支历史改写过，如重签）；有 SHA 又说不改或另开；回复没命中关键词；没有行内回复、之后有普通评论；没挂到行上的建议。`candidate` 是最可能的修复提交：回复说「下一个提交」的取回复之后第一个，其余取回复之前最后一个。
- `notAdopted`（未采纳）：回复说不改、复现不出、不成立、保持现状、拆到别的 PR，或根本没有回复。不报。

每条带 PR 号、评审者、严重度标记（Codex 的 P1 / P2，Devin 的 🔴 / 🟡 / 🔍 等加 kind）、文件与行、评审线程链接、建议首句、我们回复的首句、证据（命中的 SHA 或关键词）。

主线程只读原文两种情况，用 `mcp__github__pull_request_read`（`get_review_comments`、`get_commits`），不发评论：

- `uncertain` 逐条读那条评审线程与提交：按改动和提交主题对上修复提交的算采纳，标「不确定」；对不上或说不清的不报。
- `failed` 里的 PR：先用同一书签重跑一次脚本；还失败就读原文照上面规则判。书签仍用脚本给的（不越过失败的 PR），下次从断点重读。

`adopted` 不抽查原文：判定是有测试的脚本规则。

第一次用脚本：从 `prs` 现有书签起读，书签之前的 PR 不重读；没有书签时照上一节定起点。

## 归类与判断

- 主线程读脚本输出里的采纳（`adopted` 加读原文后判成采纳的 `uncertain`），按建议首句、回复首句和文件路径合并成类：问题的根因相同才算一类（「注释漏写新例外」和「文档指针失效」是两类）。看不出根因的那条再打开评审线程读。
- 一类进提议要满足：在两个以上不同 PR 里被采纳；只出现一次的记进 `ledger`，`kind: "review"`、`status: "watching"`，`evidence` 写 PR 号和评审线程链接，下次再见到才提。
- 先查是否已有约束：根 `AGENTS.md`「规则 → 由什么强制」表、`eslint.config.mjs`、`scripts/rules-check.ts`、`.claude/settings.json` 的钩子、`.claude/skills/`、子目录 `AGENTS.md`。已有约束却还被评审抓到，查它为什么没拦住（范围漏了目录、写法没被匹配、规则写在没人读的位置），改那一处，不另起一份。

## 落地（纠错阶梯，能用上一档就不用下一档）

1. **代码结构**（改类型或 API 形状让错写法编译不过）：只写成提议放进报告，等 lyjw 一句话。
2. **确定性检查**：ESLint 规则（`eslint.config.mjs`，自定义规则配 `scripts/eslint-rules.test.mjs`）、`scripts/rules-check.ts` 的新条目（配 `scripts/rules-check.test.ts`）、或 `.claude/settings.json` 的钩子（照 `scripts/guard-forbidden-commands.mjs` 配测试）。要求：
   - 用被评审抓到的那次真实错误证明会报错：在修复提交的父提交上跑，或把那段旧代码写进测试用例。
   - 在当前 main 上不报错。已有零星违例的，同 PR 顺手改掉；违例多到要加基线豁免的，不加这条检查，退到下一档并在报告里说明。
   - 钩子只用来拦 `AGENTS.md` 已经禁止的事，或在写代码时提醒（不拦）；拿不准会不会误拦正常操作的，不做成拦截。
   - 同 PR 在根 `AGENTS.md`「规则 → 由什么强制」表里加一行，检查文件头的规则清单同步。
3. **skill 或规则文字**：判定不了的（要读懂语义），写进那类代码动手时会读到的地方：对应 skill 的自查清单（`lyjwpage-diagnose`、`lyjwpage-ui-design`、`lyjwpage-verify` 等）、子目录 `AGENTS.md`，或根 `AGENTS.md` 对应一节。一条写成一两句可照做的做法，不贴评审原文。

## 交付

- 检查类改动单独一个 PR，标题 `chore(checks): <一句话>`，和 skill PR 分开，便于单独回退；一次运行最多一个检查 PR、最多加两条检查。正文先写 Before / After，再列每条检查对应的评审线程链接和证明它会报错的命令。
- 检查 PR 只加约束、不动产品代码行为（顺手改掉的违例除外，且要是同义改写），按 `HUMAN.md`「PR 与合并」属于小改动，CI 全绿就合；顺手修的违例改了运行时行为的，拆出去或按逻辑改动走机器评审。
- 文字类落地进本次的 skill PR，算在偏差修正的上限里。
- 报告加一节「评审建议前置」：读了几个 PR、采纳了几条、成类的有哪些、各落在哪一档（检查 / skill / 提议），每类一行，带一个被采纳的真实例子（PR 号加评审抓到的问题）。
- 记账：PR 结果确认、台账写进状态文件之后，才把脚本输出的 `bookmark` 写回 `prs`（脚本已让它停在第一个没读到的 PR 之前）。脚本没跑出 JSON、或列不出 PR（`failed` 里 `pr` 为 null）时书签不动，运行记录写「没读到」和原因。失败 PR 之后读成功的采纳照常进台账，下次会从断点重读，台账按评审线程链接去重。
