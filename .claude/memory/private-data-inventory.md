---
name: private-data-inventory
description: What the site stores but does not publish (D1 forever, DO stripped fields, chat/visitor logs) and the pending plan for a GitHub-login MCP endpoint to read it (2026-10-29)
metadata:
  type: project
---

Audit 2026-10-29 07:00 SGT (thread「盘点站点存了但没公开的数据」):
- Since #742 no public endpoint reads D1 `lyjwpage-history`; limits history reads StateHub (`LIMIT_HOURS_TTL_MS`). D1 is kept forever, backup only.
- Not public: D1 coding_observations (Mac foreground app history, since 2026-09-21), listening_plays (title/artist/album/source), watching/game sessions, charging samples/sessions with device names, workouts heart rate (stripped by `shared/workouts.ts#publicWorkout`), daily rings, usage per source×agent×model with cost, all-vendor limit snapshots, server_hours, site_deploys. DO: charger serial numbers, queue tracks, Quest discordStatus. KV CREDENTIALS Apple Music user token.
- Chat transcripts 30 days (ChatLog), IP quota 60 s, build runs keep GitHub login/id 30 days.
- Public more than expected: `watching/now` Emby client/device/media; `trophies?titleids=` incl. hidden trophy details; R2 `/img/<hash>` never deleted. lyjw has not decided whether to tighten.

Pending (decision card posted, lyjw's call): MCP auth per spec 2026-07-28. Plan: keep `/mcp` public (never 401); new login-only endpoint; site acts as OAuth 2.1 AS via `@cloudflare/workers-oauth-provider` (KV `OAUTH_KV`), GitHub App login, allow only GitHub id 153256373; core adds a private RPC bound only to ai for D1/DO private data; exclude visitor chat transcripts. Needs new KV and a GitHub App callback URL. Don't pass GitHub tokens through (spec forbids).
