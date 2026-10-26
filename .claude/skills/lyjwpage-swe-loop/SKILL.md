---
name: lyjwpage-swe-loop
description: lyjwpage 里开 PR 前（或开了之后）让 Devin 的 swe-2-max 循环审一个改动、直到双方都认可时用：只读审查，默认 3 轮，发现分 blocker / should / nit，Claude 逐条核实、按最小改动修或带证据驳回。线程判为大改动（开 PR 后要贴 `needs-judge` 的那种）时开 PR 前自己跑，不等 lyjw 开口；lyjw 说「swe loop」「让 swe-2-max 审一下」时也用。
---

# swe-loop

照 Theo 的 [tstack `sol-loop`](https://github.com/t3dotgg/tstack/blob/main/skills/sol-loop/SKILL.md) 改的：审查员从 GPT Sol 换成容器里 Devin CLI 的 `swe-2-max`（免费档，不扣 Devin 限额）。目的是开 PR 前多一双不同模型的眼睛，什么时候跑和叫不叫 Opus 判定员是同一个判断：线程判为大改动就跑，小改动、文档与 skill 不跑。它不替代 PR 上的机器评审和 Verify Action（`.claude/skills/lyjwpage-verify/SKILL.md`「3. PR 合并门槛」照旧）。

为了让审查员满意只做最小的改动。防范范围蔓延，该驳回就驳回。

## 预算

- 默认 3 轮。第 1 轮全量审，之后只看改过的代码和未结的发现。
- 只有安全、权限、鉴权、丢数据、状态与并发类的改动，且还有带证据的 blocker / should 没结，才延到 5 轮；lyjw 要求也可以。
- 某一轮只剩 nit 就提前停。驳回的 nit、只改注释 / 文档 / 格式的修复不开新一轮。
- 一个审查员。它不许再起子代理或别的审查员。
- 记账本：编号、级别、结论（fixed / disagree / declined）。不猜。

## 1. 定范围

- `git status --short`。不 stash、不丢弃、不把无关改动算进来；改动路径能干净分开就只审那些路径，分不开就停下问。
- 找 base：`git fetch origin main` 后 `git merge-base HEAD origin/main`（PR 用它的 base 分支）。整轮用同一条 diff 命令。
- 用一两句写清意图和不审的范围。先跑改动波及的门禁（根 `AGENTS.md`「项目入口与验证」），不把自己都没过检查的代码送审；没跑或本来就红的写进任务书。

## 2. 起审查员

审查员是 Devin 外部进程，照 [lyjwpage-devin-dispatch](../lyjwpage-devin-dispatch/SKILL.md) 的 `dv.py` 驱动，环境、沙箱、返回码都以那份为准。和派活不同的地方：

- **只读工作区**：`git worktree add --detach <scratchpad>/wt/swe-<task> <head>`，在里面 `pnpm install --frozen-lockfile --prefer-offline` 和 `pnpm typecheck`（沙箱里没网、要生成类型）。未提交的改动先提交成 WIP 再建，审查员看不到主检出。
- **不自动批写入**：`dv start swe-<task> --cwd <worktree> --brief r1.md --model swe-2-max --no-auto-approve --nice 10`。`wait` 返回 4 且是写入菜单时 `dv deny swe-<task> 'Review only. Put it in your reply.'`。
- `dv wait swe-<task> --timeout 1800` 放进 Bash `run_in_background`。审查进行时不改送审的文件，不轮询，不起第二个审查员。超时、报错、没回话都不算通过：`dv stop`，确认退出，带着账本重起一次；还是不成（Devin 起不来、限流重置超过 `--timeout`），汇报里记一句「swe-loop 没跑成」，照常开 PR，不挡合并。
- 用 swe-2-max，不换 Fusion：要的是另一种模型的视角。免费档限流时 `wait` 自己等到重置（见 dv-dispatch「免费档限流」）。

第 1 轮任务书（英文，Devin 看不到对话）：

```
Review only. Do not edit, create or delete files, commit, stash, or start subagents. If you feel the urge to write a file, put the content in your reply instead.
Repo: <worktree abs path>   Base: <sha>   Head: <sha> (checked out, clean)
Intent: <intent>
Out of scope: <scope>
Checks: <results>
See: git diff <base> [-- <paths>] ; git status --short.
Read surrounding code (<entry points worth reading>). Find bugs, broken callers, mismatch with intent.
Skip style unless it hides a bug. Hold to the smallest change. Flag code, tests, or guards the intent does not need. Other paths, rare cases, small perf, extra compat: nits.
blocker = intended case wrong. should = real bug users will hit, in intent. nit = rest.
For every finding give the concrete scenario (inputs/steps -> wrong result).
Reply in English, exactly this shape and nothing else:
VERDICT: APPROVE or CHANGES
S1 [blocker|should|nit] <file>:<line> <claim>. Scenario: <steps>. Fix: <suggestion>
(stable ids S1, S2, ...)
```

「Read surrounding code」后面点名生命周期、调用方这类该看的入口，比泛泛一句找得准。不把已知的 bug 写进任务书。

## 3. 答复发现

`dv report swe-<task>` 取回复。每条自己核实，级别也自己定：另一条路径、罕见情形、小开销，不管它标什么都算 nit。

- 同意：最小修法。删掉或收窄优先于加锁、加缓存、加 helper、加选项。修发生的那种情况。意图需要时补一条不修就挂的测试。
- 不同意：写为什么，带证据（文件:行、测试、输出）。
- 超范围或 nit：一行驳回，列进后续。

更新账本，重跑检查和 `git diff --shortstat <base>`。评审把 diff 撑大了就先砍。不为结束循环而同意。

## 4. 下一轮

只有预算还在，且还有 blocker / should 没结、或行为代码变了、或上次的 APPROVE 盖不住当前 diff 时才开。修复提交后，在审查员的工作区 `git -C <worktree> checkout --detach <新 head>`（审查员空闲时），再 `dv send swe-<task> -f rN.md`，同一个会话保留上下文。任务书写：新 head、账本（`fixed:` / `disagree:` / `declined:` 加证据）、同一条 base diff 命令、`git diff <上轮 head> <新 head>`；让它只看未结编号和改过的代码，每个旧编号标 `resolved` 或 `still open: <原因>`。

## 5. 收尾

- 达成一致：当前行为 diff 上 APPROVE，没有未结的 blocker / should，自己也没有疑虑。
- 卡住：同一条来回两次还有分歧，或预算用完。两边各写两三行，交给 lyjw 定。预算用完不算通过。
- 循环里不推送。PR 已开且 lyjw 让推进时，推送后在 PR 描述末尾的署名前加一行：`Reviewed with swe-loop: <N> rounds with swe-2-max. Verdict: approved`。
- `dv stop swe-<task>`，确认 `dv list` 里已退出，`git worktree remove <worktree>`（审查员没写东西，不加 `--force`），`devin rm --force <会话 id>`。
- 汇报：轮数、审查员改变了什么、diff 前后大小、修了和驳回的发现各带理由、推了没有。
