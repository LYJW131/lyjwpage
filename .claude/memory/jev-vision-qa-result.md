---
name: jev-vision-qa-result
description: Jev 1.14.0 as image checker for explainer frame acceptance vs Haiku (tested 2026-10-21 SGT): equal catches, far cheaper, but noisy and box only locates big defects; keep Haiku
metadata:
  type: project
---

lyjw asked 2026-10-21 (SGT) to compare Jev (TypeSafe System One, `jev-1.14.0`, images + box) with the Haiku frame acceptance. Report Artifact and data: `/mnt/project-files/jev-vision-qa/` (plant.py, truth.json, jevrun.py, boxrun.py, score_jev.py, raw answers, 72 sheets).

Setup: 4 dark-chapter segments × 36 frames, 12 planted defects (8 sustained, 4 one-frame), 72 two-frame sheets, same as `docs/explainer/frame-qa-calibration.md`.

Result: Jev 1.14.0 (8 yes/no `noul` questions per sheet, 0.5 line) caught 10/12, Haiku 10/12; both missed the 6 px tear, Jev also missed a 10 px label jump. Jev flagged 19/40 clean sheets (Haiku 0 false alarms). Jev cost about $0.01 per 72 sheets and 0.29 s median each; Haiku about $0.6 (estimate) and 17 min. `box` questions (1.14 only, header `TypeSafe-Danger-Zone-Images: true`) located 5/8 sustained defects (centre inside), failed on tiny ones; confidence does not track correctness; no position for one-frame glitches.

Gotchas: `jev-latest` still pointed at 1.13.0 (catches fewer); images under about 10 px are rejected; Jev answers yes/no probabilities, not text, so Haiku's prompt cannot be reused as is.

**Why:** Jev is not a replacement; at best a pre-filter, and on this data it would skip only about a third of the sheets.
**How to apply:** keep Haiku as the frame checker. Don't re-propose Jev for acceptance; a pre-filter needs a new mechanism and lyjw's OK, and only after the false-alarm rate is cut. See [[not-adopting]], [[verification-haiku-worker]].
