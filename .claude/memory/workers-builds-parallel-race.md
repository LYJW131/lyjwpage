---
name: workers-builds-parallel-race
description: Two merges to main ~1 min apart can leave production site on the OLDER commit (Workers Builds builds in parallel, last finisher wins)
metadata:
  type: project
---

Observed 2026-10-13: #195 (9f4be84) and #199 (50702f8) merged ~1 min apart. Workers Builds built both site versions in parallel; 50702f8 deployed 03:45:13Z, then older 9f4be84 deployed 03:45:28Z and stayed live. purge-esa.yml's run for 50702f8 timed out in "Wait for the source domain" (that is the visible symptom). Two threads each rebuilt 50702f8 (03:56Z, 03:57Z); both deployed fine.

**Why:** a merged PR is not "deployed" just because its own `Workers Builds: site` check is green.

**How to apply:** after merging, compare `https://lyjw.me/api/version` commit with main HEAD, not just the check. If it is older, the remedy is a Workers Builds rebuild of main (Cloudflare API `POST /accounts/{id}/builds/triggers/{trigger}/builds`), never `wrangler deploy`; it is a production action, so get the owner's OK. Related: [[lyjwpage-daily-review-routine]], [[same-origin-api-assessment]].

Rebuild details:
- Body must be `{"branch":"main","commit_hash":"<40-char sha>"}`. With only `branch`, the build sees commit "main", scripts/site-preview.mjs#sitePreviewManifest throws, and the Sentry plugin has already uploaded source maps under release "main".
- Trigger uuid: `GET /accounts/{id}/builds/workers/{script_tag}/triggers` (site tag in docs/ops-facts.md).
- First list `GET .../builds/workers/{script_tag}/builds`: another thread may already be rebuilding HEAD.
- A manual build still posts the `Workers Builds: site` check run, so purge-esa.yml refreshes ESA and sends the version event on its own.

Also seen 2026-10-13 (PR #203): branch Previews builds can hang at "Cloning repository..." for minutes (normal clone ~5s). The site preview build then fails after `scripts/build.mjs` WAIT_MS waiting for the api Preview. Fix: cancel the hung build (`PUT .../builds/builds/{uuid}/cancel`) and start a new one on the same trigger with branch + commit_hash; rebuild api first, then site. Preview builds are not production, so no owner OK needed.
