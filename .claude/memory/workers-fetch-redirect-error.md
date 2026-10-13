---
name: workers-fetch-redirect-error
description: Cloudflare Workers fetch throws TypeError on redirect "error"; use "manual" and reject 3xx yourself (Node reporters are fine)
metadata:
  type: project
---

In Worker code (site, api, ai, ingress, collector), `fetch(url, { redirect: "error" })` throws synchronously: `Invalid redirect value, must be one of "follow" or "manual"`. A catch-all around fetch hides it as a timeout or network error. This silently broke the browser Sentry tunnel `/relay` (always 504) from the Cloudflare migration until PR #188 (merged 2026-10-12).

**Why:** the runtime will never implement "error". Locally, `wrangler dev` reproduces it, so a local 504 is not proof that the network is unreachable.

**How to apply:** in Worker code, use `redirect: "manual"` and treat 3xx as a failure. `reporters/` and `scripts/` run on Node and may keep "error". When a Worker proxy looks dead, log the actual caught error before blaming connectivity.
