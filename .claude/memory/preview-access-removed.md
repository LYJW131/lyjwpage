---
name: preview-access-removed
description: Site branch previews (*.preview.lyjw.dev only; *-site.lyjw.workers.dev disabled) have no Access login since 2026-10-14 by lyjw's choice; previews send noindex instead
metadata:
  type: project
---

lyjw 2026-10-14 21:35 (SGT) chose to remove the Access login on site previews ("要不直接把认证拆了算了 这东西到底在防什么"), after research in `/mnt/project-files/preview-auth/调研.md` showed it was slow (Cloudflare-account IdP via dash OAuth, 24h session) and protected little: repo public, core previews already public, visitor-build preview links unopenable for visitors and agents.

Done: Access app 「lyjwpage site Previews」 deleted via API; site Worker adds `X-Robots-Tag: noindex, nofollow` on non-production responses; `SITE_PREVIEW_ACCESS_READY` gate removed from `scripts/deploy-site-preview.mjs` (Builds var left for old branches).

**Why:** speed and usefulness outweighed a protection that didn't protect.
**How to apply:** don't re-add Access to site previews or propose it; agents can open previews directly for screenshots.
