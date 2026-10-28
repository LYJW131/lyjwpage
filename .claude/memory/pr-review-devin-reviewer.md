---
name: pr-review-devin-reviewer
description: Own change reviewer (agents/pr-review, Devin CLI swe-2-max, run in the cloud thread, replaces swe-loop), prompt tuned by hillclimb with an Opus judge; Cursor Free tier can't run the Agent SDK
metadata:
  type: project
---

**Goal (lyjw 2026-10-28):** our own reviewer, prompt and tools tuned with `/claude-api build-eval` + `/claude-api hillclimb`. First asked as a Bugbot/Security Review replacement triggered like Devin Review; lyjw then moved it into the cloud thread (below).

**Cursor is out (lyjw 2026-10-28 21:54 SGT「算了，你不用 Cursor 了，你用 Devin SWE2 试一下」):** lyjw's Cursor account is Free tier; Agent SDK runs go through Cloud Agents, which need a paid plan. A SuperGrok / X Premium+ link only grants Grok Bot usage. A Cursor API key "agent-sdk (liangyaweideMBP.lan)" was created on the Mac and is still in the Cursor dashboard (revoke is lyjw's call).

**Reviewer:** code in `agents/pr-review/` (branch `claude/project-thread-r45n50`). lyjw 2026-10-28 23:41 SGT: no GitHub Actions; it runs in the thread's cloud container and replaces the swe-loop skill ([[pr-review-auto]]). `run.ts` snapshots merge-base diff + head tree from local git, prints findings F1… and writes `--out`; it posts nothing to GitHub. The Actions workflow and pr-gate wiring were dropped before merge, so no `DEVIN_CREDENTIALS` secret is needed.

**Devin CLI headless facts (3000.11.228):**
- `devin --config <cfg> --model swe-2-max --respect-workspace-trust false --export <json> --prompt-file <f> -p`; stdout is the last agent message.
- `--config` replaces the user config. `read_config_from` all false stops importing ~/.claude skills; `subagents_enabled:false` drops `run_subagent`; `disabled_tools` drops tools (mcp_* and `skill` can't be removed).
- A denied tool call ends the whole `-p` run, so disable tools instead of denying them. A tool-level allow ("read") overrides `Read(...)` deny rules, so use deny rules only.
- Free-tier rate bucket is account-wide ([[devin-free-tier-limit]]); eval runs at concurrency 6.

**Eval:** 58 labeled cases from past Codex/Devin reviews (`agents/pr-review/evals/data/cases.json`, train 28 / val 14 / test 16). Judge is Opus 5.5 via `claude -p` on lyjw's subscription (lyjw「用opus5.5吧 花我订阅呗」), flags `--setting-sources ""`, read-only tools, `--json-schema`. Budget (lyjw decision card): at most 8 rounds, 1 rep per round on train. Result (2026-10-29 06:20 SGT): round 1 kept (read scoped AGENTS.md/.claude/rules as checks; maintainer-only and edge findings at low instead of dropped): train recall 0.50→0.68, val 0.63→0.72, test 0.48→0.52 (test inside noise). Round 2 (walk ordinary use) reverted, round 3 below noise bar, loop stopped. Remaining misses mostly need running code. Flow dir: `/mnt/project-files/pr-review-eval/hillclimb/pr-review/` (report.html, narrative.md). Free-tier rate bucket was the pace-setter; staggered restarts after a limit (devin-run gate) removed repeat hits.

**Why:** first aimed at replacing Bugbot/Security Review, which spend Cursor third-party quota ([[merge-requires-bot-review-pass]] says Bugbot is off for quota); lyjw then moved it in-thread.

**How to apply:** continue in the thread that owns `agents/pr-review`; don't re-try Cursor unless lyjw's plan changes.
