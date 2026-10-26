---
name: x-mcp-portal
description: X official MCP via Cloudflare "LYJW MCP Portal" connector reads lyjw's bookmarks and likes (tested 2026-10-26)
metadata:
  type: reference
---

Connector `LYJW MCP Portal` (tools mcp__LYJW_MCP_Portal__portal_codemode_search/execute) wraps X's official MCP, acting as lyjw's X account (@sorrybuttalking, id 1757165334170398720).
Tested 2026-10-26 19:40 (SGT), read-only: `x_get_users_me`, `x_get_users_bookmarks({id,max_results})`, `x_get_users_liked_posts` all work with next_token paging. `x_get_users_bookmark_folders` returns `{}` (no folders). Pass the numeric id literally; results come as `[{type:"text",text:"<json>"}]`.
Toolset also has write tools (post bookmark, DMs, lists) — don't call without lyjw asking. Relates to [[x-api-via-proxy]].

**Default for X (lyjw 2026-10-26 19:42 SGT「以后就用mcp查x了是吧」):** every X lookup (public posts and lyjw's own data) goes through this connector first. Fall back to curl on `api.x.com` (app-only proxy, public data only) only when the connector is missing in a session. The `lyjwpage-anthropic-updates` routine reads X (accounts, plus lyjw's likes and bookmarks) through this connector ([[anthropic-updates-routine]]).
