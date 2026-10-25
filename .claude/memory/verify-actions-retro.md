---
name: verify-actions-retro
description: Retro of moving verification into GitHub Actions (#572 on), 2026-10-26 SGT: coverage 43%→84%, 4 product defects caught, 20/45 merges were verify/CI upkeep; recommended keep + freeze machinery a week
metadata:
  type: project
---

lyjw 2026-10-26 01:18 SGT「回头审视一下 我们把验证流程迁移到action 真的获得了更多好处吗？」. Report Artifact: <private claude.ai link> . Raw tables: /mnt/project-files/verify-actions-review/ (prs.tsv, runs.tsv, tiers.tsv).

Windows: before 10-20 08:00 → 10-23 20:11 SGT (110 merged PRs), after → 10-26 01:18 SGT (45 merged).
- Coverage (tier recomputed with `tierOf`): before 30/70 receipt-needed PRs had any「验证回执」; after ≥32/38 had a full Verify run.
- Failed receipts #572–#638: ≈17/27 real (mostly verifier's own PRs / doc drift), 6 misjudged, 2–3 env. Product-code defects caught: #622, #635, #656, #663.
- Open→merge median 0.4→7.9 min (before excludes verification, not comparable). Verify run median 3.95 min, p90 8.5. 308 runs: 129 cancelled (186 runner min), 89 skipped, 90 completed.
- Upkeep: 20/45 merges were verify (14), billing WIF (3), peripheral CI (3); +1290/−93 lines; ~11 test PRs closed. Per day 5 → 9 → 3.

Recommendation given (awaiting lyjw, nothing changed): keep; freeze verifier machinery a week (only misjudgment/env fixes, ≤1 verify PR/day); re-measure around 11-01 incl. fix PRs within 24 h of a merge (escaped defects); optional skill line to batch pushes. Related: [[verify-in-actions-plan]], [[verify-fail-causes]], [[verify-effort-ab-result]].
