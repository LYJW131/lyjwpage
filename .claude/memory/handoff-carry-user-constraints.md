---
name: handoff-carry-user-constraints
description: When handing work to another session (thread brief, relay, Mac RC brief), route a user follow-up once and carry the user's earlier constraints verbatim; a later relay overrides an earlier one
metadata:
  type: feedback
---

Found by the drift review of 2026-10-13 threads (thread "需求偏差复盘并入例程"): constraints the user had already stated got lost at hand-offs, three times in one day.
- The digest card's Mac UI session re-added the gray "Last 24 hours" line the user had asked to delete; its brief didn't carry that request.
- The "quiet day → old clock" ask was relayed to the digest headline thread as "same PR or separate, your call", then retracted 22 s later because the user had started its own thread; the headline thread had already built it into #233 and had to revert it.
- "改个文档别等它审了" said in one thread didn't reach the next docs PRs (#209, #230) until the coordinator relayed it.

**Why:** a session only sees its brief and relays; anything not in them is lost, and the user has to say it again.

**How to apply:**
- Coordinator: decide a follow-up's thread once before relaying. If the user's message starts its own thread, don't also send it elsewhere. A brief carries the user's standing constraints for the area (things they removed, rejected, or set), copied from their words.
- Thread: before pushing or reporting, re-read relays received since you started; a later relay that retracts or reroutes wins. Mac RC briefs list the user's earlier requests for the area (see `.claude/skills/lyjwpage-mac-session/SKILL.md`).
