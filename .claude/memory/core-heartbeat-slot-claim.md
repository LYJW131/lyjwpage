---
name: core-heartbeat-slot-claim
description: Core heartbeat bar red 10-22..10-26 was Cloudflare delaying collector's cron; fixed by slot claiming in #675
metadata:
  type: project
---

Thread「查清 cron 连续报错」(2026-10-26). The site's "Core" uptime row (heartbeat series `core-cron`) was below 99% for 5 days. Core never threw. Cloudflare delivered collector's `* * * * *` cron late or not at all (start lateness >60s: ~3/day before 10-21, 194 on 10-23, 127 on 10-25; up to 3.3 h late; ai's cron was late too, so it is platform-side; status page incident 10-23 "Delayed, missed, and duplicated Workers Cron Triggers"). Collector's `isLateRound` (>2 min) skipped the whole round, including `CORE.cronRound`, and core only accepted the exact due minute, so those slots counted as missed = failure.

Fix #675 (merged, live 2026-10-26 ~10:25Z): core `cronSlot` maps any call to its 5-min slot, `StateHub.claimCronSlot` runs each slot once (monotonic watermark), heartbeat recorded at slot start; collector still skips jobs on late rounds but calls core with `Date.now()` (`coreRoundTime`). Replay on 4 days of real deliveries: missed slots 62/29/20 → 6/0/0. Verified: all 5 slots after deploy ran despite an 880 s late delivery.

Follow-up #681 (merged 2026-10-26 ~11:17Z, collector version d7e50a8c): collector jobs no longer skip late rounds. Each job claims its own slot (period/offset) in collector's own DO `CronSlots` (monotonic per job); the first round in a slot runs it, late rounds use `Date.now()` (`registry.ts#roundTime`). Claim failure falls back to exact-due jobs (`collector-slot-claim` warn); no claim timeout on purpose. Expected: slow-period misses (~20% on 10-26) drop to near 0; superfan to confirm. D1 "DB is overloaded" errors first appeared 2026-10-26 09:58Z, a few times; left to [[collector-superfan-routine]].

How to check: Workers Observability, `$workers.eventType=scheduled` for collector, compute (timestamp - wallTimeMs) - scheduledTime; `event=collector-late-round` warns. Related: [[core-cron-internal-error]].
