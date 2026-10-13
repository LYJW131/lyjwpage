---
name: api-rename-to-core
description: api Worker → core rename (PR #227) merged and live 2026-10-13; old api Worker still exists, deletion waits for the owner's go; core branch builds use a legacy trigger
metadata:
  type: project
---

User chose (2026-10-12, decision card) to rename the api Worker to `core` (dir workers/core) via a new Worker with legacy `transferred_classes` (StateHub, LivePushRoom from_script "api"), not a dashboard rename (Cloudflare doesn't document its effect on DO namespaces or bindings).

**Done 2026-10-13:** PR #227 merged (5a41c1b). The core Worker was deployed manually first and the DO transfer kept the namespace IDs. Site, ingress, collector and ai redeployed on bindings to core at ~12:56Z. Traffic moved off api: Workers analytics showed api requests dropping to ~0. The core cron is active; api's schedules are empty and its Builds are disconnected.

**Open items:**
- Deleting the old `api` Worker (and its leftover branch previews) waits for the owner's explicit go.
- core branch builds run through the legacy "Deploy non-production branches" trigger: `previews_enabled=false`, paths `*`. So no PR preview-URL comment appears, and every branch push builds a core preview. `docs/workers-builds.md` describes the target (Builds Previews with wide `previews_base_config`); the gap is recorded in `docs/ops-facts.md`. To fix it, call `POST builds/workers/{core tag}/migrate_to_previews` and then PATCH the paths. Auto mode blocked both the cloud and Mac sessions from doing this; it needs owner approval of the CF execute tool or a dashboard change.

**Branches cut before #227 (seen 12:42Z):** their branch preview builds fail. The core preview command doesn't exist on those branches, and the site build waits for an `-api` Preview, so `Workers Builds: core` and `Workers Builds: site` go red. It is not that PR's fault. Merge main into the branch; don't rerun the check (#232 merged this way).

**Gotchas seen:**
- Workers analytics shows the new core script as `__unknown__` at first.
- Auto mode on the Mac blocks `wrangler deploy`, and in cloud it blocks Cloudflare API writes, even after the user says go. The owner did the dashboard steps.
