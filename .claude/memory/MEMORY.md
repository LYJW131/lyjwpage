# lyjwpage project
- Owner: lyjw (GitHub LYJW131). Chinese. Repo https://github.com/LYJW131/lyjwpage (personal site). Goal: keep evolving the site on cutting-edge tech.
- **Production domain is `https://lyjw.me`.** `lyjw.dev` is ONLY the branch-preview domain (`<branch>.preview.lyjw.dev`); bare lyjw.dev is not the site: [[prod-domain-lyjw-me]].

## How lyjw wants us to work (put the relevant ones in every brief)
- **Call lyjw "lyjw"** in every third-person reference (docs, skills, memory, PRs, reports, briefs); never 站主/owner/用户/他/they/real name. Direct chat address stays "你". (2026-10-14, #313)
- **Times in SGT** (UTC+8, e.g. "18:07 (SGT)") in everything shown to lyjw.
- **Read official docs before calling an API** (lyjw 2026-10-23 16:10 SGT「以后调用api先查官方文档」, after a thread probed Apple Music endpoints by trial).
- **Bare link = summarize, then judge** (lyjw 2026-10-20): summarize it; if it may help the site, research how it would apply. No numbered proposal lists unless lyjw asks.
- **Reports for lyjw:** one Artifact, never .md; A style only, ASD-STE100 short sentences, low-key; 书页 look from /mnt/project-files/report-style/book-template.html: [[report-book-style]].
- **New concepts: make lyjw think** (lyjw 2026-10-20): anchor to lyjwpage, contrast, at most one check question with the answer below, invite explain-back; never block work: [[teach-new-concepts]].
- **Latest stack, no legacy compat** (lyjw 2026-10-15): prefer newest versions/APIs; drop old shims/fallbacks/dual paths when migrating. Exception: iOS reporter endpoints must keep working.
- **Exploring directions is allowed** (lyjw 2026-10-20): raise direction doubts early in the thread, not as a block on a finished PR; closing a PR is not sunk cost: [[explore-directions]].
- **Don't over-engineer** (lyjw 2026-10-15 "你过度设计了 提示词改一下就行了"). Pick the smallest change that does the job. Small code additions are not a cost worth weighing (lyjw 2026-10-20).
- **Waits have timeouts:** 15 min for hand loops, `--timeout` for deploys; confirm the target exists first; on timeout record FAIL and move on: [[waits-have-timeouts]].
- **Re-run transient build/deploy failures without asking.**
- **Do it yourself if a tool can** (lyjw 2026-10-22): check MCP/API/CLI/RC before asking lyjw; ask only for what needs lyjw's hands or a decision.
- **Never ask lyjw to paste/run terminal commands** (lyjw 2026-10-22「这很蠢」): use Mac Remote Control; if its auto mode blocks a step, ask for one approval click (or a permission rule). Exception: when the Mac is offline lyjw may ask for the command to paste (2026-10-24 01:48 SGT「你直接给我命令 我直接贴mac上」).
- **Plans needing lyjw's decisions → interactive HTML plan page** via the original html-plan plugin, not a replica (lyjw 2026-10-23; skill `lyjwpage-html-plan`, #557): [[html-plan-skill]].
- **Links as markdown** `[text](url)`, never bare URLs next to Chinese: [[links-as-markdown]].
- **Never auto-resolve shipped threads;** only lyjw resolves (or asks to: "存档讨论串" = resolve it).
- **Merge autonomy:** small changes and work lyjw asked to push merge without waiting; big-direction changes need lyjw's go; references-only docs edits go straight in. Cloud can't push main, so open the PR and merge at once. CI waits by tier: [[merge-ci-wait-tiers]].
- **Merge method** (lyjw 2026-10-20): PRs with fewer than 3 commits are squash-merged; merge commits only for ≥3 commits. A check enforces it.
- **Project threads skip repo hooks/agents/nested rules, but skills load** (2026-10-24): Setup script symlinks each repo skill into `/root/.claude/skills/` (#639, probe verified 06:21 SGT); user-level `/root/.claude/settings.json` (Stop tokens hook) is read. Repo guard hooks don't fire in threads: follow AGENTS.md rules by hand; backstop is CI + branch protection: [[thread-sessions-skip-repo-hooks]].
- **UI/UX changes need lyjw's OK after screenshots** (desktop + mobile every round; ask with a decision card once the branch preview is up; clear bug fixes and small asked-for changes merge without asking). UI follows DESIGN.md + skill `lyjwpage-ui-design`: [[design-md-ui-approval]], [[ui-before-after-reference-lines]], [[ink-tokens-keep-chroma]].
- **Screenshots/fixtures must be internally consistent** (lyjw「太假了」 on mixed live/fake): one scene for every view and theme via `pnpm dev:scene <name>` (#338). README cards are live `/cards/*.svg`. Pain points: /mnt/project-files/fixtures/痛点.md.
- **Bot review only for real logic changes**: read every Devin Review/Codex/Claude review, fix or reply; Codex ≤3 rounds; Bugbot off: [[merge-requires-bot-review-pass]]. Merge commits via `pnpm merge-message` ([[merge-commit-format]]); check /api/version after merge; a push that started no build gets rebuilt at once without asking ([[workers-builds-parallel-race]]).
- **Post-merge prod checks:** every merge checks /api/version only. Real prod behavior test only for cache/Cache-Tag purge, first-screen SSR, fonts, or features needing prod secrets/bindings.
- **Bulk record reading → Haiku or Sonnet worker, case by case, never Opus** (lyjw 2026-10-24): [[batch-reading-goes-to-haiku]].
- **Verification → Haiku 5.5 high worker** per skill `lyjwpage-verify`; lead spot-checks one item: [[verification-haiku-worker]]. First-screen/font/cache/SSR changes also run `site-verify reload` (Chromium + WebKit): [[first-screen-reload-check]]. Explainers: [[explainer-author-effort]], [[explainer-3d-real-ui]]; animation frames are accepted by Haiku (#490).
- **Verify in GitHub Actions** (#572 merged; receipt gaps only warn, never block; receipts posted as lyjw131[bot]): [[verify-in-actions-plan]]; independent review said 需先修: [[verify-action-review-572]]. Official claude-review fix (Opus orchestrator, logic tier only): [[claude-review-hollow]]. `lyjw131[bot]` labels `tier: …` (display only, #586) and `verifier-changed` (mark, don't block). Verifier high vs medium effort A/B (`verify-ab` job, #625) compared 2026-10-25 over 31 runs: high catches more real defects, recommend keep high; 10-27 reminder superseded: [[verify-effort-ab-result]].
- **Claude Actions stay on the subscription setup token** (lyjw 2026-10-24 05:53 SGT): WIF/API billing (#625, #628) removed in #637, Console federation revoked. lyjw's Console balance is Max-plan API credit, which by Anthropic docs doesn't cover Claude Code incl. the GitHub Action; never strip the action's entrypoint markers. API billing only with purchased credit; static API keys rejected: [[claude-actions-billing-wif]].
- **Throwaway test PRs:** apply the `do-not-merge` label when opening (scripts read the label, never the title; lyjw 2026-10-23「还有之前那个测试pr不合并也是」); its check stays red, pr-gate and the merge hook block it (HUMAN.md).
- **Chat testing never asks lyjw to send homepage test chats;** use direct API calls, the Turnstile test key, or read ChatLog via Cloudflare Code Mode MCP's DO query API (workers/ai/README.md).
- **Decision cards:** coordinator re-posts any thread's open card in project chat and relays lyjw's choice.
- **No task board;** progress lives in threads.
- **Hand-offs carry lyjw's constraints;** route a follow-up once; later relay overrides: [[handoff-carry-user-constraints]].
- **Secrets** are piped on the Mac with `rotate-secret`; never ask lyjw to paste values: [[credentials-pipe-only]]. Memory never holds usable secrets and IDs aren't confidential: fix over-eager secret checks rather than rewording memory (lyjw 2026-10-24 03:43 SGT; mirror check loosened in #629).
- **Commit identity:** commits are as lyjw (signed), Claude only Co-Authored-By: [[commit-identity-signing]].
- **X/Twitter:** call api.x.com directly (proxy injects creds): [[x-api-via-proxy]].
- HUMAN.md is the lyjw-facing collaboration guide; keep it in sync with new rules.

## Tools and environment
- **Devin CLI can take work** (lyjw 2026-10-20) per skill `lyjwpage-devin-dispatch`; Claude keeps design, acceptance and re-signing; model and quota: [[devin-free-tier-limit]].
- Mac RC folder ~/Developer/lyjwpage; its auto mode blocks prod deploys/CF config writes, credential-file reads and remote branch deletes (lyjw may need to click). misaka-jp via dsm jump host; agents-reporter docker at /opt/lyjwpage.
- Cloud Anthropic test key: `ANTHROPIC_API_KEY="$LYJWPAGE_ANTHROPIC_API_KEY"`; never print it. Cloud env gaps: [[cloud-env-gaps]].
- Egress-injected APIs (no keys in the container): OpenRouter (capped, Inception only: [[openrouter-egress]]), misaka.io (only `/v3/mc2/metrics/account-throughput`; strip email/name), Gemini ([[gemini-video-qa-result]]), Apple Music ([[apple-music-user-api]]), TypeSafe System One (Jev; also Workers AI `typesafe/jev`), Exa, Parallel, tokens.ci (`/api/submit`).
- **tokens.ci cloud hook** (#626, #630; from lyjw's missuo/tokens PR #89): `tokens cloud submit` on Stop; moving to user-level settings via Setup script so threads report too (install once in Setup script, lyjw 2026-10-24). tokens.ci Network secret is on env <cloud env>.
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
- **Git history slimming: parked** (lyjw 2026-10-23「先记下 之后想做再说」): [[repo-history-slim]].
- Chat tiers, consent and log retention: [[chat-tiers]].
- **DO locations** (2026-10-23): StateHub KIX, LivePushRoom NRT, ChatQuota NRT, AnthropicEgress jp-0 KIX, ChatLog SEA, BuildCoordinator DFW: [[do-physical-locations]].
- **Workers Issues alert emails stay as-is** (lyjw 2026-10-23 23:50 SGT「不用了」): platform DO/D1 storage errors are not downgraded to warn.
- Small settled site decisions (README live cards `v=`, Today Tokens in M, no LICENSE, type assertions, legacy R2 assets, digest pools, dial sizes, Claude limit card, HealthKit nulls, Issues alerts): [[site-small-decisions]]. README also has the personal-info card and Cloudflare outage banner (#633).
- Desktop CLS fixed by `scrollbar-gutter: stable` (#534): [[desktop-cls-scrollbar]].
- New model/data destination/source/Worker: update every place its sibling appears, incl. chat consent copy (AGENTS.md, #482).
- iOS app paused: keep only its reporting endpoints working.
- **File-size rule (soft, no gate):** touching a source file over ~20 KB → split one piece if natural: [[file-size-rule]].
- README kept short (#331); long write-ups in docs/design-notes.md. Diagrams from `pnpm docs:diagrams`; redraw when Workers, bindings, sources, routines or merge gates change: [[readme-diagrams]].
- Sentry removed: [[sentry-exit-done]]. api→core rename: [[api-rename-to-core]]; collector drives the cron round: [[core-cron-internal-error]]. Same-origin API notes: [[same-origin-api-traps]].
- First screen: Workers Caching + Cache-Tag purge replaced ISR ([[esa-home-no-layout-purge]], [[now-playing-first-screen-decisions]]): [[first-screen-perf]].
- Build pipeline on GitHub Actions: [[build-actions-migration]]. Avatar auto-rebuild: [[avatar-watch-restored]]. CodeQL: [[codeql-policy]].
- Devin CLI token usage via Devin's own OTel into `mac-otlp` / `agents-otlp` (#453, #456): [[pulse-tokens-lane-coverage]].
- Not adopting (don't re-propose; reasons in the file): Mercury 3 chat, tester-army, seiso, site-AI OTel, Max credit, CF AI Search, post-deploy PageSpeed, Jev or Gemini as checkers or PR verifier, main-CI split, skip-CI on docs PRs, larger runners. Formal verification only on demand (`lyjwpage-formal-model`): [[not-adopting]].
- **No OTel/OTLP migration of reporter telemetry** (lyjw 2026-10-19 维持现状): [[reporter-otel-decision]].
- **Jev comment check (#610):** advisory check run `Comment check (Jev)` plus one lyjw131[bot] PR comment updated in place (needs pull-requests write, #620): [[jev-comment-check]].
- Chat context prefetch (#384): Clef picks site status / project doc to prefetch in the routing call (thresholds status 0.45, doc 0.3): [[idea-jev-context-prefetch]].
- Chat web search (#355): Exa `fast` only, Bangumi/Steam tools: [[chat-web-search]].
- .mjs→TS migration; `pnpm rules:check` blocks new `scripts/*.mjs`: [[mjs-to-ts-migration]].
- **Baselines shrink-only (#337):** `pnpm baselines:check` fails a PR whose baseline grows. Only lyjw adds the `baseline-exception` label.
