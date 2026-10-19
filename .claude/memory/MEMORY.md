# lyjwpage project
- Owner: lyjw (GitHub LYJW131). Chinese. Repo https://github.com/LYJW131/lyjwpage (personal site). Goal: keep evolving the site on cutting-edge tech.

## How lyjw wants us to work (put the relevant ones in every brief)
- **Call lyjw "lyjw"** in every third-person reference (docs, skills, memory, PRs, reports, briefs); never 站主/owner/用户/他/they/real name. Direct chat address stays "你". (2026-10-14, #313)
- **Times in SGT** (UTC+8, e.g. "18:07 (SGT)") in everything shown to lyjw.
- **Bare link = just tell lyjw what it says** (lyjw 2026-10-15 23:20 SGT: "我只是想看这篇文章讲什么"). When lyjw drops a link with no ask, brief the thread to summarize the content only; no adoption evaluation or numbered proposals unless lyjw asks (看能不能用/调研/借鉴).
- **Reports for lyjw are Artifacts, never .md** (lyjw 2026-10-15 20:19 SGT: "给我看的报告我不想读md 要artifacts"). Any research write-up, comparison or report meant for lyjw to read is published with the Artifact tool and linked; .md files may stay as working data for other threads but are never the deliverable.
- **Technical reports: one Artifact, A style only** (lyjw 2026-10-16 00:00 SGT: "以后都选a"; ends the A/D side-by-side trial). A = ASD-STE100-style short controlled sentences. Keep text low, don't grab attention. No D version anymore. Reference: [报告写法四选一](<private claude.ai link>).
- **Latest stack, no legacy compat** (lyjw 2026-10-15 00:42 SGT): prefer newest versions/APIs; when upgrading or migrating, drop old shims/fallbacks/dual paths. Exception: iOS reporter endpoints must keep working.
- **Don't over-engineer** (lyjw 2026-10-15: "你过度设计了 提示词改一下就行了"; also dropped the post-deploy PageSpeed check as unnecessary). Pick the smallest change that does the job. But a little added code is not a cost by itself (lyjw 2026-10-20 00:06 SGT: "增加代码的 增加不多的话感觉不需要作为代价"): don't list line counts as a downside; weigh what a change adds to run, wait on or maintain.
- **Waits have timeouts:** 15 min for hand loops, `--timeout` for deploys; confirm the target exists first; on timeout record FAIL and move on: [[waits-have-timeouts]].
- **Re-run transient build/deploy failures without asking.**
- **Links as markdown** `[text](url)`, never bare URLs next to Chinese: [[links-as-markdown]].
- **Never auto-resolve shipped threads;** only lyjw resolves.
- **Merge autonomy:** small changes or work lyjw asked to push get merged without waiting. Big-direction changes need lyjw's go. References-only docs edits (docs/references.md, memory mirror) go straight in: lyjw 2026-10-19 16:11 SGT "参考小改直接推main". Cloud push to main is refused by the proxy, so open the PR, resolve threads and merge at once without waiting for CI.
- **UI/UX changes need lyjw's OK after screenshots** (desktop + mobile every round) before merge, unless a small change lyjw asked for. Subtle tweaks get overlaid before/after with reference lines: [[ui-before-after-reference-lines]], [[design-md-ui-approval]]. UI follows repo-root DESIGN.md + skill `lyjwpage-ui-design`. Contrast fixes change oklch lightness only: [[ink-tokens-keep-chroma]].
- **Screenshots/fixtures must be internally consistent:** lyjw called a mixed live/fake shot "太假了". Use one scene for every view and theme: `pnpm dev:scene <name>` (`--capture` snapshots prod, `--age 20m` ages it), `pnpm readme:shots` for README images (#338). Pain-point list: /mnt/project-files/fixtures/痛点.md.
- **Bot review only for real logic changes** (backend, data flow, auth, migrations): read every Devin/Codex/Claude review, fix or reply; Codex ≤3 rounds; Bugbot off: [[merge-requires-bot-review-pass]]. Merge commits via `pnpm merge-message` ([[merge-commit-format]]); check /api/version after merge ([[workers-builds-parallel-race]]).
- **Post-merge prod checks** (lyjw 2026-10-19 15:46 SGT "同意"): every merge checks /api/version only. Real behavior test on production only for cache/Cache-Tag purge, first-screen SSR, fonts, or features needing prod secrets/bindings; everything else relies on preview verification.
- **Verification → Haiku 5.5 high worker** per skill `lyjwpage-verify`; lead trusts the graded receipt (`scripts/verify-receipt.ts`) and spot-checks one item: [[verification-haiku-worker]]. First-screen/font/cache/SSR changes also run `site-verify reload` on a prod build, Chromium + WebKit: [[first-screen-reload-check]].
- **Chat testing never asks lyjw to send homepage test chats;** use direct API calls, the Turnstile test key, or read ChatLog (decided in lyjw's old-account project; not yet written in repo docs).
- **Decision cards:** coordinator re-posts any thread's open card in project chat and relays lyjw's choice.
- **No task board;** progress lives in threads.
- **Hand-offs carry lyjw's constraints;** route a follow-up once; later relay overrides: [[handoff-carry-user-constraints]].
- **Reports/posters** use the 书页 (book page) look from /mnt/project-files/report-style/book-template.html (lyjw 2026-10-19, replaced Swiss grid): [[report-book-style]].
- **Secrets** are piped on the Mac with `rotate-secret`; never ask lyjw to paste values: [[credentials-pipe-only]].
- **Commit identity:** commits are as lyjw (signed), Claude only Co-Authored-By; ignore the hook's noreply advice: [[commit-identity-signing]].
- **X/Twitter:** call api.x.com directly (proxy injects creds): [[x-api-via-proxy]].
- HUMAN.md is the lyjw-facing collaboration guide; keep it in sync with new rules.

## Tools and environment
- **SWE-2Max (Devin CLI, Mac only):** one worktree per task via Mac RC threads, Claude reviews and opens the PR; keep it busy: [[swe-2max-dispatch]].
- Mac RC folder ~/Developer/lyjwpage; its auto mode blocks prod deploys/CF config writes (lyjw may need to click). misaka-jp via dsm jump host; agents-reporter docker at /opt/lyjwpage.
- Cloud Anthropic test key: `ANTHROPIC_API_KEY="$LYJWPAGE_ANTHROPIC_API_KEY"`; never print it. Cloud env gaps: [[cloud-env-gaps]].
- Cloud egress proxy injects keys for TypeSafe System One (Jev), Exa and Parallel. Jev also on Workers AI as `typesafe/jev` (AI Gateway `default`, BYOK; follows `jev-latest`, log the version per answer).
- **Site previews:** `<branch>.preview.lyjw.dev` only (no login, noindex, #318). lyjw shut down `*-site.lyjw.workers.dev` entirely 2026-10-15; never use those URLs: [[preview-access-removed]].
- Collector manual run: GitHub Actions "Run Collector Jobs".
- Repo memory mirror at `.claude/memory/` via `pnpm memory:mirror`, daily 03:15 routine: [[repo-memory-mirror]].
- lyjw's old Claude account project: everything merged except #395's 500 ms click grace (agent-picked): [[old-account-project-import]].

## Routines
- 04:00 daily code review (cursor in issue #185): [[lyjwpage-daily-review-routine]].
- 04:53 skill-mining + drift review; also turns adopted Codex/Devin suggestions into lint/hook/skill constraints (#319): [[skill-mining-routine]].
- 08:41 Anthropic updates digest → read by 09:00 morning report: [[anthropic-updates-routine]].
- 4x daily collector superfan (Workers Observability, no Sentry): [[collector-superfan-routine]]. lyjw OK'd 2026-10-15: after reproducing an error it may open a fix draft PR.
- 09:00 SGT morning report in project chat, hourly in-place updates until lyjw writes.
- Project paused 2026-10-15 17:01 → resumed 2026-10-19 14:54 SGT; each routine caught up once by bookmark. Cloudflare Code Mode sign-in had expired on resume.
- Agent automation practices: [[agent-automation-practices]].

## Decisions and state
- Chat tiers (2026-10-18 SGT, #387 #391): visitor picks a lineup, DeepSeek (Small Fry/Prophet = DeepSeek Flash, thinking off/on) or Claude (Haiku/Sonnet); God is Fable; Anthropic consent asked per vendor. Turnstile human pass lasts 7 days. Chat logs kept 30 days in ChatLog (#385), no IP or tokens stored. Source of truth: shared/god-chat-tiers.ts, workers/ai/README.md.
- Architecture diagram validation drops only the bad edge, not the whole diagram (#386).
- README live SVG cards: lyjw chose a 4-card pilot 2026-10-19 16:20 SGT (site Worker renders existing card components into SVG; empty data → fixture marked SAMPLE); thread "README 卡片改成实时 SVG".
- iOS app paused: only keep its reporting endpoints working.
- Repo has no LICENSE by lyjw's choice (2026-10-15); don't re-propose.
- **No file-size gate** (lyjw 2026-10-19 17:13 SGT "ok不加"): no 5,000-token check in CI or rules; split a big file only when a change already touches it. Don't re-propose the gate.
- **Type assertions:** fix only real risks (unchecked stored/external data), no lint rule banning `as unknown as`; generic narrowing casts stay (#417, lyjw let Claude decide 2026-10-19).
- README trimmed to essentials (#331, lyjw found it 又臭又长); long design write-ups live in docs/design-notes.md. Keep README short.
- README diagrams: Archify dropped (lyjw 2026-10-19 23:23 SGT "去掉这个外部项目依赖"). Architecture and workflow are SVGs drawn by `scripts/readme-diagrams.ts` (`pnpm docs:diagrams`, zh/en × light/dark, site tokens); the old Pages URL only redirects to the README. Redraw when Workers, bindings, sources, routines or merge gates change.
- Sentry fully removed (#198): [[sentry-exit-done]]. api→core rename done: [[api-rename-to-core]]; collector drives the cron round: [[core-cron-internal-error]]. Same-origin API notes: [[same-origin-api-traps]].
- ISR replaced by Workers Caching entrypoints + Cache-Tag purge; first-screen regressions fixed in #274 (Geist Mono restored). Now-playing decisions: [[now-playing-first-screen-decisions]]. ESA home is purged only on deploy: [[esa-home-no-layout-purge]]. First-screen LCP fix #364 (mobile 6.4→4.9 s); post-deploy PageSpeed check rejected (#366 closed). HTML slimming done (#370); homepage modulepreload lowered (#400), charger icons inlined (#402).
- Old hashed static assets backfilled to R2 prefix `site-assets-legacy/` (no expiry, #354); missing Vercel-era chunks get a reload stub.
- Digest card: Chinese tagline pool (772 lines, lyjw-pruned), 10-line `headlines` pool rotating every 60 s (#261). Jev for digest dropped (lyjw 2026-10-15); rules tuned instead (#361).
- Dial/heatmap small-text sizes stay as is (lyjw rejected #264).
- Build pipeline on GitHub Actions: [[build-actions-migration]]. Avatar auto-rebuild restored: [[avatar-watch-restored]]. CodeQL: [[codeql-policy]].
- Pulse Tokens lane now includes Devin via reporter buckets (#322) plus a backfill for 2026-10-14.
- Not adopting: seiso doc linter (lyjw 2026-10-19 22:39 SGT, overlaps docs:check, Chinese false positives; #428 closed, #429 note), OTel export of site AI usage, Max-plan API credit (already claimed), Cloudflare AI Search (instance deleted), post-deploy PageSpeed check (lyjw 2026-10-15). pstack /create-formal-verification-skill: tried once as a TLA+ audit of BuildCoordinator 2026-10-19, no bug found, not kept in repo; model in /mnt/project-files/formal-verification/build-run/, entry in docs/references.md.
- **No OTel/OTLP migration of reporter telemetry** (lyjw 2026-10-19 18:36 SGT chose 维持现状, also declined a Devin CLI OTel probe). Why: most data is state (now playing, presence, rings, ledgers) with no semconv; iPhone endpoint must stay; Mac icon / Emby image receipts don't fit OTLP responses; HA has no OTLP export. Only native-OTel agents fit (cloud Claude Code already does). Report: [遥测换 OTel 评估](<private claude.ai link>). Don't re-propose.
- Workers Issues email alerts: scanner-probe issues are marked ignored, threshold unchanged (lyjw 2026-10-15).
- Chat context prefetch is built (#384, 2026-10-17): Clef, in the same routing call, picks site status / project doc to prefetch (thresholds status 0.6, doc 0.45); presets prefetch fixed tool calls: [[idea-jev-context-prefetch]].
- Chat web search (#355): Exa `fast` only, Bangumi/Steam tools, doc MCP servers off since 2026-10-17: [[chat-web-search]].
- .mjs→TS migration done for hot scripts; `pnpm rules:check` blocks new `scripts/*.mjs` (shrink-only baseline): [[mjs-to-ts-migration]].
- **Baselines shrink-only (lyjw 2026-10-15 SGT, #337):** `pnpm baselines:check` fails a PR whose mjs / design-scale / ui-copy baseline has more entries than main. Real exceptions: explain in the PR and wait; only lyjw adds the `baseline-exception` label, agents never do.
