---
name: devin-free-tier-limit
description: Devin dispatch model choice (Fusion High while Pro quota lasts, swe-2-max fallback) and the free-tier rate bucket; run about 6 sessions
metadata:
  type: reference
---

**Model choice (lyjw 2026-10-21 15:59 SGT):** "我Devin限额还有的时候 可以选fusion high 不需要给我留 这个订阅计划是专门给你调度subagent开的". The Devin Pro plan exists for Claude's dispatching; don't save quota for lyjw.
- Fusion High = `fusion-claude-fable-5-1-high-sidekick-swe-2-medium` (default lead Claude Fable 5.1 in the `/fusion` picker, High effort, free SWE-2 Medium sidekick). Use it while `dv usage` shows Daily and Weekly both under 90% used.
- Quota out (either ≥90%, or a session hits a quota error): new tasks use `swe-2-max` (Free; one tiny swe-2-max turn did not move `/usage`), running ones switch with `dv model <name> swe-2-max`. Switch back after the reset shown by `dv usage`.
- Quota is read with `/usage` in the REPL (`dv usage` wraps it). One tiny Fusion High turn cost 1% of Daily (2026-10-21).

**Free-tier rate bucket** (observed 2026-10-21, security-audit thread, 25 swe-2-max sessions at once):
- One bucket for the whole account, not a per-session cap. Every session shows the same reset time ("Reached free model rate limit … reset in N minutes (at HH:MM UTC)"), so all stop together.
- Two tiers: short resets of a few minutes, then about 1.5 hours once the short ones keep tripping (04:34 → 06:01 UTC).
- Retrying before the reset doesn't help; hold every session until the reset time.
- More sessions don't raise throughput. lyjw (2026-10-21 13:29 SGT): "开到一个比较合适的并发就行了，也不用往死里开".

**How to apply:** skill lyjwpage-devin-dispatch「选模型」. Keep about 6 active sessions either way and queue the rest (free: rate bucket; Fusion: burns quota faster).
