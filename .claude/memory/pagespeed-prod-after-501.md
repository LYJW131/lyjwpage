---
name: pagespeed-prod-after-501
description: Production mobile PageSpeed after #501 (2026-10-21): median 93.5, LCP 2.4 s, with Google-side caching and TBT-outlier gotchas
metadata:
  type: project
---

12 independent mobile PSI runs on https://lyjw.me/ (plain URL), 19:37 to 20:07 SGT on 2026-10-21, after #501 went live.

- Scores: 95, 95, 95, 92, 85, 96, 92, 92, 92, 96, 95, 73; median 93.5.
- LCP 2.40 s in 11 of 12 runs (one 2.45 s); FCP 1.50 to 1.65 s; CLS near 0; TBT median about 90 ms.
- Before #501 production was 89, 79, 66 with LCP 2.9 to 6 s; preview runs were 89, 94, 90.
- The two low scores (85, 73) differ only in TBT (354 ms, 1176 ms); LCP and FCP unchanged. Likely a noisy test machine, not confirmed.

**Why:** lyjw asked for ten consecutive production runs to check #501's effect.
**How to apply:** compare future perf work against these numbers. When running PSI in a loop, space calls at least 15 s apart and de-duplicate by `lighthouseResult.fetchTime`: back-to-back calls return Google's cached result or "upstream request failed". See [[pagespeed-via-proxy]].
