---
name: idea-jev-context-prefetch
description: Chat context prefetch: lyjw's parked 2026-10-15 idea (prefetch site intro/README/status into the first model call) was built in #384 with Clef instead of Jev
metadata:
  type: project
---

lyjw 2026-10-15 22:09 SGT parked the idea: before the first chat model call, pick and prefetch the context a question needs (site status, project docs) so the model does not have to call a tool for it.

**Status:** built in #384 (merged 2026-10-17 SGT). Clef answers two extra questions in the same routing call (which status group, which project doc); a pick at or above `PREFETCH_MIN_PROBABILITY` is prefetched as a tool round. Home-page presets carry fixed `prefetch` lists. Jev is not used for it. Details: workers/ai/README.md (Clef 选档 paragraph), `src/chat/router.ts`.

**How to apply:** for chat latency or prefetch tuning, start from `pnpm --dir workers/ai route:probe`; don't re-propose the idea as new.
