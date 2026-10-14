---
name: first-screen-reload-check
description: Missed-jump lesson (2026-10-14) and how to catch first-paint font/time jumps: site-verify reload on a production build, warm cache, clock skew
metadata:
  type: feedback
---

On 2026-10-14 lyjw caught a font swap and a clock jump on page refresh that my verification missed ("中间有一段字体和时间跳了 你没看出来 … 改进一下验证流程"). Filmstrips on `pnpm dev`, opened once with a cold cache and the server clock in sync, cannot show either problem.

**Why:** both problems only appear when you **refresh** (warm cache) a **cached first-screen HTML** (older than the client clock) on a **production build**. Two causes. A font URL that revalidates on every load paints the fallback font first. Time-derived SSR text anchored to the snapshot jumps when hydration happens.

**How to apply:** for any change that touches the home first screen, fonts, cache headers, SSR or hydration, or time-derived text, run `node scripts/site-verify.mjs reload` (PR #274) against a production build. Build with `pnpm build`, then serve with `DEV_SITE_PORT=<port> pnpm start`, or use a preview/prod URL. Run it on Chromium and on `--engine webkit`.
- Classify every `textJumps` / `frameJumps` entry.
- To compare before and after, serve the before-build on a second port (`npx wrangler dev --config <copy>/server/wrangler.json --persist-to <dir>`). Two `pnpm start` instances sharing `.wrangler` state broke with SQLITE_CANTOPEN and asset 404s.
- Don't `pkill -f "workerd serve"`: it also kills the `pnpm dev` worker.

Related: [[verification-haiku-worker]], [[now-playing-first-screen-decisions]].
