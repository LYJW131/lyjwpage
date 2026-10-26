---
name: dimensional-drawing-skill
description: enesozturk/dimensional-drawing skill (Apple-style UI spec sheets) tried on lyjwpage cards; lyjw keeps it in reserve, not adopted
metadata:
  type: project
---

2026-10-26 20:32 SGT lyjw「留着备用吧」after a trial of [dimensional-drawing](https://github.com/enesozturk/dimensional-drawing): a skill that draws one-page monochrome spec sheets of a UI component (slots, variables like S1/H2, [TBD] for unknowns).

Trial output: /mnt/project-files/dimensional-drawings/ (server-card and status-grid, .png + .html), measured on lyjw.me at 1440 and 375 with Playwright. Adapted to DESIGN.md: radius 0, hard 3px shadow, so the skill's nested-radius and blur-envelope views became a square corner + hard shadow detail. Cost ≈10 min per sheet of hand-placed coordinates.

**How to apply:** not wired into lyjwpage-ui-design. If lyjw later wants structure drawings for UI reviews, reuse the trial HTML (kit + build.py pattern) instead of starting over; don't re-propose adopting it unprompted.
