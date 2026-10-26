---
name: x-api-via-proxy
description: Read X/Twitter through api.x.com directly; the proxy injects lyjw's credentials, so never add a key
metadata:
  type: reference
---

lyjw rule (lyjw, 2026-10-13 16:12Z): "以后请求推特都用这个吧". Requests to `https://api.x.com/2/...` carry lyjw's X API credentials automatically through the session proxy. Do not add a bearer token yourself. x.com web pages return 402 to WebFetch, so use the API instead.

Verified 2026-10-13 in a cloud thread: `GET /2/users/by/username/<name>`, `GET /2/tweets/<id>?tweet.fields=note_tweet,article` (long posts come back in `note_tweet.text`, and X Articles in `article.title` / `article.plain_text`), and `GET /2/users/<id>/tweets?exclude=replies,retweets&max_results=100` with `pagination_token` all returned 200. Video content is not readable through the API.

Probed 2026-10-26 18:50 SGT: the injected credential is OAuth 2.0 App-only. `GET /2/users/me` returns 403 "Unsupported Authentication", so bookmarks, likes and other user-context endpoints are unreachable. The agent proxy's secret types (Bearer, Basic, body param, SigV4, GCP, OAuth2 JWT/client-credentials) cannot sign OAuth 1.0a nor refresh an OAuth 2.0 user token (2 h lifetime), so user-context access needs a relay that holds the user token. Solved 2026-10-26 19:40 SGT via the Cloudflare MCP Portal connector to X official MCP: [[x-mcp-portal]].

**How to apply:** prefer [[x-mcp-portal]] for all X lookups; use this proxy only when that connector is missing. Any task that needs X posts, profiles or articles calls api.x.com with curl. If a session gets 401/403, that session lacks the injection; say so in one line.
