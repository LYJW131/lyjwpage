---
name: no-config-route-first
description: Before asking lyjw to change any setting (cloud env, Network secret, console), first offer a route that needs no config change, e.g. Cloudflare MCP; and check the setting is editable
metadata:
  type: feedback
---

2026-11-11 02:26 SGT, thread「限额图加重置卡使用预测」: I asked lyjw to change the cloud Network secret path prefix for a new ingress endpoint. The prefix can't be edited (only rotated), lyjw deleted the old entry to redo it, and only then I proposed writing the value straight to KV via Cloudflare Code Mode MCP, which needs no config at all. lyjw:「你有这种事情为什么不早说啊 还要我改东西」.

**Why:** every setting lyjw has to touch costs lyjw time and can break other things (that Network secret also carries cloud Devin OTLP).
**How to apply:** when a design needs lyjw to change a setting, first list routes that need none (Cloudflare MCP on KV/D1, existing credentials, existing paths) and lead with that; if a setting change is still best, check from docs whether the field is editable and name everything else that depends on it, all in the first ask. Related: [[credentials-pipe-only]], [[no-edge-case-hardening]].
