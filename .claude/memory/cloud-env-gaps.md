---
name: cloud-env-gaps
description: What project cloud sessions (env <cloud env>) lack vs the Mac, verified 2026-10-13; report doc lists fixes
metadata:
  type: project
---

Report (Claude Doc, 2026-10-13): <private claude.ai link>

Facts verified in env <cloud env> (<internal id>, the project's thread env) on 2026-10-13:
- User-set `ANTHROPIC_API_KEY` never reaches sessions (3 fresh sessions + this one), while user vars like `PAGESPEED_API_KEY` do. Inference: ANTHROPIC_* is reserved by Claude Code (harness sets ANTHROPIC_BASE_URL). Recommended name: `LYJWPAGE_ANTHROPIC_API_KEY`. api.anthropic.com bypasses the proxy, so Network secrets can't inject it.
- Fixed by #226: without CF creds `scripts/dev-worker.mjs` drops the `[ai]` binding, so `pnpm dev:worker` and fixture injection work in the cloud (re-verified 2026-10-15 SGT); `.claude/hooks/session-start.sh` generates missing `.dev.vars` / `.env.local` via `scripts/cloud-dev-vars.mjs`.
- Network is fully open (lyjw.me, api.cloudflare.com, anthropic reachable). Browser WebSocket via proxy → 426; no WebKit/Safari; no SSH.
- Egress IP rotates per connection across a pool (2026-10-14: 160.79.106.128–141, all colo IAD via `/cdn-cgi/trace`). Testing a per-IP rate limit (e.g. `/relay`'s `RELAY_LIMIT`) with separate curl calls never trips it; send all requests in one curl invocation (repeat the URL) so they reuse one connection and one IP.

Done 2026-10-13: LYJWPAGE_ANTHROPIC_API_KEY added to env <cloud env> and confirmed reaching cloud sessions; use it as `ANTHROPIC_API_KEY="$LYJWPAGE_ANTHROPIC_API_KEY" pnpm --dir workers/ai digest:probe ...` (real-model runs no longer need the Mac). See [[credentials-pipe-only]] for anything production.
