---
name: routines-pause-when-project-idle
description: Project routines stop firing while lyjw is away from the project and catch up once (one fire each) after lyjw comes back; seen 11-01→11-03, 11-04→11-10, 11-10→11-11
metadata:
  type: project
---

Checked 2026-11-10 (thread「查定时任务整周没触发」). All six routines bound to project thread sessions stopped firing twice, while triggers stayed enabled, `suspension_reason` empty, every `last_run` SUCCEEDED, and the 7-day usage window at 19% (not a limit):

- Gap 1: after collector 11-01 13:53 SGT → resumed 11-03 ~07:28 SGT (catch-up fires). lyjw was back in the project then (a thread resolved 11-03 08:03 SGT).
- Gap 2: after skill-mining 11-04 04:54 SGT → resumed 11-10 04:00 SGT. lyjw wrote in project chat 11-10 03:39 SGT; the coordinator session was recreated at that message; routines then fired 04:00–04:41 SGT.

- Gap 3: 11-10 04:49 SGT onward (about 45 min after lyjw's last message), until lyjw came back 11-11 ~00:16 SGT. It cut the Anthropic 动态 catch-up run mid-work (run record stuck at「开始」, no 2026-11-10.md; bookmarks not advanced, so the next run covers it). A one-shot send_later reminder in a thread was delayed 21 h the same way.

On resume each missed routine fires once (no backfill per missed day), queued at resume time, not earlier. Session transcripts show no wake was ever queued during the gaps, so the scheduler did not fire (not a delivery or session failure). Cause is platform-side, inferred from timing: routines in a project whose owner is idle go dormant. No official doc found.

**How to apply:** a routine gap that lines up with lyjw being away is this, not a broken trigger/session; don't re-create triggers ([[routine-bindings]]). Nothing in our control fixes it; report gaps as「平台在项目闲置时暂停」. Morning report on a catch-up day may run before Anthropic 动态 and miss that day's file.
