---
name: sentry-exit-done
description: Sentry fully removed (PR #198 merged 2026-10-14); what replaced it, how history was imported, and the owner-gated leftovers
metadata:
  type: project
---

PR #198 merged 2026-10-14 09:49Z (merge 7d35661), live on lyjw.me and lyjw131.com. The site status card's two uptime rows come from collector `uptime-probe` + core heartbeat (`StateCore.cronRound`) in D1 `health_buckets`; error counts and active issues from Workers Observability (token `CLOUDFLARE_METRICS_TOKEN`; which token it is and its permissions live only in `docs/ops-facts.md`); real-visitor p75 from Web Analytics; all served as `/api/status/health` (LAG `health:v1`, collector `site-health` every 5 min at minute 4). Browser errors POST to `https://lyjw.me/relay` (also from lyjw131.com pages) and land as `[browser-error]` logs under service `site`.

History: Sentry's last snapshot (`sentry:v1`, fetched 09:47:44Z) is saved at `/mnt/project-files/sentry-exit/import/`, with the cron-hours file and the SQL. 1002 hourly buckets were imported into production D1 on 2026-10-14 ~10:05Z (site-uptime 515, core-cron 487; core-cron failures 85, mostly the real 10-13 13–19Z outage). Re-running it is a no-op. Gotcha: pass `--cutover` as the new link's first *scheduled minute* minus 1 ms, not raw `MIN(first_at)`. Otherwise the cutover minute shows up both as a Sentry "missed" and as a new success.

The site error count is much higher than Sentry's was (35 in 12h vs Sentry's 6), because level=error now includes every `/image` proxy failure on Apple blobstore URLs and "Can't read from request stream after response has been sent." These are real pre-existing errors, not a regression. The 7d count also still carries old Sentry-tunnel `POST /relay` failures until they age out.

**Still waiting on the owner (all listed in the #198 body):** delete Workers Builds env `SENTRY_AUTH_TOKEN` and collector secret `SENTRY_API_TOKEN`; set up Workers Issues alert automation; clean up the Sentry project. Don't do these without asking first.

**How to apply:** for any "where do the uptime/error numbers come from" question, or when touching health/relay code, start here. See [[collector-superfan-routine]] for the error triage loop.
