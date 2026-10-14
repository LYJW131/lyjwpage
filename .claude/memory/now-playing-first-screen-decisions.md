---
name: now-playing-first-screen-decisions
description: lyjw-accepted behavior of the home now-playing card between first paint and fresh data (stale snapshot, hydration snap)
metadata:
  type: project
---

Settled with lyjw on 2026-10-13 (thread on first-screen jumps; PRs #218, #220, #224, all merged):

- **The stale first-screen snapshot is by design.** The cached home HTML and its now-listening snapshot are not invalidated on song change, so first paint can show an older song. lyjw: "换歌不刷新…就是这样设计的 没问题". Don't propose changing that cache rule.
- **SSR and the hydration frame draw progress and lyrics at the snapshot anchor.** `useMountedAt` returns 0 until hydration. After hydration they snap straight to "now" with no tween; lyjw accepted this in #218.
- **If the snapshot's song has already ended by the client clock, the card holds the first-screen frame** until the first successful refetch or push (#220).
- **The first screen keeps an empty lyrics result** for a song whose catalog `hasLyrics` is true, so it draws the no-lyrics layout from the first frame (#224).
  - Known gap, not fixed: if such a song starts while the page is open, the placeholder still flashes briefly.
  - Options left open: prefetch lyrics for `upcomingSongIds`, or make the backend `hasLyrics` accurate.

Testing technique: [[ssr-fixture-proxy-e2e]].
