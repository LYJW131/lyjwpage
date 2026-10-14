---
name: ssr-fixture-proxy-e2e
description: How to make the site's first screen (SSR) and the browser render one chosen data snapshot locally (scenes via pnpm dev:scene, #338)
metadata:
  type: reference
---

Since #338 (2026-10-15 SGT) no node proxy is needed: under `pnpm dev:worker` + `pnpm dev:local`, SSR and the browser both read the local Worker, so injections drive both.

- One endpoint: `pnpm dev:override <endpoint> <fixture>` (paths may carry a query, e.g. `/api/lyrics?song=…`; dev-router checks injections before the collector).
- Several cards that must agree (digest numbers vs Pulse dial, light vs dark shots, before/after comparisons): `pnpm dev:scene <scene>` injects a whole snapshot with one `now`, re-derives digest highlights with the ai Worker's rules and pins the headline pool to one line. `NODE_USE_ENV_PROXY=1 pnpm dev:scene --capture <name>` snapshots production; `--age 20m` ages the snapshot; `--reset` clears. Scenes live in `workers/core/dev-fixtures/scenes/`.
- README static shots: `pnpm readme:shots` (scene `readme`).
- Playwright `context.route` still only rewrites browser requests.
- Pain-point list behind this: `/mnt/project-files/fixtures/痛点.md`.

Also seen: Apple's catalog can say `hasLyrics: true` while `/api/lyrics` returns `lines: []` for that song (e.g. songId 1888044596, cn storefront).
