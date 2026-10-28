---
name: lyjwpage-pr-review
description: lyjwpage 里开 PR 前（或开了之后）让自家评审员（`agents/pr-review`，Devin CLI 的 swe-2-max，提示词经标注评测调过）在云端容器里只读审一遍改动时用：一次给出 high / medium / low 的发现，Claude 逐条核实、按最小改动修或带证据驳回。线程判为大改动（开 PR 后要贴 `needs-judge` 的那种）时开 PR 前自己跑，不等 lyjw 开口；lyjw 说「审一下」「跑评审员」「pr review」时也用。
---

# 开 PR 前的评审员

评审员在线程自己的云端容器里跑，不进 GitHub Actions：`agents/pr-review/run.ts` 从本地 git 取 head 的源码树和 merge-base 起的 diff 做快照，Devin CLI 的 swe-2-max 只用读文件、grep、按名找文件三个工具，照快照里的 `REVIEW.md` 判，交回一组发现（`agents/pr-review/README.md`）。目的是开 PR 前多一双不同模型的眼睛。什么时候跑和叫不叫 Opus 判定员是同一个判断：线程判为大改动就跑，小改动、文档与 skill 不跑。它不发 PR 评论，不替代 PR 上的机器评审和 Verify Action（`.claude/skills/lyjwpage-verify/SKILL.md`「3. PR 合并门槛」照旧）。

为了让评审员满意只做最小的改动。防范范围蔓延，该驳回就驳回。

## 1. 备好

- 送审的是已提交的 head，没提交的改动它看不到：先提交（WIP 也行）。`git fetch origin main`，base 默认取 `origin/main` 的 merge-base；PR 的 base 不是 main 时用 `--base` 指定。
- 先跑改动波及的门禁（根 `AGENTS.md`「项目入口与验证」），不把自己都没过检查的代码送审。
- 写一份意图文件，就是 PR 描述的草稿：要做什么、不审的范围、跑过的检查和结果（没跑或本来就红的也写上）。评审员把它当数据读，提交说明会自动附在后面。不把已知的 bug 写进去。
- 容器里第一次用先 `npm ci --prefix agents/pr-review`。

## 2. 跑

```bash
cd agents/pr-review && npx tsx run.ts --title '<PR 标题>' --intent <意图文件> --out <scratchpad>/pr-review/<task>
```

- 放进 Bash `run_in_background`，`timeout` 给 2700000（45 分钟；脚本单次上限 40 分钟）。一次约 5 到 15 分钟。跑的时候不改送审的分支，不轮询，不另起一个。
- 免费档限流时脚本自己等一次（重置在 30 分钟内）。Devin 起不来、限流太久、超时、交不出能解析的结果，都不算通过：汇报里记一句「评审员没跑成」，照常开 PR，不挡合并。
- 结果：标准输出按 F1、F2……列出每条发现，`<out>/findings.json` 是同一份 JSON，`<out>/export.json` 是 Devin 的完整过程，要看它读了哪些文件时翻这里。

## 3. 答复发现

每条自己核实，级别也自己定：按这次改动的用意正常使用就会出错的才修；罕见输入、假设的时序、外部服务异常、防御性加固，不管它标什么都算「边缘情况，不改」。

- 同意：最小修法。删掉或收窄优先于加锁、加缓存、加 helper、加选项。修发生的那种情况。意图需要时补一条不修就挂的测试。
- 不同意：写为什么，带证据（文件:行、测试、输出）。
- 超范围：一行驳回，列进后续。

记账本：编号、级别、结论（fixed / disagree / declined）。不猜。修完重跑检查和 `git diff --shortstat <base>`；评审把 diff 撑大了就先砍。

## 4. 再跑一次

默认只跑一次。修 high 的改动又碰了行为代码时，可以在新 head 上再跑一次，只处理新报出的 high，最多两次。只改注释、文档、格式的修复不再跑。

## 5. 收尾

- 不为让评审员满意而推送。PR 已开且 lyjw 让推进时，推送后在 PR 描述末尾的署名前加一行：`Reviewed with agents/pr-review (swe-2-max): <N> findings, <M> fixed`。
- 汇报：跑了几次、发现几条、修了和驳回的各带理由、diff 前后大小、推了没有。
