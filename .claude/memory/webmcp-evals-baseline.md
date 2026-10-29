---
name: webmcp-evals-baseline
description: WebMCP eval CLI tried 2026-10-29 on lyjw.me tools — 70/70 pass; how to rerun; not in CI by lyjw's choice
metadata:
  type: project
---

2026-10-29 07:45 (SGT) ran GoogleChromeLabs/webmcp-tools `webmcp-evals` (experimental) `local` mode, Gemini 3.5 Flash, 14 cases × 5 runs over `get_site_status` + `ask_homepage_chat`: 70/70 pass, incl. nowListening vs listening, codingNow vs codingYear. lyjw: just record it, no CI, no repo change.

Files: /mnt/project-files/webmcp-evals/ (schema.json, evals.json, proxy.mjs). Rerun: clone repo, `npm i && npm run build`, add undici; Node 22 fetch ignores HTTPS_PROXY so preload proxy.mjs: `GOOGLE_AI=dummy NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node --import proxy.mjs dist/bin/webmcp-evals.js local -b gemini -m gemini-3.5-flash -r 5 -t schema.json -e evals.json` (Gemini key injected by egress proxy). schema.json view enum must match `shared/status-views.ts#STATUS_VIEWS`.

Gaps: browser/smoke modes untested (need Chrome Canary + WebMCP flag); cases are easy, add vague questions to find weak spots. Rerun by hand when tool descriptions change.
