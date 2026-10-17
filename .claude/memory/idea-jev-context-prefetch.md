---
name: idea-jev-context-prefetch
description: Chat routing also picks data to prefetch into the first model call (issue #372 item 2, lyjw approved 2026-10-17); origin was the parked Jev context-prefetch idea
metadata:
  type: project
---

lyjw 2026-10-15 22:09 SGT, said "先记录一下，然后先不做": Jev already classifies a chat message before it is sent. Extend it so that when Jev judges the question needs known context (site intro, README, the search/tool list, or "what's the current state of X on the site"), it attaches a short summary of that context to the first API call, chosen per message, so the model does not have to come back and search/call a tool for it.

**Status:** lyjw asked to build it as issue #372 item 2 on 2026-10-17. Built with Clef (the router), not Jev: the routing call asks two extra choice questions (status view group, project doc) and prefetches only above a probability bar; web search is not prefetched because Clef cannot write a query. It injects the raw tool results, not a summary. Code facts live in `workers/ai/README.md` (首页对话).

**How to apply:** if prefetch hit rate or wrong picks come up, read the `[god-chat] prefetch` logs and rerun `pnpm --dir workers/ai route:probe` before changing criteria.
