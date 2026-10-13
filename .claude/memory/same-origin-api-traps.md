---
name: same-origin-api-traps
description: Production traps when routing browser API traffic through the site Worker (Origin, CF-Connecting-IP, previews, Sentry headers, lyjw131.com, KV vs DO, build callbacks)
metadata:
  type: project
---

Traps found while moving API traffic behind the site Worker ([[same-origin-api-assessment]]):
- Same-origin GET has no `Origin`, only `Sec-Fetch-Site: same-origin`; treat that as Origin = request URL origin, and pass it (never null) to MusicKit signing, since an empty origin list signs an unrestricted token.
- Forward via Service Binding, never cross-zone `fetch()` (CF-Connecting-IP gets rewritten → per-IP limits break).
- Site previews strip bindings and preview bindings hit production → route via bindings only in production.
- Strip `sentry-trace`/`baggage` when forwarding, or api/ai inherit the browser's 10% sampling.
- lyjw131.com pages must call absolute https://lyjw.me (not via ESA).
- Realtime layer must stay in the DO (KV is eventually consistent and fights pushes).
- ai's build `callbackOrigin` is the request URL origin: after the flip the routine must reach lyjw.me.

**Why:** each of these breaks production and is invisible from a one-variable change.
**How to apply:** check this list before any routing, origin or backend-URL change; follow worker-roles.md's migration path.
