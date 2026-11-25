---
name: verify-pi-ab-watch
description: How the Verify A/B (Claude Code vs pi verifier, since #665) is watched daily and when the report is due
metadata:
  type: project
---

lyjw 2026-10-26 22:38 SGT「ab测试结果定时盯一下」. Thread「盯 Verify 验证员 A/B 结果」.

- Daily self-check 21:07 SGT via send_later in that thread (chained one day at a time).
- Script, ledger, cache and procedure: /mnt/project-files/verify-ab/ (README.md, ab-read.ts, ledger.json, summary.md, verdicts.md).
- Samples exclude cancelled runs, branches without the verify-pi job, and #665's 13 self-test rounds.
- Tell lyjw only on a new disagreement, B failing 3 runs in a row, or 30 paired runs.
- Report (书页 Artifact) at 30 paired runs or 2026-11-09, whichever first; switch decision is lyjw's.

Related: [[verify-action-state]], [[verify-effort-ab-result]], [[report-book-style]].

**Report out 2026-10-27 21:40 SGT** (35 paired runs, 14 PRs): <private claude.ai link> . Levels agree 24/35; A-only FAIL 6 (5 real), B-only 4 (3 real, all minor); B failed to run 3/38 (old branch, npm 404 x2). Recommended: don't switch, stop B. lyjw 2026-10-27 21:37 SGT「再ab 35次或者到1109」: batch 2 counts paired runs created after 2026-10-27T12:04:08Z; report v2 (same Artifact) at 35 more or 2026-11-09; daily 21:07 SGT check resumed. Verdicts: /mnt/project-files/verify-ab/verdicts.md.

**Report v2 out 2026-10-29 10:35 SGT** (same Artifact; batch 2 = 37 paired runs, 23 PRs). Levels agree 26/37. B-only real FAIL 9 (mostly minor, incl. pipefail silent miss #753), A-only 1 (diff truncation #744). B failed to run 3/40, all the 20-min cap on UI-heavy PRs (#722 #723 #743). Totals 72 paired: A $9.01 / B $7.00. lyjw chose 2026-10-29 10:42 SGT「不换，B 接着跑」: A signs, B stays advisory; daily watch and send_later stopped, no more reports unless asked.

**Closed (2026-11-25 SGT):** `CLAUDE_CODE_OAUTH_TOKEN` broke in GitHub Actions, ending the A/B dual-track. lyjw approved switching `.github/workflows/verify.yml` to single-track `.github/actions/verify-agent` (`scripts/verify-agent.ts`, pi SDK + `ANTHROPIC_API_KEY`) for both `verify` (Haiku) and `judge` (Opus). The `verify-pi` job, A/B artifacts (`verify-ab-cc`, `verify-ab-pi`, `verify-out-pi`), and `scripts/pr-gate/checks.ts#ADVISORY_CHECKS` were removed.
