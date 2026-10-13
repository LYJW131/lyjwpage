---
name: cloud-env-gaps
description: What project cloud sessions (env <cloud env>) lack vs the Mac, verified 2026-10-13; report doc lists fixes
metadata:
  type: project
---

Report (Claude Doc, 2026-10-13): <private claude.ai link>

Facts verified in env <cloud env> (<internal id>, the project's thread env) on 2026-10-13:
- User-set `ANTHROPIC_API_KEY` never reaches sessions (3 fresh sessions + this one), while user vars like `PAGESPEED_API_KEY` do. Inference: ANTHROPIC_* is reserved by Claude Code (harness sets ANTHROPIC_BASE_URL). Recommended name: `LYJWPAGE_ANTHROPIC_API_KEY`. api.anthropic.com bypasses the proxy, so Network secrets can't inject it.
- `pnpm dev:worker` exits in the cloud: the `[ai]` binding (api + ai wrangler.test.toml) needs a remote proxy session → "In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN". So dev:override fixtures also fail. The Mac works via wrangler OAuth.
- No `.dev.vars` in the fresh clone (Mac has 11). Repo SessionStart hook only runs `pnpm install`.
- Network is fully open (lyjw.me, api.cloudflare.com, sentry, anthropic reachable). Browser WebSocket via proxy → 426; no WebKit/Safari; no SSH.

Done 2026-10-13: LYJWPAGE_ANTHROPIC_API_KEY added to env <cloud env> and confirmed reaching cloud sessions; use it as `ANTHROPIC_API_KEY="$LYJWPAGE_ANTHROPIC_API_KEY" pnpm --dir workers/ai digest:probe ...` (real-model runs no longer need the Mac). Still pending: Claude PRs to stub the AI binding when no CF creds and to generate .dev.vars in session-start.sh. See [[credentials-pipe-only]] for anything production.
