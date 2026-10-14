---
name: handoff-carry-user-constraints
description: When handing work to another session (thread brief, relay, Mac RC brief), route a follow-up once, relay lyjw's latest stance, and carry lyjw's standing constraints; a later relay overrides an earlier one
metadata:
  type: feedback
---

Found by the drift review of 2026-10-13 threads (thread "需求偏差复盘并入例程"): constraints lyjw had already stated got lost at hand-offs, three times in one day.
- The digest card's Mac UI session re-added the gray "Last 24 hours" line lyjw had asked to delete; its brief didn't carry that request.
- The "quiet day → old clock" ask was relayed to the busy digest headline thread ("same PR or separate, your call"); lyjw objected ("你别给他了吧，他在跟进那一个提示语替换呀。你换一个人去") and the relay was retracted 22 s later, but the headline thread had already built it into #233 and had to revert it.
- lyjw's "或者也不用 有点像Apple那个宣传语风格" (dropping calligraphy) was relayed as "calligraphy or tagline, show both"; the thread built and recommended calligraphy, which lyjw then called "太蠢".
- The "iOS is paused" rule reached only threads running at the time; a thread opened later edited iOS display code until a bot review caught it.
- "改个文档别等它审了" said in one thread didn't reach the next docs PRs (#209, #230) until the coordinator relayed it.

**Why:** a session only sees its brief and relays; anything not in them is lost, and lyjw has to say it again.

**How to apply:**
- Coordinator: decide a follow-up's thread once before relaying; don't hand a new ask to a thread busy with something else. If lyjw's message starts its own thread, don't also send it elsewhere.
- Relay lyjw's latest stance, not a concatenation: when a later message drops or replaces an option ("或者也不用…"), the relay says so and leaves the dropped option out.
- A brief carries the standing rules and constraints for the area (things lyjw removed, rejected or set; project-wide rules such as iOS paused), copied from lyjw's words or pointing to the memory entry.
- Thread: before pushing or reporting, re-read relays received since you started; a later relay that retracts or reroutes wins. Mac RC briefs list lyjw's earlier requests for the area (see `.claude/skills/lyjwpage-mac-session/SKILL.md`).
