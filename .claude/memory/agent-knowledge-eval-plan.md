---
name: agent-knowledge-eval-plan
description: Control-vs-treatment eval of whether agents use lyjwpage skills (from Thorsten Ball's post); first run 2026-10-26 SGT, three arms
metadata:
  type: project
---

Source: Thorsten Ball "How I work with Agents" (X article, 2026-10-25), item "Eval agentic knowledge".

lyjw first said wait a week (10-26 18:47 SGT), then 19:22 SGT「算了 现在就跑一次」. Reminder cancelled.

Design of run 1 (scratchpad, headless `claude -p`, Sonnet 5.5, fresh CLAUDE_CONFIG_DIR per run, read-only tools, worktrees from origin/main 55910c4):
- Arm A: skills registered (current state). Arm B: files present but `--disable-slash-commands` (like threads before #639). Arm C: skill dirs deleted.
- Tasks: t1 diagnose (Today Tokens card low, plan only) → lyjwpage-diagnose; t2 borrow (Thorsten article) → lyjwpage-borrow. 4 reps each.
- Grading: trace metrics (Skill call, SKILL.md read) + blind rubric grader. Results: see thread「解读 Thorsten Ball 的推文」 and /mnt/project-files/agent-knowledge-eval/.

Result run 1 (2026-10-26 ~19:50 SGT, data /mnt/project-files/agent-knowledge-eval/2026-10-26/, cost ≈$3.4 runs + grading):
- t2 borrow: Skill called 3/4 in A (4th read SKILL.md), 0/4 in B and C. Blind score A 5.75/8, B 3.88, C 3.25. Gains in "check references.md" and "wait for lyjw to pick numbers". Nobody did "how to test each item" or "check not-adopting".
- t1 diagnose: 0 tool calls in all 12 runs; skill never loaded even in A. Scores ≈1/6 in every arm. Plan-only answers came from AGENTS.md context; skill-only steps (repro command first, bisect, falsifiable hypotheses, red→green) missing.
- Flaws: agents could read /mnt/project-files and memory and saw this eval existed (not arm-blind leak, but breaks B8). Next run: sandbox reads to the worktree, use act-type tasks, n≥5.

Round 2 (lyjw 19:44 SGT「测详细一点呗」; done ~20:40 SGT). bwrap sandbox (hides /mnt, memory, main repo; env -i so child sessions don't share this session's ids), shallow clones, arm C deletion committed (first 75-run pass discarded: C read deleted skills via `git diff`). 5 tasks × 3 arms × 5, Sonnet 5.5, ≈$15. Report: <private claude.ai link> ; data /mnt/project-files/agent-knowledge-eval/2026-10-26-round2/.
- Main entry to a skill is the AGENTS.md path, not the Skill tool (A called Skill 2/25). Unregistered arm B read borrow/verify via the path.
- borrow: A 5.8, B 6.0, C 4.2 /8. verify: ~5/6 all arms (AGENTS.md suffices). diag: 15/15 fixed, skill read 0/15, "red before fix" 0/15 (bug too easy: git log shows it). delegate: 0/15 delegated (task ≤6 tool calls). formal (not in AGENTS.md): only A mentions TLA+ (0.5) from the description, never reads body.
- Skill lines read but not followed: receipt format, 「每条怎么试」, red-before-green → candidates for checks or task-start prompts.
Next-round ideas: bug not visible in history, delegate task clearly >5 calls, Opus arm.
