---
name: pine-sandbox
description: Pine Computer (api.pinesandbox.io) egress proxy usage and how it fared as a UI e2e verifier for lyjw.me (2026-10-27 SGT)
metadata:
  type: reference
---

- Proxy injects the key for api.pinesandbox.io /v1/. SDK `@pinesandbox/computer` 0.3.4: `new Client({ endpoint: "https://pinesandbox.io", apiKey: "<any placeholder>" })` (passing api.* is rejected), run node with `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`; location is `{ country: "SG" }`. Read-only probes: GET /v1/project-policy, /v1/locations.
- UI e2e trial on lyjw.me (script /mnt/project-files/pine-e2e/e2e.mjs): $0.35, 6.5 min. Good at card inventory, theme toggle, same-site request check. Cannot do 375px (window fixed 1911 wide, no DevTools), WebKit, reload checks, or local dev servers. Found PlayStation card images all broken from its SG residential IP (fine from the cloud container); the card shows long alt text with no fallback.
- Verdict given to lyjw: optional extra check (real residential IP / region), not a replacement for `site-verify`.
- Follow-ups merged 2026-10-27 SGT: #704 `scripts/region-check.ts` + workflow "Region Check" (SG/US/DE after each prod deploy, secret `PINECOMPUTER_API_KEY`); #705 `AppImage` retries a failed direct third-party image once through `/image`, hides it only if that also fails (same-origin images untouched). Pine SG/DE proxies cannot reach Sony hosts (ERR_SOCKS_CONNECTION_FAILED); region-check reports that as "unreachable", not an issue.
