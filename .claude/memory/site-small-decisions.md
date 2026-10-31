---
name: site-small-decisions
description: Small settled site decisions not to revert or re-propose: README live cards, token unit, no LICENSE, digest pools, dial sizes, Claude limit card, legacy assets, HealthKit nulls, alerts
metadata:
  type: project
---

Settled by lyjw; don't revert or re-propose:
- Architecture diagram validation drops only the bad edge (#386).
- README live SVG cards: wrapped in an outer SVG for mobile crop (#431); URLs carry `v=` to bust camo, bump `v=` when the card format changes. Empty data → fixture marked SAMPLE DATA. Width-based `<picture>` switching tested OK but lyjw dropped it (2026-10-23「算了」).
- Today Tokens on the Vibe Coding card shows M on purpose (lyjw's choice); don't switch to B.
- Repo has no LICENSE by lyjw's choice.
- Type assertions: fix only real risks (unchecked stored/external data); no lint rule (#417).
- Old hashed static assets live in R2 prefix `site-assets-legacy/` (#354); missing Vercel-era chunks get a reload stub.
- Digest card: Chinese tagline pool (lyjw-pruned), 10-line `headlines` pool rotating every 60 s (#261). Jev for digest dropped.
- Dial/heatmap small-text sizes stay as is (lyjw rejected #264).
- Claude limit card: the 5-hour bar has a dead zone like Fable's (lyjw mapping: Pro/Max (was Max 5x) 5h ≈ 1/7 week, Ultra (was Max 20x) ≈ 2/7; unknown plans not drawn), #594.
- HealthKit returns null (not 0) for days with no samples; the site shows 0 when steps exist (#589).
- Workers Issues email alerts: scanner-probe issues ignored, threshold unchanged.
- README has no overview screenshot; every card is a live `/cards/*.svg`.

- README also has the personal-info card and the Cloudflare outage banner (#633).
