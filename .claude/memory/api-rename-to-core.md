---
name: api-rename-to-core
description: User chose to rename the api Worker to core as the very last step, via a new Worker with transferred DO classes, not a dashboard rename
metadata:
  type: project
---

User chose (2026-10-12, decision card) to rename the api Worker to `core` (dir workers/core) as the very last step, after [[apple-music-to-collector]] and domain retirement in [[same-origin-api-assessment]], so no secrets or routes move.

Method: a new Worker with legacy `transferred_classes` (StateHub, LivePushRoom from_script "api"), then switch site/collector/ingress/ai bindings, then delete api.

**Why:** not a dashboard rename, because Cloudflare doesn't document its effect on DO namespaces or other Workers' bindings.
**How to apply:** don't start it before the earlier series are done; plan the DO transfer like the existing `v1-transfer-from-ingest` migration.
