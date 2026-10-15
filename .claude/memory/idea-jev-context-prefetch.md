---
name: idea-jev-context-prefetch
description: Parked long-term idea (lyjw 2026-10-15): let Jev, which classifies chat messages before sending, also pick and prefetch a short context summary (site intro, README, tool list, site status) into the first model call
metadata:
  type: project
---

lyjw 2026-10-15 22:09 SGT, said "先记录一下，然后先不做": Jev already classifies a chat message before it is sent. Extend it so that when Jev judges the question needs known context (site intro, README, the search/tool list, or "what's the current state of X on the site"), it attaches a short summary of that context to the first API call, chosen per message, so the model does not have to come back and search/call a tool for it.

**Status:** parked. Do not start it until lyjw asks. Related: chat routing and web search in `workers/ai/src/chat/`, Jev on Workers AI as `typesafe/jev`.

**How to apply:** when lyjw brings up chat latency, Jev, or prompt context again, mention this idea; the coordinator can list it when asked what's parked.
