---
name: ssr-fixture-proxy-e2e
description: How to make the site's first screen (SSR) render a chosen status payload in a cloud session, without the local Worker stack
metadata:
  type: reference
---

Playwright `context.route` only rewrites browser requests; the SSR loader fetches status and lyrics inside workerd. To pin what the first screen renders (2026-10-13, now-playing card work, PR #224):

- Run a small node proxy on localhost (e.g. :8799). It forwards everything to https://lyjw.me, rewrites only the endpoint under test (e.g. `/api/status/listening/now`), and adds `Access-Control-Allow-Origin: *`. Start node with `NODE_USE_ENV_PROXY=1` so its fetch goes through the agent proxy.
- Start the site with `PUBLIC_BACKEND_URL=http://localhost:8799 pnpm dev`. vite.config.ts bakes that URL into both the SSR worker and the browser bundle, so SSR and client both read the proxy.
- Then let Playwright routes override the browser's copy to simulate "a fresh fetch brings a different song".
- `/api/dev/overrides` 404s in this setup; that is harmless.

Also seen: Apple's catalog can say `hasLyrics: true` while `/api/lyrics` returns `lines: []` for that song (e.g. songId 1888044596, cn storefront).

Related: [[merge-requires-bot-review-pass]].
