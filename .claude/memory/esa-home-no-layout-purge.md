---
name: esa-home-no-layout-purge
description: lyjw decision 2026-10-14: lyjw131.com ESA home cache is not purged on layout changes, only on deploy
metadata:
  type: feedback
---

On 2026-10-14 lyjw rejected having core purge the ESA home page (lyjw131.com) whenever the first-screen layout changes, e.g. when the charger card appears ("esa那边不加了 之前有记录 这个缓存只能被清除 不能标记过期 不管了").

ESA keeps the home page for `HOME_CACHE_CONTROL` max-age, so on lyjw131.com a layout change can show the old layout for up to 5 minutes. lyjw accepts that. ESA is purged only by `.github/workflows/purge-esa.yml` on deploy.

**Why:** ESA cache can only be purged, not marked stale. lyjw judged a per-change purge (which needs an Aliyun key in core) not worth it.

**How to apply:** don't propose ESA purge on layout or tag changes again. lyjw.me's own tag purge plus the core minute watch (`workers/core/src/clock-layout-watch.ts`, PR #287) are the layout-freshness mechanism. Related: [[first-screen-reload-check]].
