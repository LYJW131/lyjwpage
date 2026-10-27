# lyjwpage project
- Owner: lyjw (GitHub LYJW131). Chinese. Repo https://github.com/LYJW131/lyjwpage (personal site). Goal: keep evolving the site on cutting-edge tech.
- **Production domain is `https://lyjw.me`.** `lyjw.dev` is ONLY the branch-preview domain (`<branch>.preview.lyjw.dev`): [[prod-domain-lyjw-me]].

## How lyjw wants us to work (put the relevant ones in every brief)
- **Thread effort per thread** (lyjw 2026-10-26): reading a link → `effort: low`; harder work → high/xhigh. Default Opus medium.
- **Call lyjw "lyjw"** in every third-person reference (docs, skills, memory, PRs, reports, briefs); never 站主/owner/用户/他/they/real name. Direct address stays "你" (#313).
- **Times in SGT** (e.g. "18:07 (SGT)") in everything shown to lyjw.
- **Read official docs before calling an API** (lyjw 2026-10-23).
- **Bare link = summarize, then judge;** if it may help the site, research how it would apply. No numbered proposal lists unless asked (2026-10-20).
- **Reports:** one Artifact, never .md; 书页 style, ASD-STE100 short sentences: [[report-book-style]].
- **New concepts: make lyjw think**, never block work: [[teach-new-concepts]].
- **Latest stack, no legacy compat** (2026-10-15); exception: iOS reporter endpoints keep working.
- **Exploring directions is allowed;** raise doubts early, closing a PR is not sunk cost: [[explore-directions]].
- **Don't over-engineer** (「你过度设计了 提示词改一下就行了」): smallest change that works; small code additions aren't a cost. Non-blocking check red for a rare/self-healing reason → explain, don't fix: [[no-edge-case-hardening]].
- **Waits have timeouts:** 15 min for hand loops, `--timeout` for deploys; confirm the target exists first; on timeout record FAIL and move on: [[waits-have-timeouts]].
- **Re-run transient build/deploy failures without asking.**
- **Do it yourself if a tool can** (MCP/API/CLI/RC); ask lyjw only for hands or decisions (2026-10-22).
- **Never ask lyjw to paste/run terminal commands** (「这很蠢」): use Mac Remote Control, ask for one approval click if blocked. Exception: Mac offline → lyjw may ask for the command (2026-10-24).
- **Plans needing lyjw's decisions → interactive HTML plan page** (skill `lyjwpage-html-plan`): [[html-plan-skill]].
- **Links as markdown** `[text](url)`: [[links-as-markdown]].
- **Never auto-resolve shipped threads;** only lyjw resolves ("存档讨论串" = resolve it).
- **Merge autonomy:** small changes and asked-for work merge at once; big direction needs lyjw's go; cloud can't push main, so PR then merge. CI waits by tier: [[merge-ci-wait-tiers]].
- **Merge method:** <3 commits squash, ≥3 merge commit; enforced. Messages via `pnpm merge-message`: [[merge-commit-format]].
- **Project threads skip repo hooks and nested rules; skills load** via Setup script symlinks. Follow AGENTS.md guard rules by hand: [[thread-sessions-skip-repo-hooks]].
- **UI/UX changes need lyjw's OK after screenshots** (desktop + mobile, decision card once preview is up; clear bug fixes exempt): [[design-md-ui-approval]], [[ui-before-after-reference-lines]], [[ink-tokens-keep-chroma]].
- **Screenshots/fixtures internally consistent** (「太假了」): one scene via `pnpm dev:scene <name>`; README cards are live `/cards/*.svg`; pain points /mnt/project-files/fixtures/痛点.md.
- **Bot review only for real logic changes;** read every Devin/Codex/Claude review, fix or reply; Codex ≤3 rounds; Bugbot off: [[merge-requires-bot-review-pass]]. A push that started no build gets rebuilt at once: [[workers-builds-parallel-race]].
- **Post-merge:** check /api/version only; real prod test only for cache/purge, first-screen SSR, fonts, prod-only bindings.
- **Bulk record reading → Haiku/Sonnet worker, never Opus:** [[batch-reading-goes-to-haiku]].
- **Big-change PRs: run skill `lyjwpage-swe-loop` (Devin read-only review loop) first, unasked:** [[swe-loop-auto]].
- **Verification → Haiku 5.5 high worker** (skill `lyjwpage-verify`), lead spot-checks one: [[verification-haiku-worker]]; first-screen changes also `site-verify reload`: [[first-screen-reload-check]]. Explainers: [[explainer-author-effort]], [[explainer-3d-real-ui]]; Haiku accepts animation frames (#490).
- **Verify Action in GitHub Actions:** gaps warn, never block; state (labels, high effort, notes-only reuse, incremental re-verify): [[verify-action-state]]; design: [[verify-in-actions-plan]].
- **Verify A/B live since 2026-10-26 (#665):** A = Claude Code verifier signs receipts; B = pi SDK verifier (`verify-pi` job, Haiku 5.5 via API key) only stores artifact `verify-ab-pi`, never blocks. Read by comparing `verify-ab-cc` / `verify-ab-pi` result.json via `reconcile`; #665's own 13 rounds counted separately. Duration and switch decision pending lyjw. Daily watch + report due 30 runs or 2026-11-09: [[verify-pi-ab-watch]]. Handoff doc: /mnt/user-data/uploads/hearth/8ba146e0-819b-438f-b75f-39f53f30b29e/8ba146e0-819b-438f-b75f-39f53f30b29e.md
- **Claude Actions stay on the subscription setup token;** no Max-plan API credit, no entrypoint stripping, no static API keys: [[claude-actions-billing-wif]].
- **Throwaway test PRs get the `do-not-merge` label** (scripts read the label, never the title); gates block them.
- **Chat testing never asks lyjw to send homepage chats;** use direct API calls, Turnstile test key, or ChatLog via Cloudflare MCP (workers/ai/README.md).
- **Decision cards:** coordinator re-posts open cards in project chat and relays lyjw's choice.
- **No task board;** progress lives in threads.
- **Hand-offs carry lyjw's constraints:** [[handoff-carry-user-constraints]].
- **Process steps go in the brief:** bug threads get 「改代码前先造一条会报红的复现」, threads that change code get 「开 PR 前的验证派 Haiku 子代理」; written only in skills/AGENTS.md, Opus skipped both, in the task text it did both 3/3 (eval 2026-10-26): [[agent-knowledge-eval-plan]].
- **Secrets** piped on the Mac with `rotate-secret`, never pasted: [[credentials-pipe-only]]. Secret checks that flag memory get fixed, not the memory: [[repo-memory-mirror]].
- **Commit identity:** as lyjw (signed), Claude only Co-Authored-By: [[commit-identity-signing]].
- **X/Twitter:** use the `LYJW MCP Portal` connector (X official MCP as lyjw; reads bookmarks and likes): [[x-mcp-portal]]. api.x.com via proxy (app-only, public only) is the fallback when the connector is missing: [[x-api-via-proxy]].
- HUMAN.md is the lyjw-facing collaboration guide; keep it in sync with new rules.

## Tools and environment
- **Devin CLI can take work** (skill `lyjwpage-devin-dispatch`): [[devin-free-tier-limit]]. swe-loop Devin reviewer runs `--mode dangerous` (#689).
- Mac RC folder ~/Developer/lyjwpage; its auto mode blocks prod deploys, CF config writes, credential reads, remote branch deletes. misaka-jp via dsm jump host; agents-reporter docker at /opt/lyjwpage.
- Cloud Anthropic test key `ANTHROPIC_API_KEY="$LYJWPAGE_ANTHROPIC_API_KEY"`, never printed: [[cloud-env-gaps]].
- Egress-injected APIs: OpenRouter ([[openrouter-egress]]), misaka.io (`/v3/mc2/metrics/account-throughput` only; strip email/name), Gemini ([[gemini-video-qa-result]]), Apple Music ([[apple-music-user-api]]), TypeSafe Jev, Exa, Parallel, tokens.ci.
- **tokens.ci Stop hook** at user level via Setup script: [[tokens-ci-cloud-hook]].
- **Site previews:** `<branch>.preview.lyjw.dev` only, never `*-site.lyjw.workers.dev`: [[preview-access-removed]]. Non-site preview comments auto-minimized (#676).
- Collector manual run: GitHub Actions "Run Collector Jobs".
- Repo memory mirror `.claude/memory/`, daily 03:15 routine: [[repo-memory-mirror]].
- Old account project: [[old-account-project-import]]. wrangler → cf CLI partial: [[cf-cli-migration]].

## Routines
- 04:00 daily code review: [[lyjwpage-daily-review-routine]].
- 04:53 skill-mining + drift review: [[skill-mining-routine]].
- 08:41 Anthropic updates digest: [[anthropic-updates-routine]].
- 4x daily collector superfan: [[collector-superfan-routine]].
- 10:56 morning report in「晨报 · 定时任务」: [[morning-report-routine]].
- Routine prompts change only from the routine's own session (text in /mnt/project-files/routine-prompts/, update_trigger + read back).
- [[agent-automation-practices]], [[token-efficiency-review]].

## Decisions and state
- **Aoko summon easter egg live** (#673 #690 #695, merge 55f94ba, 2026-10-27 01:20 SGT): dark mode, wide desktop, Konami code ↑↑↓↓←→←→BA Enter; code in `src/components/space-backdrop/aoko*`; assets `public/mascots/aoko*.webp` prefetched on first key. Source library on lyjw's T9 drive, Jev catalog `~/Desktop/mahoyo-catalog/`, export `scripts/aoko-fx-assets.ts`. Unverified: real-GPU fps, real no-WebGL device. Summon not persisted (localStorage needs lyjw's OK). Handoff: /mnt/user-data/uploads/hearth/478f8dff-1229-4c8a-8ea4-be5c17177dc1/478f8dff-1229-4c8a-8ea4-be5c17177dc1.md
- **Visitor build guards relaxed** (#710, lyjw「太过度防御了」): only paths executed or auto-loaded before merge are denied; others dropped/flagged for review: [[visitor-build-relaxed]].
- Git history slimming parked: [[repo-history-slim]]. Chat tiers/consent/logs: [[chat-tiers]]. DO locations: [[do-physical-locations]].
- Workers Issues alert emails stay as-is (lyjw「不用了」): platform DO/D1 storage errors are not downgraded to warn.
- **Cron late delivery** (Cloudflare): core and collector claim slots (#675, #681): [[core-heartbeat-slot-claim]], [[core-cron-internal-error]].
- Small settled site decisions: [[site-small-decisions]]. Desktop CLS: [[desktop-cls-scrollbar]].
- New model/data destination/source/Worker: update every place its sibling appears, incl. chat consent copy.
- iOS app paused; keep only its reporting endpoints.
- **File-size rule (soft):** [[file-size-rule]]. README short; diagrams from `pnpm docs:diagrams`: [[readme-diagrams]].
- [[sentry-exit-done]], [[api-rename-to-core]], [[same-origin-api-traps]].
- First screen: [[first-screen-perf]], [[esa-home-no-layout-purge]], [[now-playing-first-screen-decisions]].
- [[build-actions-migration]], [[avatar-watch-restored]], [[codeql-policy]], [[pulse-tokens-lane-coverage]].
- **Not adopting** (don't re-propose; list and reasons): [[not-adopting]]. No reporter OTel migration: [[reporter-otel-decision]].
- Jev comment check (advisory): [[jev-comment-check]]. Chat prefetch: [[idea-jev-context-prefetch]]. Chat web search: [[chat-web-search]].
- .mjs→TS; no new `scripts/*.mjs`: [[mjs-to-ts-migration]].
- **Baselines shrink-only;** only lyjw adds `baseline-exception`.
