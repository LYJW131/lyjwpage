---
name: no-unapproved-to-main-for-preview
description: Never propose merging any part lyjw hasn't approved into main (e.g. a read-side split PR) just so a branch preview can show it; solve preview testing inside the branch
metadata:
  type: feedback
---

2026-11-11 02:34 SGT, thread「限额图加重置卡使用预测」: branch preview core overlays prod `/api/status/limits`, so the new field didn't show. I proposed merging a small read-side PR to main first so the preview could show it. lyjw:「你这个a方法本质是把我没批过的东西和进main啊 不可能给你这样的」「以后也是」.

**Why:** anything in main is live in production; lyjw approves UI/feature changes only after clicking them on the preview, so splitting to main skips that gate.
**How to apply:** when a preview can't show a change because it reads prod data, fix it inside the branch only: preview-only config (e.g. `DEV_OVERRIDES = "true"` in `workers/core/wrangler.toml` `[previews.vars]` + PUT `/api/dev/override/...` on the branch core preview), reverted before merge. Never offer a main-first split as an option. Related: [[design-md-ui-approval]], [[no-config-route-first]].
