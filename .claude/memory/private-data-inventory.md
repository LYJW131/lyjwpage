---
name: private-data-inventory
description: What the site stores but does not publish (D1 forever, DO stripped fields, chat/visitor logs) and the GitHub-login MCP plan on the shared /mcp endpoint (2026-10-29)
metadata:
  type: project
---

Audit 2026-10-29 07:00 SGT (thread「盘点站点存了但没公开的数据」):
- Since #742 no public endpoint reads D1 `lyjwpage-history`; limits history reads StateHub (`LIMIT_HOURS_TTL_MS`). D1 is kept forever, backup only.
- Not public: D1 coding_observations (Mac foreground app history, since 2026-09-21), listening_plays (title/artist/album/source), watching/game sessions, charging samples/sessions with device names, workouts heart rate (stripped by `shared/workouts.ts#publicWorkout`), daily rings, usage per source×agent×model with cost, all-vendor limit snapshots, server_hours, site_deploys. DO: charger serial numbers, queue tracks, Quest discordStatus. KV CREDENTIALS Apple Music user token.
- Chat transcripts 30 days (ChatLog), IP quota 60 s, build runs keep GitHub login/id 30 days.
- Public more than expected: `watching/now` Emby client/device/media; `trophies?titleids=` incl. hidden trophy details; R2 `/img/<hash>` never deleted. lyjw has not decided whether to tighten.

MCP login (lyjw chose ONE shared `/mcp`, 2026-10-29: 「公用现有端点吧」, matches Claude connector "Sign in when needed" + CIMD):
- Core `PrivateHistory` entrypoint merged (#750, 43af16d9): reads only tables in `shared/private-history.ts#PRIVATE_HISTORY_TABLES`, bound only to ai.
- ai side merged #751 (2794e1b, live 2026-10-29 08:09 SGT): ai is AS + resource via `@cloudflare/workers-oauth-provider` 1.2.4, scope `history:read`, GitHub App login, only GitHub id 153256373; tool `read_private_history` always listed, anonymous call → 401 challenge. Chat transcripts excluded. Details: `workers/ai/README.md`「MCP 登录」.
- Done 2026-10-29: KV `lyjwpage-oauth` (id c17f49a72cff4523ac5e0f38e68f6111) created and bound to ai; GitHub App Redirect URI `https://lyjw.me/oauth/github/callback` added via Mac RC after lyjw's sudo passkey, read back. Prod smoke 2026-10-29: PRM/AS metadata, anon 401 challenge, DCR, consent page, 302 to GitHub all OK; the GitHub sign-in itself needs lyjw's browser.
- #755 (0df5f3b, 2026-10-29 08:26 SGT): fixed every signed-in call throwing `RPC receiver does not implement the method "bind"` (never `.bind` a Service Binding method; tests now use an RPC-like Proxy stub) and restyled the consent page to site tokens (test compares with theme.css; font falls back to system mono). E2E passed 08:29 SGT on lyjw's Mac via RC + loopback-redirect script; Mac auto mode refuses to click Allow on lyjw's behalf, so lyjw clicks once.
