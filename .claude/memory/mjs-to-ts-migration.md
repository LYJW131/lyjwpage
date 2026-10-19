---
name: mjs-to-ts-migration
description: State of the scripts .mjs→TS migration and the shrink-only mjs baseline
metadata:
  type: project
---

**.mjs→TS migration done (2026-10-15 SGT, #327 #328 #330 #332 #333 #334 #335):** CI gate, verify, merge-message, deploy-check and build-actions scripts are now .ts (deploy-site-preview and other low-frequency scripts are still .mjs); `pnpm rules:check` rejects new `scripts/*.mjs` outside `scripts/mjs-baseline.json` (shrink-only; low-frequency scripts migrate when next touched). guard-forbidden-commands hook stays .mjs.
