---
name: explore-findings-check-intent
description: Before "fixing" a UI inconsistency found by an agent QA pass (e2e explore etc.), check git log/blame for lyjw's intent; Today Tokens in M is deliberate
metadata:
  type: feedback
---

2026-10-20 18:00 SGT: an `e2e explore` run flagged Vibe Coding "Today Tokens 2195.6M" vs "63.3B" elsewhere. Claude merged #492 switching it to B under the "clear fix merges without asking" rule; lyjw: 「那条别改啊 我之前故意改成M的」. Reverted in #494, comment added on `kiloMega`.

**Why:** an inconsistency an outside agent sees is not automatically a bug; lyjw makes deliberate display choices that the code does not explain.
**How to apply:** before fixing a QA-found UI inconsistency, run `git log -S` / blame on the line and look for lyjw's choice; if the reason is unclear, ask in one line instead of treating it as a clear bug. "Clear fix" means broken behavior (error, wrong data, crash), not a style mismatch. Related: [[not-adopting]].
