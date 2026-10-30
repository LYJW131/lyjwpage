---
name: private-data-inventory
description: What the site stores but does not publish (D1 forever, DO stripped fields, chat/visitor logs) and who may read it: only lyjwhub's lyjwpage plugin via Service Binding (2026-10-30; /mcp OAuth removed)
metadata:
  type: project
---

Audit 2026-10-29 07:00 SGT (thread「盘点站点存了但没公开的数据」):
- Since #742 no public endpoint reads D1 `lyjwpage-history`; limits history reads StateHub (`LIMIT_HOURS_TTL_MS`). D1 is kept forever, backup only.
- Not public: D1 coding_observations (Mac foreground app history, since 2026-09-21), listening_plays (title/artist/album/source), watching/game sessions, charging samples/sessions with device names, workouts heart rate (stripped by `shared/workouts.ts#publicWorkout`), daily rings, usage per source×agent×model with cost, all-vendor limit snapshots, server_hours, site_deploys. DO: charger serial numbers, queue tracks, Quest discordStatus. KV CREDENTIALS Apple Music user token.
- Chat transcripts 30 days (ChatLog), IP quota 60 s, build runs keep GitHub login/id 30 days.
- Public more than expected: `watching/now` Emby client/device/media; `trophies?titleids=` incl. hidden trophy details; R2 `/img/<hash>` never deleted. lyjw has not decided whether to tighten.

Private-history reader (lyjw 2026-10-30 changed plan, relayed from the lyjwhub Mac session:「撤掉前段时间加上的可选的带鉴权的mcp 包括后续code mode」「直接把能调隐私数据的那些能力做成插件 直接走cf内部服务调用」):
- `/mcp` is public, no auth, only public read tools again (PR #778): /mcp OAuth (#751 #755), `read_private_history`, ai's `PRIVATE_HISTORY` binding, Code Mode (#766 #767) and ai's `global_fetch_strictly_public` all removed. Don't re-add sign-in to the site `/mcp`.
- Core `PrivateHistory` entrypoint and `shared/private-history.ts` stay (contract add-only); it is bound to no lyjwpage Worker. Its caller is the lyjwhub repo's lyjwpage plugin Worker `lyjwhub-lyjwpage` via Service Binding, tools `lyjwpage_read_private_history`, `lyjwpage_status` (lyjwhub PR #6). Until that deploys, nothing reads private history.
- External leftovers for lyjw to delete by hand (agents don't): KV `lyjwpage-oauth` (id c17f49a72cff4523ac5e0f38e68f6111); GitHub App Redirect URI `https://lyjw.me/oauth/github/callback`. (ai main-trigger include paths for those two files were removed 2026-10-30 via Cloudflare MCP, #780.)
- History: the OAuth design (ai as AS+resource via workers-oauth-provider, only GitHub id 153256373) lived 2026-10-29 08:09 SGT until #778; see git history and docs/references.md (marked 不再使用).
