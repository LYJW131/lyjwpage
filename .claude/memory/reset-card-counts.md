---
name: reset-card-counts
description: How to record lyjw's Claude reset cards (Fable / weekly, each with an expiry) shown on the limits forecast when lyjw states or screenshots them
metadata:
  type: reference
---

Shipped in #802 (2026-11-11 SGT). lyjw says the counts in a thread (e.g.「fable 卡 1 张」); the thread writes them, no confirmation needed.

- **Since #806 each card has an expiry** (lyjw 2026-11-11「重置卡是会过期的」; lyjw sends a screenshot of Claude settings → Limit resets). Body/value: `{"fable": [expiresAt unix s, …], "standard": […]}`, one entry per card; expired cards stop counting. Public `claudeResetCards` stays counts.
- **Route A (cloud session):** `POST https://ingest.homepage.lyjw.llc/api/ingest/agents/cards` with that JSON (both arrays required, ≤99). The proxy injects the Access token (cloud Network secret prefix `/api/ingest/agents/`, permission `ingest:agents-cards`). 202 = stored; it also purges the `limits` first-screen tag.
- **Route B (no config, any session with Cloudflare Code Mode MCP):** put LAG KV namespace `e9c72a9517884aeb95db7386b630a691`, key `claude-reset-cards:v2` (v1 = old counts format, pre-#806) (`shared/lag.ts#LAG_KEYS.claudeResetCards`, no prefix), value `{"updatedAt": <ms>, "data": {"fable": [...], "standard": [...]}}`. Does not purge the first-screen cache (readers catch up on rebuild).
- Verify: `https://lyjw.me/api/status/limits` → `data.claudeResetCards`.
- Auto: ingress strikes the earliest-expiring live card when a limits report shows a card was used (`shared/vibecoding-limits.ts#detectResetCardUse`); new cards still need lyjw to say so.
- Semantics: Fable card = Fable window to 0 and weekly minus Fable used × 50%; weekly (standard) card = weekly and Fable both to 0. Toggle only shows for kinds with count > 0.
- State 2026-11-11 06:17 SGT: Fable ×2 expire 2027-03-09 15:59 SGT (1804579140), weekly ×1 expires 2026-12-11 06:00 SGT (1796940000).

Related: [[no-config-route-first]], [[no-unapproved-to-main-for-preview]].
