# lyjwpage project
- Owner: lyjw (GitHub LYJW131). Chinese. Repo https://github.com/LYJW131/lyjwpage. Goal: keep evolving the site on cutting-edge tech.
- Prod domain `https://lyjw.me`; `lyjw.dev` is only branch previews `<branch>.preview.lyjw.dev`: [[prod-domain-lyjw-me]].

## How lyjw wants us to work (put relevant ones in briefs)
- **Copy the closest in-repo pattern first** (e.g. standing issues #185/#280: lyjw opens, bots comment, fix PRs `Refs #N`); deviate only with a stated reason.
- Thread effort: reading a link → low; harder work → high/xhigh.
- Call lyjw "lyjw" in third person everywhere (never 站主/owner/他/they); direct address "你". Times in SGT.
- Read official docs before calling an API. Do it yourself if a tool can; ask lyjw only for hands or decisions.
- Bare link = summarize, then judge; research application if useful. No numbered proposal lists unless asked.
- Reports: one Artifact, 书页 style, short ASD-STE100 sentences: [[report-book-style]]. New concepts: make lyjw think, never block: [[teach-new-concepts]].
- Latest stack, no legacy compat (except iOS reporter endpoints). Exploring allowed; raise doubts early: [[explore-directions]].
- Don't over-engineer; when asked why something was blocked by a guard, explain and let lyjw choose, don't tighten: [[no-edge-case-hardening]].
- A vendor announcement is not a change; code changes only when reporter raw data changes: [[announcement-is-not-a-change]].
- Waits have timeouts (15 min hand loops, `--timeout` deploys): [[waits-have-timeouts]]. Re-run transient build/deploy failures without asking.
- **No-config route first** (lyjw 2026-11-11「你有这种事情为什么不早说啊 还要我改东西」): before asking lyjw to touch a setting, offer what needs none (Cloudflare MCP etc.), check the field is editable, name what else depends on it: [[no-config-route-first]].
- **Never merge anything lyjw hasn't approved into main just to make a preview work** (lyjw 2026-11-11「不可能给你这样的 以后也是」). lyjw must click through the real feature on the branch preview; make the preview carry the data on the branch itself.
- Never ask lyjw to paste/run terminal commands; use Mac Remote Control (exception: Mac offline).
- Plans needing decisions → interactive HTML plan page (skill `lyjwpage-html-plan`): [[html-plan-skill]]. Links as markdown.
- Never auto-resolve shipped threads; only lyjw resolves ("存档讨论串").
- Merge: small/asked-for work merges at once; big direction needs lyjw's go; PR then merge: [[merge-ci-wait-tiers]]. <3 commits squash, ≥3 merge commit, `pnpm merge-message`: [[merge-commit-format]].
- Threads skip repo hooks; follow AGENTS.md guard rules by hand: [[thread-sessions-skip-repo-hooks]].
- **UI/UX changes need lyjw's OK after desktop + 375 screenshots** (exempt: clear bug fixes, small named behavior changes): [[design-md-ui-approval]], [[ui-before-after-reference-lines]], [[ink-tokens-keep-chroma]]. Removing an element means re-laying out, no empty slot (#788). UI PRs open with an unfolded Before | After table shot by the coding thread, pushed to `verify-shots/threads/<branch>/` (#765).
- README live cards show the site faithfully, controls included; grow height, never drop elements: [[readme-cards-mirror-site]].
- Fixtures internally consistent: `pnpm dev:scene <name>`; pain points /mnt/project-files/fixtures/痛点.md.
- Bot review only for real logic changes; fix real bugs, reply「边缘情况，不改」to edge cases; one fix push then merge; Codex ≤3 rounds: [[merge-requires-bot-review-pass]].
- Verify: Haiku 5.5 high worker (skill `lyjwpage-verify`), keep 1–2 meaningful shots in `<details>`: [[verification-haiku-worker]], [[first-screen-reload-check]], [[workers-builds-parallel-race]]. Actions verify warns, never blocks: [[verify-action-state]]. Verify A/B (#665): no switch, pi verifier advisory only: [[verify-pi-ab-watch]].
- Post-merge: check /api/version only, unless cache/SSR/fonts/prod bindings.
- Bulk record reading → Haiku/Sonnet worker: [[batch-reading-goes-to-haiku]]. Big PRs: run skill `lyjwpage-pr-review` unasked: [[pr-review-auto]], [[pr-review-devin-reviewer]].
- Claude Actions on subscription setup token: [[claude-actions-billing-wif]]. Throwaway PRs get `do-not-merge` label.
- Chat testing: never ask lyjw to send homepage chats (workers/ai/README.md).
- Decision cards: coordinator re-posts open cards and relays choices. Check precedent first (memory/not-adopting/HUMAN.md) and decide by it; irreversible steps and UI OKs still wait.
- No task board. Hand-offs carry constraints: [[handoff-carry-user-constraints]].
- Briefs include process steps: bug → 「改代码前先造一条会报红的复现」; code change → 「开 PR 前的验证派 Haiku 子代理」: [[agent-knowledge-eval-plan]].
- Secrets via `rotate-secret` on Mac: [[credentials-pipe-only]]. Commits as lyjw signed, Claude Co-Authored-By: [[commit-identity-signing]].
- X: `LYJW MCP Portal` connector; fallback api.x.com via proxy without asking: [[x-mcp-portal]], [[x-api-via-proxy]].
- Claude plan rename (Max 5x→Max, 20x→Ultra): 5h bar dropped (#788); show new names via mapping (lyjw 2026-11-01).
- HUMAN.md = lyjw-facing collaboration guide; keep in sync.

## Tools and environment
- Devin CLI: skill `lyjwpage-devin-dispatch`, [[devin-free-tier-limit]].
- Mac RC folder ~/Developer/lyjwpage (auto mode blocks prod deploys, CF config writes, credential reads, remote branch deletes). misaka-jp via dsm jump host; agents-reporter docker /opt/lyjwpage.
- Cloud Anthropic key `$LYJWPAGE_ANTHROPIC_API_KEY`, never printed: [[cloud-env-gaps]]. Egress APIs: OpenRouter, misaka.io (throughput only), Gemini, Apple Music, Jev, Exa, Parallel, tokens.ci: [[openrouter-egress]], [[apple-music-user-api]].
- OTLP: [[cloud-otlp-telemetry-audit]], [[tokens-ci-cloud-hook]].
- Previews only `<branch>.preview.lyjw.dev`: [[preview-access-removed]].
- Collector manual run: Actions "Run Collector Jobs". Memory mirror `.claude/memory/` daily 03:15: [[repo-memory-mirror]]. [[old-account-project-import]], [[cf-cli-migration]].
- lyjw.page 301 → lyjw.me (#747, docs/ops-facts.md).

## Routines
- **Paused by lyjw 2026-11-11 02:44 SGT**（「把最近的定时任务都停了吧 就留anthropic动态那个」）: review, skill-mining, collector, 晨报, memory mirror disabled (not deleted); only 08:41 Anthropic 动态 runs. Re-enable only when lyjw asks: [[routine-bindings]].
- Six routines, bindings and how to move: [[routine-bindings]]. Self-merge blocked unless lyjw's approval is in the routine prompt.
- **Gaps are expected:** lyjw pauses this project in Claude on purpose when the site needs no changes (lyjw 2026-11-11 02:05 SGT); routines don't run then and fire once each on return. Not a bug; don't investigate or report: [[routines-pause-when-project-idle]].
- 04:00 code review [[lyjwpage-daily-review-routine]]; 04:53 skill-mining [[skill-mining-routine]]; 08:41 Anthropic digest [[anthropic-updates-routine]]; 4x collector [[collector-superfan-routine]]; 09:00 晨报 [[morning-report-routine]]. CodeQL moving to #185/#280 pattern.
- Routine prompts change only from the routine's own session (/mnt/project-files/routine-prompts/). [[agent-automation-practices]], [[token-efficiency-review]].

## Decisions and state
- Chat Claude tiers 403 "Request not allowed" = Anthropic region block by visitor IP (HK/CN), not key; egress DO can't avoid it (2026-11-12): [[anthropic-region-block-visitor-ip]].
- Aoko summon easter egg live (dark, wide desktop, Konami code); code `src/components/space-backdrop/aoko*`; art production in private repo LYJW131/character-art (#738), sync `characters/aoko/coords.json` when shader lights change.
- PS5 in-game card live (#743).
- `/mcp` public-only (#778); private data only via lyjwhub plugin → core `PrivateHistory`: [[private-data-inventory]].
- Limits history reads StateHub DO; D1 archive-only (#742).
- **Reset cards** live (#802): lyjw states counts in chat → thread POSTs them; routes and semantics: [[reset-card-counts]].
- Visitor build guards relaxed (#710): [[visitor-build-relaxed]]. [[repo-history-slim]], [[chat-tiers]], [[do-physical-locations]].
- Workers alert emails stay as-is; `/image` 502s by design. Cron slots: [[core-heartbeat-slot-claim]], [[core-cron-internal-error]].
- [[site-small-decisions]], [[limit-forecast-backtest]], [[desktop-cls-scrollbar]].
- New model/source/Worker: update every sibling place incl. chat consent copy. iOS app paused.
- [[file-size-rule]], [[readme-diagrams]], [[sentry-exit-done]], [[api-rename-to-core]], [[same-origin-api-traps]], [[first-screen-perf]], [[esa-home-no-layout-purge]], [[now-playing-first-screen-decisions]], [[build-actions-migration]], [[avatar-watch-restored]], [[codeql-policy]], [[pulse-tokens-lane-coverage]].
- Not adopting: [[not-adopting]], [[reporter-otel-decision]]. [[webmcp-evals-baseline]], [[jev-comment-check]], [[idea-jev-context-prefetch]], [[chat-web-search]].
- Modern Web Guidance CLI: always `DISABLE_TELEMETRY=1` (posts queries to Google by default); install PR #813: [[modern-web-guidance]].
- No new `scripts/*.mjs`: [[mjs-to-ts-migration]]. Baselines shrink-only; only lyjw adds `baseline-exception`.
- HiTw93 rules adopted (#762): diagnose stops after 3 failed fixes; 「回滚：」line when revert can't undo; `chat:probe` regression mode.
