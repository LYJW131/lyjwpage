---
name: modern-web-guidance
description: Google's Modern Web Guidance CLI/plugin for lyjwpage — run with DISABLE_TELEMETRY=1 (it posts search queries to Google by default); install PR #813; 2026-11-13 audit report
metadata:
  type: project
---

2026-11-13: lyjw asked to install GoogleChrome/modern-web-guidance and audit the site. Thread「用 modern-web-guidance 审计站点」opened PR #813 (repo `.claude/settings.json` marketplace `googlechrome` + `enabledPlugins` `modern-web-guidance@googlechrome`, `env.DISABLE_TELEMETRY=1`, docs/references.md entry); waits on lyjw's OK. Report: <private claude.ai link> (legacy-scan 0 findings; 3 small issues: trophy-teaser aria-label mismatch, no security headers on HTML, static dark theme-color in light theme).

**Why:** the Verify Action on #813 caught that the CLI by default POSTs agent search queries and guide ids to play.googleapis.com (clearcut), conflicting with the no-project-data-to-outside rule. `DISABLE_TELEMETRY=1|true` turns it off (`modern-web.mjs#isTelemetryEnabled`). The same env var also opts Claude Code itself out of Statsig in that repo.

**How to apply:** cloud threads don't load repo plugins or repo `env`; run `DISABLE_TELEMETRY=1 npx -y modern-web-guidance@latest search|retrieve|legacy-scan …` by hand, and keep queries generic (no project names). Related: [[thread-sessions-skip-repo-hooks]].
