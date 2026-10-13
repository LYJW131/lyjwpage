---
name: core-cron-internal-error
description: core Worker cron dispatch fails with internalError (0 CPU) since 2026-10-13 13:07Z; separate Sentry-11 heartbeat timeout since 10-12 18:05Z; how to check
metadata:
  type: project
---

Found 2026-10-13 18:5xZ (thread "core 定时任务停跑"):
- core cron `2,7,...,57 * * * *` fires every slot but every run since 13:07Z is `internalError`, cpuTimeUs 0 (GraphQL `workersInvocationsScheduled` filtered by `cron`; rows show scriptName `__unknown__`). Started right after the old api Worker was deleted and core moved to Builds Previews. A Builds redeploy (re-PUT of schedules) did not fix it. Pending fix: delete and re-add core's schedule (needs the owner's OK; auto mode blocked it), else drive the 5-min tick from collector over a Service Binding.
- Separate: Sentry monitor `api-minute-cron` shows `timeout` (in_progress, no close) from ~10-12 18:05Z while CF runs succeeded; suspect the Sentry 11 upgrade (#184, merged 17:57Z). Not reproduced yet.
- Gotcha: GraphQL `workersInvocationsScheduled.scriptName` is unreliable (collector runs got labeled `core` around deploys), so filter by `cron`, not scriptName. Observability telemetry query (group by `$workers.eventType`) is the reliable per-script check.
- Ingest (iOS, agents) goes via ingress → core RPC and is unaffected; the cron-driven pulse archive, scoring and freshness alerts are what stopped.
