---
name: same-origin-api-assessment
description: Retiring api.homepage.lyjw.llc and re-dividing Worker roles (site as the only public read edge); done 2026-10-13: #195/#196/#206/#219/#221 merged, api custom domain deleted, api has no public address
metadata:
  type: project
---

Docs: /mnt/project-files/same-origin-api/worker-roles.md (plan, traffic numbers), assessment.md (must-fix items), apple-music.md (AM research).

Plan: site = only public read edge; serves the 12 lag views from LAG KV itself; realtime views, /ws, Apple lookups, MusicKit token → api via Service Binding; chat/build/MCP/webhook → ai via binding. api/ai end with no public surface; ingress unchanged. User said the old "site 不做数据端点" rule was a Vercel leftover and api should become a small realtime-layer backend.

Status 2026-10-13: #196 and #195 merged and deployed; all 27 STATUS_VIEWS match on both domains, /ws, lyrics, MusicKit, chat usage and /mcp work via lyjw.me. /count is only on the api domain; agents-reporter reads SITE_URL/api/status/coding/now (SITE_URL = api origin today): decide both at domain retirement.

PR 2 (flip PUBLIC_BACKEND_URL to lyjw.me): user asked whether realtime should stay on the api domain; found no benefit (realtime poll 290 ms via site vs 293 direct; bindings not billed as requests on the standard usage model; /ws drops 3 via site vs 2 direct over ~110 connection-min). User chose (05:02) "统一走站点 推进到合并进main". PR #206 merged 2026-10-13 05:39Z as 9bb7819 (commit A d6ad2e6 code+docs, commit B regenerated diagram); site and api builds succeeded, lyjw.me and lyjw131.com both serve 9bb7819, all browser /api and /ws traffic goes to lyjw.me, no new Sentry errors; site Workers Builds has no PUBLIC_BACKEND_URL build var, so the vite default decides the bundle. Container Chromium gets 426 on every wss:// (proxy strips the upgrade, api domain too): e2e bridges /ws via Playwright routeWebSocket + Node ws through HttpsProxyAgent. External consumers (iOS, agents-reporter SITE_URL, GitHub webhook, build sandbox allowlist) and domain retirement still need approval.

Domain retirement DONE 2026-10-13 (user said "改 agents-reporter 并下线 api 旧域名"): #219 moved repo refs (UPSTREAM_API_URL, build sandbox) to lyjw.me; misaka-jp agents-reporter SITE_URL=https://lyjw.me; user's 11 local .dev.vars switched; GitHub App webhook → https://lyjw.me/api/build/webhook (deliveries 200 from 09:48Z). #221 (0585c34) dropped routes, workers_dev=false, preview_urls=true; removing routes did NOT detach the domain, so it was deleted via Cloudflare API workers/domains after deploy. Verified: old host no DNS, api.lyjw.workers.dev 1042, lyjw.me status/ws/chat usage/webhook OK. iOS in-app status & widgets now dead (accepted, iOS reporter-only). ops-facts api row + build-routine callback origin in PR #223 (merged eea6fee). Explainer animation still shows the old domain (not changed; fix on next animation update). Optional later: drop api's AI_SERVICE forwarding (preview-entry, dev-router, verify-api-worker rework), then [[api-rename-to-core]].

Later series: [[apple-music-to-collector]], then [[api-rename-to-core]]. Before touching routing read [[same-origin-api-traps]]; after each merge check the deployed commit: [[workers-builds-parallel-race]].
