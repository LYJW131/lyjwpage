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
- Network is fully open (lyjw.me, api.cloudflare.com, anthropic reachable). Browser WebSocket via proxy → 426; no real Safari; no SSH. Playwright WebKit is not in the base image: `npx -y playwright@1.56.1 install --with-deps webkit` (version = the global playwright) installs it into /opt/pw-browsers/webkit-2215 in ~1 min; the CDN sometimes 502s, retry once and it loads lyjw.me fine (verified 2026-10-20 SGT); lyjw is adding that line to the env setup script, whose result is snapshotted (setup-script files predate container start).
- Egress IP rotates per connection across a pool (2026-10-14: 160.79.106.128–141, all colo IAD via `/cdn-cgi/trace`). Testing a per-IP rate limit (e.g. `/relay`'s `RELAY_LIMIT`) with separate curl calls never trips it; send all requests in one curl invocation (repeat the URL) so they reuse one connection and one IP.
- Cloud thread auto mode also blocks Cloudflare Builds re-runs (`POST /builds/triggers/{id}/builds`) as [Production Deploy], even for a branch-preview build hit by a transient CF error (2026-10-15 SGT, PR #329: core preview deploy `code 10500`, so the site preview build that waits for it failed too). Reading build logs via the Code Mode MCP is allowed. When it blocks: comment on the PR, ask lyjw to re-run from the dashboard, or let the next real push rebuild; never push an empty commit.

Done 2026-10-13: LYJWPAGE_ANTHROPIC_API_KEY added to env <cloud env> and confirmed reaching cloud sessions; use it as `ANTHROPIC_API_KEY="$LYJWPAGE_ANTHROPIC_API_KEY" pnpm --dir workers/ai digest:probe ...` (real-model runs no longer need the Mac). See [[credentials-pipe-only]] for anything production.
Headless `claude -p` with this key bills the API (`apiKeySource: ANTHROPIC_API_KEY`), not the subscription; Max API credit doesn't cover Claude Code per docs, so ask lyjw before Claude Code runs on it (2026-10-26, [[agent-knowledge-eval-plan]]).

2026-10-19 SGT: lyjw added a DeepSeek egress injection (api.deepseek.com, any key value is replaced). Node bypasses the proxy by default, so real-model probes need `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt DEEPSEEK_API_KEY=proxy ANTHROPIC_API_KEY="$LYJWPAGE_ANTHROPIC_API_KEY" pnpm --dir workers/ai chat:probe --tier flash ...`; without NODE_USE_ENV_PROXY DeepSeek answers 401.

2026-10-24 SGT: project thread sessions don't run repo hooks, and a probe `.claude/agents/probe-x.md` gave "Agent type not found" (only built-in types). Repo skills do load, via the Setup script symlinks (probe 06:21 SGT): [[thread-sessions-skip-repo-hooks]]. Custom subagents would have to go into user-level `~/.claude/agents/` via the env Setup script, as hooks do. lyjw was told custom subagents are optional for now.
