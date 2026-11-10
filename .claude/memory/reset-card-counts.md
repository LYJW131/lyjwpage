---
name: reset-card-counts
description: How to change lyjw's Claude reset-card counts (Fable / weekly) shown on the limits forecast when lyjw states them in chat
metadata:
  type: reference
---

Shipped in #802 (2026-11-11 SGT). lyjw says the counts in a thread (e.g.「fable 卡 1 张」); the thread writes them, no confirmation needed.

- **Route A (cloud session):** `POST https://ingest.homepage.lyjw.llc/api/ingest/agents/cards` with JSON `{"fable": n, "standard": n}` (both required, integers 0–99). The proxy injects the Access token (cloud Network secret prefix `/api/ingest/agents/`, permission `ingest:agents-cards`). 202 = stored; it also purges the `limits` first-screen tag.
- **Route B (no config, any session with Cloudflare Code Mode MCP):** put LAG KV namespace `e9c72a9517884aeb95db7386b630a691`, key `claude-reset-cards:v1` (`shared/lag.ts#LAG_KEYS.claudeResetCards`, no prefix), value `{"updatedAt": <ms>, "data": {"fable": n, "standard": n}}`. Does not purge the first-screen cache (readers catch up on rebuild).
- Verify: `https://lyjw.me/api/status/limits` → `data.claudeResetCards`.
- Semantics: Fable card = Fable window to 0 and weekly minus Fable used × 50%; weekly (standard) card = weekly and Fable both to 0. Toggle only shows for kinds with count > 0.
- State at ship: Fable 2, standard 0.

Related: [[no-config-route-first]], [[no-unapproved-to-main-for-preview]].
