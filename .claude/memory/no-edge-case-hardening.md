---
name: no-edge-case-hardening
description: lyjw rejects fixes that add workflow/code complexity for rare edge cases on non-blocking checks; accept the red mark instead
metadata:
  type: feedback
---

lyjw 2026-10-27 04:05 SGT「算了你回退 这东西就是死抠边缘情况徒增复杂度了」. #697 made verify-pi skip (notice, no red) on PRs branched before the pi verifier existed; after bot reviews it grew a merge-base check plus a 67-line test. Reverted in #698.

**Why:** verify-pi is advisory (`ADVISORY_CHECKS`), never blocks merge; a red mark on an old branch is noise that fades as branches merge main. Bot findings pushed the fix into ever rarer cases.

**How to apply:** when a non-blocking check is red for a transient or self-healing reason, explain the cause and stop; don't propose a fix unless lyjw asks. If a fix is asked for, keep it to the first simple version and push back on bot findings that only cover rarer cases. Related: [[verify-pi-ab-watch]], the "Don't over-engineer" line in MEMORY.md.
