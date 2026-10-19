# 任务书模板

Devin 看不到你的对话，任务书就是它的全部上下文。下面两份分开写：**共享规则**一份（所有任务引用、每轮更新），**任务书**每个任务一份。Straylight 的共享规则实例：`~/.claude/projects/-Users-liangyangjunwei-Developer-Straylight/handoff-2026-10-16/briefs/_common-r7.md`。

任务书用英文写（Devin 的英文执行更稳），报告要求它用英文或中文都可以，写明即可。

## 共享规则（`$S/briefs/_common.md`）

每条规则都来自一次真实事故；写成"不许做 X，改做 Y"，只写禁令不给替代做法，代理会自己找变通。

```markdown
`$S` below is `<scratchpad 绝对路径>`.

## The shared machine
<现在 main 是哪个提交、基线二进制在哪、别的代理在改哪些区域>
Other agents build and measure at the same time, so: compare only interleaved A/B runs, ≥3 rounds, report medians.

## Disk
Write renders/large outputs only under `$S/<your task>/`. Delete them as you go and before you finish.
Check `df -h /System/Volumes/Data`; below 20 GB free, stop producing output and say so.

## Hard rules
**Never run `git stash`, in any form.** The stash stack is shared with the owner's checkout.
To set work aside, make a WIP commit. To compare against base, use the frozen baseline or
`git worktree add $S/<your task>/base <sha>`.

**Where you work:** only your worktree. Never `cd` anywhere else (a permission dialog stalls the
orchestrator). Use absolute paths. Temporary files go under `$S/<your task>/`.

**What you run:** no GUI apps, no downloads, no installs. <项目特有的禁区>

**Processes: only your own PIDs.** Start background runs as `cmd & pid=$!` and use that PID.
Never `pgrep -n`, `pkill -f`, `killall`: other agents run the same binaries.

**Don't touch:** the owner's checkout `<path>`, installed apps, `~/Library/Application Support/<app>`,
other worktrees, read-only test data `<path>`.

**Commits:** small, in the style of `git log`. Each message ends with:
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Co-Authored-By: Devin AI <158243242+devin-ai-integration[bot]@users.noreply.github.com>
No "Generated with" line. Never push, never rewrite history.

## Acceptance (every task)
1. build + full test suite pass, no new warnings;
2. <项目的回归检查，例如 golden / 逐像素 A/B 0 差异>;
3. **Report:** exact commands, result tables, the numbers the task asks for, commits (hash + subject), open issues.
```

## 任务书（`$S/briefs/<task>.md`）

```markdown
`$S` is `<scratchpad 绝对路径>`. `$S/briefs/_common.md` applies; read it first.

# <task id>: <一句话目标>

Work only in the git worktree `$S/wt/<task>` (branch `devin/<task>`, base `<sha>`).
Baseline: `$S/bin/base-<sha>/`. Commit on your branch.

## Why
<上一轮的数据、谁测的、文件位置。给数字，不给形容词>

## Steps
1. 先测量/定位，再动手；把定位结果写进报告。
2. <具体做法，或者两三个候选方案让它比较>
3. <明确不做什么、不碰哪些文件（所有权）>

## Measure
<精确命令行，含签名/环境变量这种容易漏的前置步骤>

## Done when
<可验证的条件：指标阈值、0 差异、测试数>
Stop and report instead of guessing when <需要用户/编排者拍板的情况>.
```

## 续轮任务书（复审打回）

开头一句肯定做对的部分，然后编号列出**阻塞合并**的问题，每条给证据和要求的协议（轮数、窗口、对照组）。例：

```markdown
# M5 follow-up: prove the CPU cost and close the deviation hole before merge
Same session and worktree (`$S/wt/m5-alias`). `$S/briefs/_common.md` applies; re-read it, it changed.
Good work: <具体>. Two things block the merge.
## 1. Rebase  — main is now <sha>; since your base it gained <列表>; baseline is now <path>.
## 2. <问题>  — your table shows <数字>; medians of 3 under load don't establish "noise". Protocol: …
```

用 `dv.py resume <name> -f <续轮任务书>`（会话已退出）或 `dv.py send <name> -f …`（还开着）发出，Devin 保留上一轮全部上下文。

## 中断后的续跑提示

服务断线、编排会话重启都会杀掉 Devin 和它的子进程。续跑提示要说清：发生了什么、哪些输出可能是半截的、机器上有什么变化、从哪里继续：

```markdown
The Devin service dropped the connection in the middle of your last step ("Connection error",
retryable). Continue exactly where you left off: your brief and `$S/briefs/_common.md` are unchanged.
Changes on this machine: <…>. Your last step was <…>; check which runs finished
(outputs under `$S/<task>/`), re-run what didn't, delete partial outputs from killed runs.
```
