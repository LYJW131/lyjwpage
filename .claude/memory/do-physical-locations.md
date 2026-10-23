---
name: do-physical-locations
description: Where each production Durable Object of lyjwpage physically runs (colo), checked 2026-10-23 via GraphQL durableObjectsPeriodicGroups, plus how to re-check
metadata:
  type: project
---

Checked 2026-10-23 23:55 (SGT) at lyjw's request. Source: Cloudflare GraphQL `durableObjectsPeriodicGroups` grouped by `namespaceId, name, coloCode` (last 30 days), production namespaces taken from `GET /workers/scripts/{core,ai}/settings` bindings. No jurisdiction is set anywhere.

| Worker / class | Object name | locationHint | Colo |
| --- | --- | --- | --- |
| core StateHub | global | none | KIX (Osaka) since ≥09-23, stable |
| core LivePushRoom | global-apac | apac | NRT (Tokyo) since 10-02 (old `global` room was AMS) |
| ai ChatQuota | global | none | NRT |
| ai AnthropicEgress | anthropic-jp-0 (in use) | apac | NRT 10-16..17, then KIX from 10-18 |
| ai AnthropicEgress | anthropic-wnam (fallback) | wnam | DEN (one day DFW, 10-15) |
| ai ChatLog | global | none | SEA (Seattle) |
| ai BuildCoordinator | global | none | DFW (Dallas) |

Notes: objects without a hint were placed near whoever first called them, so ChatLog / BuildCoordinator sit in the US although lyjw and visitors are mostly in Asia. Objects can move between colos inside a region (anthropic-jp-0 NRT→KIX) although docs say DOs do not relocate across regions. Many extra `core` namespaces are branch-preview copies; ignore them.

**Why:** lyjw asked "我们现在用的 DO 都在哪个物理地区"; no earlier record existed.
**How to apply:** answer from this table; to refresh, rerun the same GraphQL query via Cloudflare Code Mode MCP (production namespace ids from script settings). Moving ChatLog/BuildCoordinator would need a new object name with a hint (data does not migrate).
