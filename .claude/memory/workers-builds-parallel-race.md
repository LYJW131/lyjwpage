---
name: workers-builds-parallel-race
description: Two merges to main ~1 min apart can leave production site on the OLDER commit (Workers Builds builds in parallel, last finisher wins)
metadata:
  type: project
---

Observed 2026-10-13: #195 (9f4be84) and #199 (50702f8) merged ~1 min apart. Workers Builds built both site versions in parallel; 50702f8 deployed 03:45:13Z, then older 9f4be84 deployed 03:45:28Z and stayed live. purge-esa.yml's run for 50702f8 timed out in "Wait for the source domain" (that is the visible symptom). Two threads each rebuilt 50702f8 (03:56Z, 03:57Z); both deployed fine.

**Why:** a merged PR is not "deployed" just because its own `Workers Builds: site` check is green.

**How to apply:** after merging, compare `https://lyjw.me/api/version` commit with main HEAD, not just the check. If it is older, the remedy is a Workers Builds rebuild of main (Cloudflare API `POST /accounts/{id}/builds/triggers/{trigger}/builds`), never `wrangler deploy`; it is a production action, so get lyjw's OK first. Related: [[lyjwpage-daily-review-routine]], [[same-origin-api-assessment]].

Rebuild details:
- Body must be `{"branch":"main","commit_hash":"<40-char sha>"}`. With only `branch`, the build sees commit "main", scripts/site-preview.mjs#sitePreviewManifest throws, and the Sentry plugin has already uploaded source maps under release "main".
- Trigger uuid: `GET /accounts/{id}/builds/workers/{script_tag}/triggers` (site tag in docs/ops-facts.md).
- First list `GET .../builds/workers/{script_tag}/builds`: another thread may already be rebuilding HEAD.
- A manual build still posts the `Workers Builds: site` check run, so purge-esa.yml refreshes ESA and sends the version event on its own.

Also seen 2026-10-13 (PR #203): branch Previews builds can hang at "Cloning repository..." for minutes (normal clone ~5s). The site preview build then fails after `scripts/build.mjs` WAIT_MS waiting for the api Preview. Fix: cancel the hung build (`PUT .../builds/builds/{uuid}/cancel`) and start a new one on the same trigger with branch + commit_hash; rebuild api first, then site. Preview builds are not production, so no lyjw OK needed.

Missed triggers (investigated 2026-10-21, thread「Cloudflare 构建不自动触发」): pushes that start no build at all are GitHub webhook delays/drops, not repo or Cloudflare config (every trigger and Preview has auto_build true, watch paths match `scripts/build-watch-paths.ts`). Seen: 2026-10-21 GitHub incident "Delays for Pull Requests and Webhook deliveries" (declared 14:52Z): PR #533 branch pushes 265eef0/0a35cd2/82e4324 (14:21-14:35Z) got no core/site Preview build; #533's main merge (15:31Z) got its site build 15 min late (15:46Z); #534 (0884747, 15:46Z) never got one, rebuilt manually 16:00Z. Also 2026-10-20 21:05Z: 8b0bc90 (ai) and eee5abf (site) merged 4 s apart, neither built (docs/test only, no runtime impact, no incident posted). First check https://www.githubstatus.com when a push has no build. Check the builds list, not only /api/version. **Missed trigger → rebuild at once, no asking** (lyjw 2026-10-22 00:05 SGT「发现漏了直接补」): when a push started no build, rebuild main HEAD (or the branch Preview) right away with branch + full commit_hash. `.github/workflows/builds-watchdog.yml` does this every 30 min too. A race where an older build finished last still asks lyjw first (HUMAN.md). If the auto-mode classifier blocks the POST, quote lyjw's message in the thread and retry.
