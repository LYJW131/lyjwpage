---
name: limit-forecast-backtest
description: Claude weekly limit forecast (src/lib/limit-forecast.ts) backtested 2026-10-29 SGT on hourly archive data; no change, revisit after ~4 full hourly weeks
metadata:
  type: project
---

lyjw asked 2026-10-29 03:20 SGT whether the forecast needs work, using data since the hourly limit archive (#007e1bec, 2026-10-20 22:54 SGT, `limit_hours`; before that one point per day). Data from public `/api/status/limits/history`.

Result: one full hourly week (10-19 11:00 → 10-26 11:00 SGT) plus a partial one. Forecast MAE 2.3 pts at 6h, 4.3 at 24h, 6.5 at 48h; bias +0.8 / +2.8 / +4.8 (predicts too high). In week 1 it said run-out 10-22…10-25; real 100 came 10-26 ~04:30, 6.5 h before reset. lyjw's weeks are front-loaded then crawl near 98–99 (10-12 week same shape), likely pacing in reaction to the bar.

Tuning PRIOR / momentum half-life / momentum weight moved MAE by ≤0.5 pt (noise). A saturating curve cut 24h bias to +0.5 but never predicts run-out, while both weeks did hit 100. Decision: no change.

**How to apply:** don't re-tune on less than ~4 full hourly weeks (from ~2026-11-16). Backtest = replay `forecastLimit` at each hourly point with only earlier points, compare against later readings in the same window.
