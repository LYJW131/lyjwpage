# lyjwpage project
- Owner: lyjw (GitHub LYJW131). Chinese. Repo https://github.com/LYJW131/lyjwpage (personal site). Goal: keep evolving the site on cutting-edge tech.
- **Production domain is `https://lyjw.me`.** `lyjw.dev` is ONLY the branch-preview domain (`<branch>.preview.lyjw.dev`); bare lyjw.dev is not the site: [[prod-domain-lyjw-me]].

## How lyjw wants us to work (put the relevant ones in every brief)
- **Call lyjw "lyjw"** in every third-person reference (docs, skills, memory, PRs, reports, briefs); never 站主/owner/用户/他/they/real name. Direct chat address stays "你". (2026-10-14, #313)
- **Times in SGT** (UTC+8, e.g. "18:07 (SGT)") in everything shown to lyjw.
- **Read official docs before calling an API** (lyjw 2026-10-23 16:10 SGT「以后调用api先查官方文档」, after a thread probed Apple Music endpoints by trial).
- **Bare link = summarize, then judge** (lyjw 2026-10-20 17:33 SGT): read it and summarize; if possibly useful for the site, research how it would apply; else just the summary. No numbered proposal lists unless lyjw asks.
- **Reports for lyjw:** one Artifact, never .md; A style only, ASD-STE100 short sentences, low-key; 书页 look from /mnt/project-files/report-style/book-template.html: [[report-book-style]].
- **New concepts: make lyjw think** (lyjw 2026-10-20): anchor to lyjwpage, contrast, at most one check question with the answer below, invite explain-back; never block work: [[teach-new-concepts]].
- **Latest stack, no legacy compat** (lyjw 2026-10-15): prefer newest versions/APIs; drop old shims/fallbacks/dual paths when migrating. Exception: iOS reporter endpoints must keep working.
- **Exploring directions is allowed** (lyjw 2026-10-20): raise direction doubts early in the thread, not as a block on a finished PR; closing a PR is not sunk cost: [[explore-directions]].
- **Don't over-engineer** (lyjw 2026-10-15 "你过度设计了 提示词改一下就行了"). Pick the smallest change that does the job. Small code additions are not a cost worth weighing (lyjw 2026-10-20).
- **Waits have timeouts:** 15 min for hand loops, `--timeout` for deploys; confirm the target exists first; on timeout record FAIL and move on: [[waits-have-timeouts]].
- **Re-run transient build/deploy failures without asking.**
- **Do it yourself if a tool can** (lyjw 2026-10-22 "以后手上有工具能做尽量不要来叫我了"): before asking lyjw to do a step, check whether MCP/API/CLI/RC can do it, and do it. Only ask for what truly needs lyjw's hands or a decision.
- **Never ask lyjw to paste/run terminal commands** (lyjw 2026-10-22 "这很蠢"). Run them via Mac Remote Control; if Mac auto mode blocks a step, ask lyjw for one approval click in that Mac session (or a permission rule).
- **Plans needing lyjw's decisions → interactive HTML plan page** via the original html-plan plugin, not a replica (lyjw 2026-10-23; skill `lyjwpage-html-plan`, #557): [[html-plan-skill]].
- **Links as markdown** `[text](url)`, never bare URLs next to Chinese: [[links-as-markdown]].
- **Never auto-resolve shipped threads;** only lyjw resolves (or asks to: "存档讨论串" = resolve it).
- **Merge autonomy:** small changes or work lyjw asked to push get merged without waiting. Big-direction changes need lyjw's go. References-only docs edits go straight in (lyjw 2026-10-19). Cloud push to main is refused by the proxy, so open the PR and merge at once. CI waits by tier: docs and small fixes merge after local checks, only big logic changes wait for CI: [[merge-ci-wait-tiers]].
- **Merge method** (lyjw 2026-10-20): PRs with fewer than 3 commits are squash-merged; merge commits only for ≥3 commits. A check enforces it.
- **UI/UX changes need lyjw's OK after screenshots** (desktop + mobile every round) before merge, unless a small change lyjw asked for. Cloud review asks wait until the branch preview (`<branch>.preview.lyjw.dev`) has deployed, then ping lyjw with the link (2026-10-21). **Clear bug fixes + small changes merge without asking, UI included** (2026-10-20). "Clear fix" = behavior broken; a display inconsistency is not: check `git log -S` for an intentional choice first (HUMAN.md #495). Subtle tweaks get overlaid before/after with reference lines: [[ui-before-after-reference-lines]], [[design-md-ui-approval]]. UI follows repo-root DESIGN.md + skill `lyjwpage-ui-design`. Contrast fixes change oklch lightness only: [[ink-tokens-keep-chroma]].
- **Screenshots/fixtures must be internally consistent** (lyjw: mixed live/fake "太假了"): one scene for every view and theme via `pnpm dev:scene <name>` (#338). README has no overview screenshot; every card is a live `/cards/*.svg`. Pain-point list: /mnt/project-files/fixtures/痛点.md.
- **Bot review only for real logic changes**: read every Devin Review/Codex/Claude review, fix or reply; Codex ≤3 rounds; Bugbot off: [[merge-requires-bot-review-pass]]. Merge commits via `pnpm merge-message` ([[merge-commit-format]]); check /api/version after merge; a push that started no build gets rebuilt at once without asking ([[workers-builds-parallel-race]]).
- **Post-merge prod checks:** every merge checks /api/version only. Real prod behavior test only for cache/Cache-Tag purge, first-screen SSR, fonts, or features needing prod secrets/bindings.
- **Verification → Haiku 5.5 high worker** per skill `lyjwpage-verify`; lead trusts the graded receipt and spot-checks one item: [[verification-haiku-worker]]. First-screen/font/cache/SSR changes also run `site-verify reload` on a prod build, Chromium + WebKit: [[first-screen-reload-check]]. Animation frame acceptance goes to Haiku (#490). Explainer authors run Opus xhigh: [[explainer-author-effort]]. 3D screen scenes: glass screens + real software UI (2026-10-23): [[explainer-3d-real-ui]].
- **Verify in GitHub Actions** (PR #572, 2026-10-23; lyjw: ask before merging #572): Haiku verifier + parallel Opus judge as Actions, bot-signed receipts bound to the PR body checklist: [[verify-in-actions-plan]]. Official claude-review was hollow: upstream bug anthropics/claude-code#100401 (Sonnet orchestrator skips subagents); fixed by `--model opus` (#577), runs only on logic-tier PRs (#583, lyjw: too heavy for every PR); review-workflow edits take effect only after merge: [[claude-review-hollow]].
- **Chat testing never asks lyjw to send homepage test chats;** use direct API calls, the Turnstile test key, or read ChatLog via Cloudflare Code Mode MCP's DO query API (workers/ai/README.md).
- **Decision cards:** coordinator re-posts any thread's open card in project chat and relays lyjw's choice.
- **No task board;** progress lives in threads.
- **Hand-offs carry lyjw's constraints;** route a follow-up once; later relay overrides: [[handoff-carry-user-constraints]].
- **Secrets** are piped on the Mac with `rotate-secret`; never ask lyjw to paste values: [[credentials-pipe-only]].
- **Commit identity:** commits are as lyjw (signed), Claude only Co-Authored-By: [[commit-identity-signing]].
- **X/Twitter:** call api.x.com directly (proxy injects creds): [[x-api-via-proxy]].
- HUMAN.md is the lyjw-facing collaboration guide; keep it in sync with new rules.

## Tools and environment
- **Devin CLI can take work** (lyjw 2026-10-20): cloud threads may dispatch implementation to Devin per skill `lyjwpage-devin-dispatch`; Claude keeps design, acceptance and re-signing. Model: Fusion High while Pro quota lasts, swe-2-max fallback; keep ~6 sessions active: [[devin-free-tier-limit]].
- Mac RC folder ~/Developer/lyjwpage; its auto mode blocks prod deploys/CF config writes, credential-file reads and remote branch deletes (lyjw may need to click). misaka-jp via dsm jump host; agents-reporter docker at /opt/lyjwpage.
- Cloud Anthropic test key: `ANTHROPIC_API_KEY="$LYJWPAGE_ANTHROPIC_API_KEY"`; never print it. Cloud env gaps: [[cloud-env-gaps]].
- OpenRouter keyless via egress injection (capped key, Inception models only): [[openrouter-egress]].
- misaka.io API via egress injection (api.misaka.io/v3/): only `/v3/mc2/metrics/account-throughput` returns data (strip email/name before showing).
- Gemini API via egress injection (2026-10-23): explainer QA trial not adopted: [[gemini-video-qa-result]].
- Apple Music user API via egress injection (api.music.apple.com /v1/): Replay via `GET /v1/me/music-summaries?filter[year]=latest&views=top-songs,top-artists,top-albums` (100 songs ranked, no play counts, only 2026 has data). Read Apple docs by appending `.md` to the page URL (lyjw 2026-10-23; no Context7, no third-party MCP). Endpoint list: /mnt/project-files/apple-music-api/endpoints.md. Thread「Apple Music 年度最爱歌曲」.
- Cloud egress proxy injects keys for TypeSafe System One (Jev), Exa and Parallel. Jev also on Workers AI as `typesafe/jev`.
- **Site previews:** `<branch>.preview.lyjw.dev` only (no login, noindex). Never use `*-site.lyjw.workers.dev`: [[preview-access-removed]].
- Collector manual run: GitHub Actions "Run Collector Jobs".
- Repo memory mirror at `.claude/memory/` via `pnpm memory:mirror`, daily 03:15 routine: [[repo-memory-mirror]].
- lyjw's old Claude account project: all merged except #395's 500 ms click grace: [[old-account-project-import]].
- **wrangler → cf CLI:** only D1 migrations and the deploy guard switched (#538): [[cf-cli-migration]].

## Routines
- 04:00 daily code review (cursor in issue #185): [[lyjwpage-daily-review-routine]].
- 04:53 skill-mining + drift review; turns adopted bot-review suggestions into lint/hook/skill constraints: [[skill-mining-routine]].
- 08:41 Anthropic updates digest → read by the 10:56 morning report: [[anthropic-updates-routine]].
- 4x daily collector superfan (Workers Observability); may open a fix draft PR after reproducing: [[collector-superfan-routine]].
- Morning report: daily 10:56 SGT in thread「晨报 · 定时任务」: [[morning-report-routine]].
- Routine prompts can be changed only from the routine's own session: send it the new text (file in /mnt/project-files/routine-prompts/) and have it update_trigger + read back.
- Agent automation practices: [[agent-automation-practices]].
- Token efficiency (2026-10-23): routines' heavy steps delegated to Haiku/Sonnet (#566, #567): [[token-efficiency-review]].

## Decisions and state
- **Git history slimming: parked** (lyjw 2026-10-23 16:51 SGT「先记下 之后想做再说」). main history ~84 MiB, ~80% mp3/png; v1 explainer mp3s removed from main (#579). Branch `slim-history-preview` (filtered, ~33 MiB; ~14 MiB without any mp3/png). Doing it = re-filter latest main, archive old main in a separate private repo or git bundle (not same repo), force-push main, drop old branches, rebuild open PRs; all SHAs change (routine cursors, receipts), old signatures lost, clones elsewhere re-cloned. Thread「仓库 git 体积」.
- Chat tiers: DeepSeek or Claude lineup, God is Fable, consent per vendor, logs 30 days; source of truth shared/god-chat-tiers.ts: [[chat-tiers]]. Chat system prompt carries a 6-line lyjw profile since #493.
- Architecture diagram validation drops only the bad edge (#386).
- README live SVG cards: wrapped in an outer SVG for mobile crop (#431), URLs carry `v=` to bust camo; bump `v=` when the card format changes. Empty data → fixture marked SAMPLE DATA. Width-based `<picture>` switching tested OK but lyjw dropped it (2026-10-23「算了」).
- Desktop CLS fixed by `scrollbar-gutter: stable` (#534): [[desktop-cls-scrollbar]].
- Today Tokens on the Vibe Coding card shows M on purpose (lyjw's choice); don't switch to B.
- New model/data destination/source/Worker: update every place its sibling appears, incl. chat consent copy (AGENTS.md, #482).
- iOS app paused: only keep its reporting endpoints working.
- Repo has no LICENSE by lyjw's choice; don't re-propose.
- **File-size rule (soft, no gate):** touching a source file over ~20 KB → split one piece if natural: [[file-size-rule]].
- **Type assertions:** fix only real risks (unchecked stored/external data); no lint rule (#417).
- README kept short (#331); long write-ups in docs/design-notes.md. Diagrams from `pnpm docs:diagrams`; redraw when Workers, bindings, sources, routines or merge gates change: [[readme-diagrams]].
- Sentry removed: [[sentry-exit-done]]. api→core rename: [[api-rename-to-core]]; collector drives the cron round: [[core-cron-internal-error]]. Same-origin API notes: [[same-origin-api-traps]].
- First screen: Workers Caching + Cache-Tag purge replaced ISR ([[esa-home-no-layout-purge]], [[now-playing-first-screen-decisions]]): [[first-screen-perf]].
- Old hashed static assets in R2 prefix `site-assets-legacy/` (#354); missing Vercel-era chunks get a reload stub.
- Digest card: Chinese tagline pool (lyjw-pruned), 10-line `headlines` pool rotating every 60 s (#261). Jev for digest dropped.
- Dial/heatmap small-text sizes stay as is (lyjw rejected #264).
- Build pipeline on GitHub Actions: [[build-actions-migration]]. Avatar auto-rebuild: [[avatar-watch-restored]]. CodeQL: [[codeql-policy]].
- Devin CLI token usage via Devin's own OTel into `mac-otlp` / `agents-otlp` (#453, #456): [[pulse-tokens-lane-coverage]].
- Not adopting (don't re-propose): Mercury 3 for chat, tester-army/e2e, seiso, site-AI OTel export, Max-plan credit, Cloudflare AI Search, post-deploy PageSpeed, Jev as explainer image checker ([[jev-vision-qa-result]]), Gemini as explainer video checker, main-CI split (2026-10-22), Blacksmith / GitHub larger runners (2026-10-23: org-only; public repo's ubuntu-latest is already free 4-core). Formal verification only on demand via skill `lyjwpage-formal-model`: [[not-adopting]].
- **No OTel/OTLP migration of reporter telemetry** (lyjw 2026-10-19 维持现状): [[reporter-otel-decision]].
- Workers Issues email alerts: scanner-probe issues ignored, threshold unchanged.
- Chat context prefetch (#384): Clef picks site status / project doc to prefetch in the routing call (thresholds status 0.45, doc 0.3, calibrated 2026-10-21 via `pnpm --dir workers/ai prefetch:calibrate`): [[idea-jev-context-prefetch]].
- Chat web search (#355): Exa `fast` only, Bangumi/Steam tools: [[chat-web-search]].
- .mjs→TS migration; `pnpm rules:check` blocks new `scripts/*.mjs`: [[mjs-to-ts-migration]].
- **Baselines shrink-only (#337):** `pnpm baselines:check` fails a PR whose baseline grows. Only lyjw adds the `baseline-exception` label.
