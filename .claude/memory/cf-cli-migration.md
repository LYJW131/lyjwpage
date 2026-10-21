---
name: cf-cli-migration
description: State of moving lyjwpage from wrangler to Cloudflare's new `cf` CLI (beta) — what switched, what still needs wrangler, what lyjw decides
metadata:
  type: project
---

lyjw asked 2026-10-22 00:09 SGT to replace wrangler with `cf` everywhere ("cf 是之后的标准"). Checked cf 1.0.0-beta.20.

Done in #538 (merged 2026-10-22): remote D1 migrations use `cf d1 migrations apply <ID>` (command only in docs/state-storage.md); the guard hook also blocks `cf deploy`, `cf workers deployments create`, `cf workers triggers deploy`.

Still on wrangler (cf can't yet): single secret put incl. `wrangler preview secret put`, `tail`, `r2 objects put --cache-control` (video-release needs immutable), `d1 query --file`, multi `-c` local dev (`pnpm dev:worker`). Project configs (5 Workers) not migrated: `cf dev/build/deploy` read only cloudflare.config.ts; `cf migrate --dry-run` flags DO `migrations`→`exports` (core, ai), core preview branch, site needs `@cloudflare/vite-plugin@beta`; with the Wrangler bundler cf still runs wrangler underneath. Never run `cf dev/build/deploy` in the repo before migrating: auto-config rewrites package.json/vite.config.ts.

Full migration = decision card in thread「wrangler 换成 cf 命令行」; recheck gaps on new cf releases before re-proposing. Gaps list also in docs/references.md「Cloudflare 平台」.
