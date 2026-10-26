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
