# 任务书模板

Devin 看不到对话，任务书就是它的全部上下文。分两份写：**共享规则**一份（所有任务引用、每轮更新，新规则替换旧规则而不是往后追加），**任务书**每任务一份。任务书用英文写（Devin 的英文执行更稳），报告语言写明即可。

## 共享规则

每条规则写成「不许做 X，改做 Y」；只写禁令不给替代做法，代理会自己找变通。

```markdown
`$S` below is `<scratchpad absolute path>`.

## The repo
lyjwpage, pnpm workspace. main is at <sha>. Other agents work in other worktrees.
Read the root AGENTS.md for conventions; where it conflicts with this file, this file wins.

## Hard rules
**Never run `git stash`, in any form.** The stash stack is shared with the main checkout.
To set work aside, make a WIP commit.

**Where you work:** only your worktree. Use absolute paths. Temporary and large files go under
`$S/<your task>/`; delete them before you finish.

**No network inside your sandbox:** do not install or upgrade dependencies. If something is
missing, stop and say exactly what.

**Processes: only your own PIDs.** Start background runs as `cmd & pid=$!` and use that PID.
Never `pgrep -n`, `pkill -f`, `killall`.

**Never** push, open PRs, deploy, run `wrangler`, or touch Cloudflare or GitHub settings.
Never read credential files. If you need a credential, stop and ask.

**Commits:** small, `type(scope): 描述` in the style of `git log`. Never rewrite history.
Stage with `git add <explicit paths>` only. Never `git add -A` or `git add .`: the sandbox mounts
placeholder files (`.bashrc`, `.gitconfig`, `.mcp.json`, …) into your worktree.

## Acceptance (every task)
1. The checks listed in your brief pass; paste exact commands, exit codes and counts.
2. **Report:** commands, result tables, the numbers the task asks for, commits (hash + subject), open issues.
```

## 任务书

```markdown
`$S` is `<scratchpad absolute path>`. `$S/briefs/_common.md` applies; read it first.

# <task id>: <one-line goal>

Work only in the git worktree `$S/wt/<task>` (branch `devin/<task>`, base `<sha>`). Commit on your branch.

## Why
<data, who measured it, where the files are; numbers, not adjectives>

## Steps
1. Locate or measure first; put the findings in your report.
2. <the approach, or two or three candidates to compare>
3. <what not to do, which files not to touch>

## Checks
<exact commands, e.g. `pnpm test`, `pnpm --dir workers/core test`, `pnpm exec eslint <files>`>

## Done when
<verifiable conditions>
Stop and report instead of guessing when <decisions that need the orchestrator>.
```

## 续轮任务书（复审打回）

先一句肯定做对的部分，再编号列出**阻塞合并**的问题，每条给证据和要求。会话已退出用 `dv.py resume <name> -f <续轮任务书>`，还开着用 `dv.py send <name> -f …`；Devin 保留上一轮全部上下文。

## 中断后的续跑提示

服务断线或编排会话重启后，续跑提示写清：发生了什么、哪些输出可能是半截的、从哪里继续。

```markdown
The Devin service dropped the connection in the middle of your last step ("Connection error",
retryable). Continue exactly where you left off: your brief and `$S/briefs/_common.md` are unchanged.
Your last step was <…>; check which runs finished, re-run what didn't, delete partial outputs.
```
