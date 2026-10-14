---
name: x-api-via-proxy
description: Read X/Twitter through api.x.com directly; the proxy injects lyjw's credentials, so never add a key
metadata:
  type: reference
---

lyjw rule (lyjw, 2026-10-13 16:12Z): "以后请求推特都用这个吧". Requests to `https://api.x.com/2/...` carry lyjw's X API credentials automatically through the session proxy. Do not add a bearer token yourself. x.com web pages return 402 to WebFetch, so use the API instead.

Verified 2026-10-13 in a cloud thread: `GET /2/users/by/username/<name>`, `GET /2/tweets/<id>?tweet.fields=note_tweet,article` (long posts come back in `note_tweet.text`, and X Articles in `article.title` / `article.plain_text`), and `GET /2/users/<id>/tweets?exclude=replies,retweets&max_results=100` with `pagination_token` all returned 200. Video content is not readable through the API.

**How to apply:** any task that needs X posts, profiles or articles calls api.x.com with curl. If a session gets 401/403, that session lacks the injection; say so in one line.
