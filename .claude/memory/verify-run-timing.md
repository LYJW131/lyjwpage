---
name: verify-run-timing
description: Where Verify Action time goes per push (measured on #622, 2026-10-24 SGT) and the fixes already made
metadata:
  type: project
---

Measured on #622 (4 pushes, 2026-10-24 01:11–02:06 SGT) from the claude-code-action stream in the verify job log (run logs zip, `show_full_output`):
- Each push re-runs Verify ~7–8 min; the Haiku step is 3–6.5 min, setup + wait-preview + proof < 1.5 min. CI `check` is 1–1.5 min.
- Inside the Haiku step: model API time is over half (20k–30k thinking tokens, `--effort high`); next is browser scripts run → patch → rerun (10–60 s per round).
- First push wasted 6.5 min starting `dev:worker`/`dev:local` in the Action to inject fixtures, then was cancelled by the next push. Fixed by #624 (prompt: use `page.route` on the preview; local Worker only when the SSR first frame must be seen).
- #623: revert proof now also covers `workers/*/` tests; verifier no longer lists the proof as a check row.
- Open choice for lyjw: lowering verifier effort high → medium (faster, may miss checks). Not changed.

Related: [[verify-in-actions-plan]].
