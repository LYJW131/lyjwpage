---
name: workerd-browser-resolve-condition
description: Cloudflare Vite plugin resolves the site SSR bundle with the `browser` condition, so "am I in a browser" checks via package exports return true on the server
metadata:
  type: project
---

`@cloudflare/vite-plugin` resolves workerd environments with conditions `workerd, worker, module, browser`. Packages that detect the browser via export conditions (e.g. `esm-env/browser`) report BROWSER=true during SSR. This made every `@number-flow/react` number render as an empty `<number-flow-react>` in the initial HTML after the move to Workers (charger power, clock; 41 instances). Fixed in PR #190 (opened 2026-10-12) with a server-only resolveId plugin in `vite.config.ts` mapping `esm-env/browser` to `false.js`.

**Why:** the bug is invisible with JS on; only the raw SSR HTML or a no-JS render shows it.
**How to apply:** when a component renders fine after hydration but is empty in SSR HTML, check whether its dependency picks a browser build by export condition. Prefer a targeted server-env alias over dropping `browser` from global conditions. Verify with `curl` on the SSR HTML or a JS-disabled browser.
