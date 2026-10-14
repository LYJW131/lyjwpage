---
name: pagespeed-via-proxy
description: Cloud sessions call PageSpeed Insights keyless; the proxy injects the key as X-Goog-Api-Key for pagespeedonline.googleapis.com
metadata:
  type: reference
---

Since 2026-10-14 the env var `PAGESPEED_API_KEY` is gone from cloud sessions (owner removed it). The env's network secret "PAGESPEED" injects the key as header `X-Goog-Api-Key` for host `pagespeedonline.googleapis.com`. Verified 2026-10-14: a keyless `GET https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?url=...` returned 200.

Gotcha: Bearer-style injection fails (Google answers 401 "Expected OAuth 2 access token"), and path prefixes must be URL paths (e.g. `/pagespeedonline/`), not repo file paths.

Production collector is unaffected: it reads the Cloudflare Worker secret `PAGESPEED_API_KEY`. See [[cloud-env-gaps]].
