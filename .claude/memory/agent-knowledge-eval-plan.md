---
name: agent-knowledge-eval-plan
description: Control-vs-treatment eval of whether agents use lyjwpage skills (Thorsten Ball's idea), Sonnet and Opus rounds done 2026-10-26; process steps are followed only when the task text says them
metadata:
  type: project
---

Source: Thorsten Ball "How I work with Agents" (X article, 2026-10-25), item "Eval agentic knowledge". Thread「解读 Thorsten Ball 的推文」. lyjw 2026-10-26 19:22 SGT「现在就跑一次」, 19:44「测详细一点呗」, 20:46「成本低一点跑吧」.

Harness (copies in /mnt/project-files/agent-knowledge-eval/, newest `2026-10-26-opus/`): headless `claude -p` per run, fresh CLAUDE_CONFIG_DIR, `env -i` (else children share this session's ids), bwrap hiding /mnt, memory and main repo, shallow clones; arm C's skill deletion must be committed with a neutral message (uncommitted deletes leak via `git diff`). Arms: A registered, B `--disable-slash-commands`, C deleted, D the process step written into the task prompt. Runs bill the API key at list-price estimates ([[cloud-env-gaps]]).

Sonnet rounds (n=5 per arm; report <private claude.ai link>, Opus section added):
- Skill bodies are reached via AGENTS.md paths, rarely the Skill tool (2/25). Unnamed skills reach agents only via the description (formal-model: TLA+ mentioned only in A).
- Content mattered for borrow (A 5.8, B 6.0, C 4.2 /8). Verify ~5/6 in all arms.
- Process lines skipped: repro-before-fix 0/15, delegate to Haiku 0/15.
- Round-2 debug task was mis-specified (bug off the Today Tokens path); Sonnet's 15 "fixes" claimed an unverified cause. One Opus smoke run on it called diagnose, built repro tests and refused to guess.

Opus round (n=3 per arm, $6.26; bug on the symptom path: Pulse Tokens lane, cloud segments, Cache read 0/min):
- Debug A and C: 6/6 fixed with a regression test, 0/6 loaded diagnose, 0/6 saw red before the fix (fixed first, then reverted to prove). 4/6 found the path via `.claude/memory/pulse-tokens-lane-coverage.md`.
- Debug D (「改代码之前，先造出一条能复现这个症状、现在会报红的命令或测试」): 3/3 red test first, then fix; same cost (~$0.5/run), ~6 more calls before the fix.
- Verify A: 3/3 called the Skill and caught both planted defects; 0/3 delegated. Verify D (「这些检查派一个 Haiku 子代理去跑」): 3/3 delegated; Haiku ran more gates (full `pnpm test`, docs:check, design:scale, ui:copy) at the same total cost (Haiku part $0.01–0.02).

Conclusion: skill and AGENTS.md text gets read, but process steps in it are skipped unless the task looks hard; the same step in the task text is followed 3/3. Applied 2026-10-26: MEMORY.md line "Process steps go in the brief". Not measured: fresh sessions have small contexts, so delegation's savings in long threads don't show.
