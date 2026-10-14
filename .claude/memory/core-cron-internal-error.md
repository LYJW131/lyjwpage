---
name: core-cron-internal-error
description: core's Cloudflare cron died with internalError (2026-10-13); collector now drives core's 5-min round via StateCore.cronRound; Sentry check-in timeout root cause
metadata:
  type: project
---

Thread "core 定时任务停跑" (2026-10-13):
- From 13:07Z every Cloudflare cron dispatch to core was `internalError` with 0 CPU. It started right after the old api Worker was deleted and core moved to Builds Previews; a redeploy did not help. Fixed by NOT using a CF cron on core: #269 (live 19:15Z) has collector call `CORE.cronRound(scheduledTime)` every minute (`workers/collector/src/core-round.ts`), and core runs the round only on due minutes; core `crons = []`. A reset of the CF schedule is no longer needed. Don't add the cron back, or each round runs twice.
- Separate Sentry `api-minute-cron` timeouts (in_progress, never ok) since the Sentry 11 upgrade (#184): `Sentry.withMonitor` forks the isolation scope, so @sentry/cloudflare loses the invocation's waitUntil and the ok check-in fetch gets cancelled when the call returns. Fix: `shared/cron-check-ins.ts#cronCheckIns` (manual check-ins, flush after each), PR #271. Never reintroduce `Sentry.withMonitor` in Workers.
- Gotcha: GraphQL `workersInvocationsScheduled.scriptName` is unreliable; filter by `cron`. Workers Observability telemetry (group by `$workers.eventType`) is the reliable per-script check.
- Ingest (iOS, agents) goes via ingress → core RPC and was unaffected; only pulse archive, scoring and stale-feed alerts stopped.
