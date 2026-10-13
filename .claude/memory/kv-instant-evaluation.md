---
name: kv-instant-evaluation
description: Workers KV Instant (Quicksilver mode, private beta 2026-10-01) evaluated 2026-10-13 for lyjwpage — rejected for LAG and the realtime layer, with numbers
metadata:
  type: project
---

Evaluated https://blog.cloudflare.com/workers-kv-instant/ on 2026-10-13 against Cloudflare KV analytics (last 24h).

KV Instant facts: per-namespace opt-in (`mode: "instant"`), same get/put/list/delete API, no metadata, list unpaginated; 1 write per namespace per second; ≤1 MB and ≤10,000 keys per namespace; writes $0.10 each, reads $0.20/M, storage $100/MB-month; replication p99 ~256 ms; no read-your-writes or atomic read-modify-write stated.

Verdict: does not change the "realtime layer stays in the Durable Object" constraint ([[same-origin-api-assessment]]) — still no transactions/ordering guarantee, and the 1 write/s per namespace cap is tighter than classic. LAG namespace is a bad fit: ~7.4k writes/day (≈$740/day at Instant pricing) and ingress writes server:v1 plus the reporter ledger concurrently, which breaks the 1 write/s cap. Only shape that fits is CREDENTIALS (1 key, ~1 write/day) but the gain is under a minute of staleness after Apple Music token rotation; not worth a private-beta dependency.

**Why:** avoid re-running this evaluation every time KV Instant comes up.
**How to apply:** revisit only if pricing per write drops by orders of magnitude or a per-key (not per-namespace) write limit appears; re-pull KV analytics before deciding.
