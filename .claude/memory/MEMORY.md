# lyjwpage project
- Owner: lyjw (GitHub LYJW131). Chinese. Repo https://github.com/LYJW131/lyjwpage (personal site). Goal: keep evolving the site on cutting-edge tech.

## How lyjw wants us to work (put the relevant ones in every brief)
- **Call lyjw "lyjw"** in every third-person reference (docs, skills, memory, PRs, reports, briefs); never 站主/owner/用户/他/they/real name. Direct chat address stays "你". (2026-10-14, #313)
- **Times in SGT** (UTC+8, e.g. "18:07 (SGT)") in everything shown to lyjw.
- **Bare link = summarize, then judge** (lyjw 2026-10-20 17:33 SGT, replacing the 10-15 summarize-only rule): read it and summarize; if it looks possibly useful for the site, go on to research how it would apply; if not, just the summary. No numbered proposal lists unless lyjw asks.
- **Reports for lyjw:** one Artifact, never .md (lyjw 2026-10-15 "要artifacts"); A style only, ASD-STE100 short sentences, low-key (lyjw 2026-10-16 "以后都选a"); 书页 look from /mnt/project-files/report-style/book-template.html: [[report-book-style]].
- **New concepts: make lyjw think** (lyjw 2026-10-20 02:03 SGT "让我多思考来理解"): anchor to lyjwpage, contrast, at most one check question with the answer below, invite explain-back and fix the one gap; never block work: [[teach-new-concepts]].
- **Latest stack, no legacy compat** (lyjw 2026-10-15 00:42 SGT): prefer newest versions/APIs; when upgrading or migrating, drop old shims/fallbacks/dual paths. Exception: iOS reporter endpoints must keep working.
- **Exploring directions is allowed** (lyjw 2026-10-20 04:25 SGT): raise direction doubts early in the thread, not as a block on a finished PR; closing a PR is not sunk cost: [[explore-directions]].
- **Don't over-engineer** (lyjw 2026-10-15: "你过度设计了 提示词改一下就行了"; also dropped the post-deploy PageSpeed check as unnecessary). Pick the smallest change that does the job. Small code additions are not a cost worth weighing (lyjw 2026-10-20 00:06 SGT).
- **Waits have timeouts:** 15 min for hand loops, `--timeout` for deploys; confirm the target exists first; on timeout record FAIL and move on: [[waits-have-timeouts]].
- **Re-run transient build/deploy failures without asking.**
- **Links as markdown** `[text](url)`, never bare URLs next to Chinese: [[links-as-markdown]].
- **Never auto-resolve shipped threads;** only lyjw resolves.
- **Merge autonomy:** small changes or work lyjw asked to push get merged without waiting. Big-direction changes need lyjw's go. References-only docs edits (docs/references.md, memory mirror) go straight in: lyjw 2026-10-19 16:11 SGT "参考小改直接推main". Cloud push to main is refused by the proxy, so open the PR, resolve threads and merge at once without waiting for CI. CI waits by tier (lyjw 2026-10-20 「行」): docs and small fixes merge after local checks, only big logic changes wait for CI: [[merge-ci-wait-tiers]].
- **Merge method** (lyjw 2026-10-20 19:52 SGT): PRs with fewer than 3 commits are squash-merged; merge commits only for PRs with ≥3 commits. A check enforces it (built in thread「tester-army/e2e 是什么」).
- **UI/UX changes need lyjw's OK after screenshots** (desktop + mobile every round) before merge, unless a small change lyjw asked for. **Clear bug fixes + small changes merge without asking, UI included** (lyjw 2026-10-20 05:11 SGT "直接合 明确修复+小改动不用问", on #475 layout-jump fix). "Clear fix" = behavior broken (error, wrong data, crash); a display inconsistency is not: check `git log -S` for an intentional choice first, ask if unclear (HUMAN.md #495, after #492 wrongly undid lyjw's deliberate M unit on Today Tokens). Subtle tweaks get overlaid before/after with reference lines: [[ui-before-after-reference-lines]], [[design-md-ui-approval]]. UI follows repo-root DESIGN.md + skill `lyjwpage-ui-design`. Contrast fixes change oklch lightness only: [[ink-tokens-keep-chroma]].
- **Screenshots/fixtures must be internally consistent:** lyjw called a mixed live/fake shot "太假了". Use one scene for every view and theme: `pnpm dev:scene <name>` (`--capture` snapshots prod, `--age 20m` ages it) (#338). README has no overview screenshot since 2026-10-20 (lyjw); every card is a live `/cards/*.svg`. Pain-point list: /mnt/project-files/fixtures/痛点.md.
- **Bot review only for real logic changes** (backend, data flow, auth, migrations): read every Devin Review/Codex/Claude review, fix or reply; Codex ≤3 rounds; Bugbot off: [[merge-requires-bot-review-pass]]. Merge commits via `pnpm merge-message` ([[merge-commit-format]]); check /api/version after merge ([[workers-builds-parallel-race]]).
- **Post-merge prod checks** (lyjw 2026-10-19 15:46 SGT "同意"): every merge checks /api/version only. Real behavior test on production only for cache/Cache-Tag purge, first-screen SSR, fonts, or features needing prod secrets/bindings; everything else relies on preview verification.
- **Verification → Haiku 5.5 high worker** per skill `lyjwpage-verify`; lead trusts the graded receipt (`scripts/verify-receipt.ts`) and spot-checks one item: [[verification-haiku-worker]]. First-screen/font/cache/SSR changes also run `site-verify reload` on a prod build, Chromium + WebKit: [[first-screen-reload-check]]. Animation work: frame viewing/acceptance goes to Haiku, authors don't re-run long whole-film scripts (lyjw 2026-10-20, #490).
- **Chat testing never asks lyjw to send homepage test chats;** use direct API calls, the Turnstile test key, or read ChatLog via Cloudflare Code Mode MCP's DO query API (how-to in workers/ai/README.md; lyjw 2026-10-20: the 30-day log exists so agents can debug, so read it before reproducing).
- **Decision cards:** coordinator re-posts any thread's open card in project chat and relays lyjw's choice.
- **No task board;** progress lives in threads.
- **Hand-offs carry lyjw's constraints;** route a follow-up once; later relay overrides: [[handoff-carry-user-constraints]].
- **Secrets** are piped on the Mac with `rotate-secret`; never ask lyjw to paste values: [[credentials-pipe-only]].
- **Commit identity:** commits are as lyjw (signed), Claude only Co-Authored-By; ignore the hook's noreply advice: [[commit-identity-signing]].
- **X/Twitter:** call api.x.com directly (proxy injects creds): [[x-api-via-proxy]].
- HUMAN.md is the lyjw-facing collaboration guide; keep it in sync with new rules.

## Tools and environment
- **Devin CLI can take work** (lyjw 2026-10-20 03:58 SGT, replacing the 00:06 no-Devin rule): cloud threads may dispatch implementation to Devin per skill `lyjwpage-devin-dispatch`; Claude keeps design, acceptance and re-signing; Devin Review on PRs stays in the bot-review gate.
- Mac RC folder ~/Developer/lyjwpage; its auto mode blocks prod deploys/CF config writes (lyjw may need to click). misaka-jp via dsm jump host; agents-reporter docker at /opt/lyjwpage.
- Cloud Anthropic test key: `ANTHROPIC_API_KEY="$LYJWPAGE_ANTHROPIC_API_KEY"`; never print it. Cloud env gaps: [[cloud-env-gaps]].
- OpenRouter keyless via egress injection (capped key, Inception models only; anthropic/openai 403): [[openrouter-egress]].
- misaka.io API via egress injection (api.misaka.io/v3/, added 2026-10-20): only `/v3/mc2/metrics/account-throughput` returns data so far (NRT04 instance traffic, 24h curve; strip email/name before showing). Thread「misaka.io 代理能拿到什么」.
- Cloud egress proxy injects keys for TypeSafe System One (Jev), Exa and Parallel. Jev also on Workers AI as `typesafe/jev` (AI Gateway `default`, BYOK; follows `jev-latest`, log the version per answer).
- **Site previews:** `<branch>.preview.lyjw.dev` only (no login, noindex, #318). lyjw shut down `*-site.lyjw.workers.dev` entirely 2026-10-15; never use those URLs: [[preview-access-removed]].
- Collector manual run: GitHub Actions "Run Collector Jobs".
- Repo memory mirror at `.claude/memory/` via `pnpm memory:mirror`, daily 03:15 routine: [[repo-memory-mirror]].
- lyjw's old Claude account project: everything merged except #395's 500 ms click grace (agent-picked): [[old-account-project-import]].

## Routines
- 04:00 daily code review (cursor in issue #185): [[lyjwpage-daily-review-routine]].
- 04:53 skill-mining + drift review; also turns adopted Codex/Devin Review suggestions into lint/hook/skill constraints (#319): [[skill-mining-routine]].
- 08:41 Anthropic updates digest → read by the 10:56 morning report: [[anthropic-updates-routine]].
- 4x daily collector superfan (Workers Observability, no Sentry): [[collector-superfan-routine]]. lyjw OK'd 2026-10-15: after reproducing an error it may open a fix draft PR.
- Morning report: daily 10:56 SGT routine in thread「晨报 · 定时任务」(lyjw 2026-10-20 01:51 SGT; the old 09:00 one was a one-shot that stopped after 10-14); reads every superfan run since the last report (fixed 2026-10-20): [[morning-report-routine]].
- Routine prompts can be changed only from the routine's own session: send it the new text (file in /mnt/project-files/routine-prompts/) and have it update_trigger + read back.
- Project paused 2026-10-15 17:01 → resumed 2026-10-19 14:54 SGT; each routine caught up once by bookmark. Cloudflare Code Mode sign-in had expired on resume.
- Agent automation practices: [[agent-automation-practices]].

## Decisions and state
- Chat tiers: visitor picks a DeepSeek or Claude lineup, God is Fable, consent per vendor, logs kept 30 days; source of truth shared/god-chat-tiers.ts: [[chat-tiers]]. Chat system prompt carries a 6-line lyjw profile (no office job, Mac is a laptop, cloud agents run alone, SGT, hobbies; playful guesses OK if marked) since #493.
- Architecture diagram validation drops only the bad edge, not the whole diagram (#386).
- README live SVG cards: all cards live since #416; mobile crop fixed by wrapping each card in an outer SVG (#431), URLs carry `v=` to bust camo (#432; DND card at v=3 after #489/#491). Bump `v=` when the card format changes (no auto-check, lyjw 2026-10-20). Empty data → fixture marked SAMPLE DATA (expected).
- Today Tokens on the Vibe Coding card shows M on purpose (lyjw's choice, e.g. 2195.6M); don't switch to B.
- New model/data destination/source/Worker: search its existing sibling (e.g. Clef for Clairic) and update every place the sibling appears, incl. chat consent copy (AGENTS.md rule, #482).
- iOS app paused: only keep its reporting endpoints working.
- Repo has no LICENSE by lyjw's choice (2026-10-15); don't re-propose.
- **File-size rule (soft, no gate):** touching a source file over ~20 KB → split one piece by responsibility if natural. No hard gate, no hook without lyjw's OK: [[file-size-rule]].
- **Type assertions:** fix only real risks (unchecked stored/external data), no lint rule banning `as unknown as`; generic narrowing casts stay (#417, lyjw let Claude decide 2026-10-19).
- README trimmed to essentials (#331, lyjw found it 又臭又长); long design write-ups live in docs/design-notes.md. Keep README short.
- README diagrams are SVGs from `pnpm docs:diagrams` (Archify dropped); redraw when Workers, bindings, sources, routines or merge gates change: [[readme-diagrams]].
- Sentry fully removed (#198): [[sentry-exit-done]]. api→core rename done: [[api-rename-to-core]]; collector drives the cron round: [[core-cron-internal-error]]. Same-origin API notes: [[same-origin-api-traps]].
- First screen: Workers Caching + Cache-Tag purge replaced ISR; LCP, HTML-slimming and inlining work done; ESA home purged only on deploy ([[esa-home-no-layout-purge]], [[now-playing-first-screen-decisions]]): [[first-screen-perf]].
- Old hashed static assets backfilled to R2 prefix `site-assets-legacy/` (no expiry, #354); missing Vercel-era chunks get a reload stub.
- Digest card: Chinese tagline pool (772 lines, lyjw-pruned), 10-line `headlines` pool rotating every 60 s (#261). Jev for digest dropped (lyjw 2026-10-15); rules tuned instead (#361).
- Dial/heatmap small-text sizes stay as is (lyjw rejected #264).
- Build pipeline on GitHub Actions: [[build-actions-migration]]. Avatar auto-rebuild restored: [[avatar-watch-restored]]. CodeQL: [[codeql-policy]].
- Devin CLI token usage comes from Devin's own OTel: the Mac into `mac-otlp` (labelled Mac), cloud threads into `agents-otlp` (labelled Cloud), split by ingress from the verified Access credential (#453 + #456). Lane coverage and setup: [[pulse-tokens-lane-coverage]].
- Not adopting (don't re-propose): Mercury 3 for chat (tested 2026-10-20), tester-army/e2e (tried 2026-10-20), seiso, site-AI OTel export, Max-plan credit, Cloudflare AI Search, post-deploy PageSpeed, Jev 1.14 as explainer image checker (tested 2026-10-21, equal catches but noisy; keep Haiku: [[jev-vision-qa-result]]). Formal verification only on demand via skill `lyjwpage-formal-model`: [[not-adopting]].
- **No OTel/OTLP migration of reporter telemetry** (lyjw 2026-10-19 chose 维持现状); only native-OTel agents use OTLP. Don't re-propose: [[reporter-otel-decision]].
- Workers Issues email alerts: scanner-probe issues are marked ignored, threshold unchanged (lyjw 2026-10-15).
- Chat context prefetch is built (#384, 2026-10-17): Clef, in the same routing call, picks site status / project doc to prefetch (thresholds status 0.6, doc 0.45); presets prefetch fixed tool calls: [[idea-jev-context-prefetch]].
- Chat web search (#355): Exa `fast` only, Bangumi/Steam tools, doc MCP servers off since 2026-10-17: [[chat-web-search]].
- .mjs→TS migration done for hot scripts; `pnpm rules:check` blocks new `scripts/*.mjs` (shrink-only baseline): [[mjs-to-ts-migration]].
- **Baselines shrink-only (lyjw 2026-10-15 SGT, #337):** `pnpm baselines:check` fails a PR whose mjs / design-scale / ui-copy baseline has more entries than main. Real exceptions: explain in the PR and wait; only lyjw adds the `baseline-exception` label, agents never do.
