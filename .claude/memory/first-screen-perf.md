---
name: first-screen-perf
description: First-screen and caching history for lyjw.me: ISR replacement, LCP fix, HTML slimming, what was rejected
metadata:
  type: project
---

ISR replaced by Workers Caching entrypoints + Cache-Tag purge; first-screen regressions fixed in #274 (Geist Mono restored). Now-playing decisions: [[now-playing-first-screen-decisions]]. ESA home is purged only on deploy: [[esa-home-no-layout-purge]]. First-screen LCP fix #364 (mobile 6.4→4.9 s); post-deploy PageSpeed check rejected (#366 closed). HTML slimming done (#370); homepage modulepreload lowered (#400), charger icons inlined (#402).
