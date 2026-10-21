---
name: devin-free-tier-limit
description: Devin CLI free-tier rate limit (swe-2-max) is one account-wide bucket; run about 6 sessions, not 25
metadata:
  type: reference
---

Observed 2026-10-21 in the security-audit thread (25 Devin swe-2-max sessions at once):
- The free-tier limit is one bucket shared by the whole account, not a per-session concurrency cap. Every session shows the same reset time ("Reached free model rate limit … reset in N minutes (at HH:MM UTC)"), so when it trips, all sessions stop together.
- There are two tiers: short resets of a few minutes, and a longer one of about 1.5 hours once the short ones keep tripping (seen 04:34 → 06:01 UTC).
- Retrying before the reset doesn't help. A poller should hold every session until the reset time shown on any one of them.
- Running more sessions doesn't raise throughput; it burns the bucket faster. lyjw (2026-10-21 13:29 SGT): "开到一个比较合适的并发就行了，也不用往死里开" → cap at about 6 active sessions.

**How to apply:** for fan-out Devin work (skill lyjwpage-devin-dispatch), keep about 6 active and queue the rest. lyjw is fine with slow free runs ("反正不要钱 慢慢跑就行", same day).
