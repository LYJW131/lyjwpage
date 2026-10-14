---
name: collector-superfan-routine
description: 4x-daily routine where one Claude watches the collector Worker (public /api/status views + Workers Observability, no Sentry) and, since PR #281, also triages new errors from the other Workers; reports to superfan-collector/<date>.md
metadata:
  type: project
---

lyjw said 开 (2026-10-13 18:36Z) to the "superfan" idea from Anthropic's Scion engineering post. Routine `trig_0168pmChkHdm8Fg6KeZbUYxh` ("lyjwpage collector 盯防"), cron `CRON_TZ=Asia/Shanghai 53 1,7,13,19 * * *`, fires into the same session/thread as [[anthropic-updates-routine]] ("Anthropic 官方动态日更 + collector 盯防"). Thin prompt: reads `origin/main:.claude/skills/lyjwpage-collector-superfan/SKILL.md` and runs its `check.py`.

**Data sources (coordinator note 18:36Z):** do NOT build on Sentry, draft PR #198 removes it. Read the site's own `/api/status/*` views that collector writes (thresholds from `shared/freshness.ts`), and Cloudflare Workers Observability via Cloudflare Code Mode MCP: `telemetry/query` events filtered `$workers.scriptName=collector`. Failures log structured `source.event="collector-job"` with job/status/detail/ms (only failures are logged). Warns carry partial-success and `collector-skip`.

**Outer loop (PR #281, lyjw "值得借的都做" 2026-10-14):** skill step 3b also reads level=error events for core/site/ai/ingress, groups them into signatures, triages, reproduces twice with read-only commands, batches related signatures, and only proposes a fix thread (lyjw decides after the morning brief). This is poteto's outer loop, deliberately on Observability instead of Sentry.

**Scope:** read-only, finds what core's `freshness-watch` misses (fresh timestamp, wrong content). Report goes to `/mnt/project-files/superfan-collector/<date>.md` for the morning report. It replies in the thread only for new alert-level findings or a warn open 24h. State lives in `state.json` (lastRunAt, snapshots, ledger).

First finding while building it (2026-10-13 18:40Z): the core Worker's cron had 0 scheduled events since the api→core rename (api's last run 12:53Z), and the heartbeat was down. Reported to the coordinator, outside the superfan's own scope.
