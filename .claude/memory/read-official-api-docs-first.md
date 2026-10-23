---
name: read-official-api-docs-first
description: Before calling or probing any external API, read its official docs first; guessing endpoints by trial wastes calls
metadata:
  type: feedback
---

lyjw (2026-10-23 16:10 SGT, Apple Music thread): "以后调用api先查官方文档". The thread probed `/v1/me/music-summaries` by guesswork before reading the docs; the docs (Get the user's replay data) had the answer (`filter[year]=latest`, `views`).

**Why:** trial-and-error burns calls and misses documented options.
**How to apply:** for any external API (Apple Music, X, Cloudflare, etc.), fetch the official reference first. **Apple docs: append `.md` to the page URL** (lyjw 2026-10-23 16:13 SGT "读Apple用md就行"), e.g. `https://developer.apple.com/documentation/applemusicapi.md`, `.../musickit.md`; the HTML is JS-rendered and unreadable. No Context7 or third-party MCP needed. Matches AGENTS.md rule on reading official docs before judging what a service can do.
