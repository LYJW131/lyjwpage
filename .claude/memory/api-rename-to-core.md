---
name: api-rename-to-core
description: api Worker → core rename (PR #227) fully done 2026-10-13: live, old api Worker deleted, core branch builds on Builds Previews
metadata:
  type: project
---

User chose (2026-10-12, decision card) to rename the api Worker to `core` (dir workers/core) via a new Worker with legacy `transferred_classes` (StateHub, LivePushRoom from_script "api"), not a dashboard rename (Cloudflare doesn't document its effect on DO namespaces or bindings).

**Done 2026-10-13:** PR #227 merged (5a41c1b). The core Worker was deployed manually first and the DO transfer kept the namespace IDs. Site, ingress, collector and ai redeployed on bindings to core at ~12:56Z. Traffic moved off api: Workers analytics showed api requests dropping to ~0. The core cron is active; api's schedules are empty and its Builds are disconnected.

**Finished 13:0xZ (owner said 旧的删掉吧 / 改成新版吧):** the old `api` Worker was deleted via the Cloudflare API, along with all its branch-preview DO namespaces. First checked that no Worker binding pointed at api, and production endpoints were 200 afterwards. The Mac Remote Control session migrated core to Builds Previews (`migrate_to_previews`, then PATCH of the wide `previews_base_config`); the legacy trigger is gone. Both are recorded in `docs/ops-facts.md`.

**Branches cut before #227 (seen 12:42Z):** their branch preview builds fail. The core preview command doesn't exist on those branches, and the site build waits for an `-api` Preview, so `Workers Builds: core` and `Workers Builds: site` go red. It is not that PR's fault. Merge main into the branch; don't rerun the check (#232 merged this way).

**Gotchas seen:**
- Workers analytics shows the new core script as `__unknown__` at first.
- Auto mode on the Mac blocks `wrangler deploy`. Cloud and Mac auto mode blocked Cloudflare API writes at first; once the owner gave an explicit, specific instruction in the thread (删 api, 改成新版), the writes went through.
