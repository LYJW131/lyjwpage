---
name: jev-verify-trial
description: Jev 1.14 as a diff-reading second verifier beside the Haiku Verify Action (2026-10-23 SGT): fast and quiet but misses what needs running or rendering; test-only, PR #596
metadata:
  type: project
---

lyjw asked 2026-10-23 18:02 SGT to try Jev 1.14 (`jev-1.14.0`, repo secret `TYPESAFE_API_KEY`) beside the Haiku verifier, test only, never fed to receipts, judge or the main agent. Built on draft PR #596 (stacked on #572): `.github/workflows/verify-jev.yml` + `scripts/verify-jev.ts`; results only in job summary + artifact `jev`, no PR comment. Jev gets diff patches + 验证清单 + lyjw 原话 and answers noul questions (asks_done, bug, unasked, doc_mismatch, per checklist item, per file). Thresholds 0.7/0.3 from TypeSafe docs.

Trial PRs #597 (correct), #598 (planted bug a test catches), #599 (UI copy change), #600 (planted bug the test locks in):
- Haiku + Opus judge: right on all four, ~1m45s (logic) to ~5 min (UI). Haiku also found a real 375px Chromium footer wrap on #599.
- Jev: #598 caught (bug 0.74, asks_done 0.21); #600 only borderline (bug 0.65, asks_done 0.30); #597/#599 clean; blind to #599's layout issue (needs rendering). ~0.2 s, ~1.5k tokens.
- Noise on 14 merged PRs ×3 runs: no bug ≥0.7, asks_done never ≤0.3, but 5/14 land bug 0.3–0.7; runs vary ≤0.07 (0.16 once).

Images (same day, lyjw asked): on #599's footer crops, narrow nouls written knowing the bug ("SHA and DEPLOYED on two lines?", "line starts with a stray ·?") hit 0.95/0.92 vs ≤0.06 on clean shots; the generic "layout problem?" gave 0.67 on a clean control. Data: /mnt/project-files/jev-verify-trial/.

Decision: lyjw 2026-10-23 18:17 SGT「好 不进main 记录测试结果」. #596-#600 closed unmerged.

**How to apply:** Jev can't run tests or look at pages, so it can't replace Haiku; at most a cheap early signal. Not adopted; don't re-propose it as a verifier. Related: [[jev-vision-qa-result]], [[verify-in-actions-plan]].
