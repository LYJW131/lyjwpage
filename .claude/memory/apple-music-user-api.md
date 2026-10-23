---
name: apple-music-user-api
description: Apple Music user API through cloud egress injection: Replay endpoint and its limits, how to read Apple's docs, endpoint list, trial cards
metadata:
  type: reference
---

Apple Music user API via egress injection (api.music.apple.com /v1/; the proxy adds the tokens). Replay: `GET /v1/me/music-summaries?filter[year]=latest&views=top-songs,top-artists,top-albums` returns 100 ranked songs, no play counts; only 2026 has data. Read Apple's docs by appending `.md` to the page URL (lyjw 2026-10-23; no Context7, no third-party MCP). Endpoint list: /mnt/project-files/apple-music-api/endpoints.md. Trial cards live at /lab/apple-music on a branch; thread「Apple Music 年度最爱歌曲」. Server-side Apple Music lookups live in collector: [[apple-music-to-collector]].
