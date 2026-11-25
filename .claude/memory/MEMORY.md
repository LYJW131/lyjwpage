# lyjwpage project
- Owner: lyjw (GitHub LYJW131). Chinese. Repo https://github.com/LYJW131/lyjwpage. Goal: keep evolving the site on cutting-edge tech.
- Prod domain `https://lyjw.me`; `lyjw.dev` is only branch previews `<branch>.preview.lyjw.dev`: [[prod-domain-lyjw-me]].

## How lyjw wants us to work (put relevant ones in briefs)
- **Copy the closest in-repo pattern first** (e.g. standing issues #185/#280: lyjw opens, bots comment, fix PRs `Refs #N`); deviate only with a stated reason: [[follow-existing-pattern-first]].
- Thread effort: reading a link → low; harder work → high/xhigh. Coordinator picks effort/model automatically unless lyjw names one.
- Call lyjw "lyjw" in third person everywhere (never 站主/owner/他/they); direct address "你". Times in UTC+8 / SGT.
- Read official docs before calling an API. Do it yourself if local tools/CLI/MCP can; ask lyjw only for hands or decisions.
- Bare link = summarize, then judge; research application if useful. No numbered proposal lists unless asked: [[bare-link-means-summarize]].
- Reports: concise, short ASD-STE100 sentences; long reports/reviews use Ryugi Artifacts (formerly 书页 Artifact): [[report-book-style]]. New concepts: make lyjw think, never block: [[teach-new-concepts]].
- Latest stack, no legacy compat (except iOS reporter endpoints). Exploring allowed; raise doubts early: [[explore-directions]].
- Don't over-engineer; when asked why something was blocked by a guard, explain and let lyjw choose, don't tighten: [[no-edge-case-hardening]].
- A vendor announcement is not a change; code changes only when reporter raw data changes: [[announcement-is-not-a-change]].
- Waits have timeouts (15 min hand loops, `--timeout` deploys). Re-run transient build/deploy failures without asking.
- **No-config route first** (lyjw 2026-11-11「你有这种事情为什么不早说啊 还要我改东西」): before asking lyjw to touch a setting, offer what needs none (CLI/MCP etc.), check the field is editable, name what else depends on it: [[no-config-route-first]].
- **Never merge anything lyjw hasn't approved into main just to make a preview work** (lyjw 2026-11-11「不可能给你这样的 以后也是」). lyjw must click through the real feature on the branch preview; make the preview carry the data on the branch itself: [[no-unapproved-to-main-for-preview]].
- Plans needing decisions → interactive HTML plan page or Ryugi Document: [[html-plan-skill]]. Links as markdown: [[links-as-markdown]].
- Never auto-resolve / auto-settle shipped threads; leave them open for lyjw until lyjw says "关" / "存档".
- Merge: small/asked-for work merges at once; big direction needs lyjw's go; PR then merge: [[merge-ci-wait-tiers]]. <3 commits squash, ≥3 merge commit, `pnpm merge-message`: [[merge-commit-format]].
- **UI/UX changes need lyjw's OK after desktop + 375 screenshots** (exempt: clear bug fixes, small named behavior changes): [[design-md-ui-approval]], [[ui-before-after-reference-lines]], [[ink-tokens-keep-chroma]]. Removing an element means re-laying out, no empty slot (#788). UI PRs open with an unfolded Before | After table shot by the coding thread, pushed to `verify-shots/threads/<branch>/` (#765).
- README live cards show the site faithfully, controls included; grow height, never drop elements: [[readme-cards-mirror-site]].
- Fixtures internally consistent: `pnpm dev:scene <name>`.
- Bot review only for real logic changes; fix real bugs, reply「边缘情况，不改」to edge cases; one fix push then merge; Codex ≤3 rounds: [[merge-requires-bot-review-pass]].
- Verify: Haiku/lightweight worker (skill `lyjwpage-verify`), keep 1–2 meaningful shots in `<details>`: [[verification-haiku-worker]], [[first-screen-reload-check]], [[workers-builds-parallel-race]]. Actions verify warns, never blocks; single-track pi SDK (`verify-agent` + Claude OIDC WIF) for both Haiku verifier and Opus judge (2026-11-25): [[verify-action-state]], [[verify-pi-ab-watch]].
- **T3 transition check-skip (2026-11-25)**: skip checks / agent reviews that can't run due to unconfigured T3 local env or retired cloud-only setup, note the gap in 「没验到」, never stall; working local gates still run: [[t3-transition-check-skip]].
- Post-merge: check /api/version only, unless cache/SSR/fonts/prod bindings.
- Bulk record reading → cheap parallel workers: [[batch-reading-goes-to-haiku]]. Big PRs: run skill `lyjwpage-pr-review` unasked: [[pr-review-auto]], [[pr-review-devin-reviewer]].
- Claude Actions billing & red-line (never strip entrypoint markers or misuse Max credit); `verify.yml` uses Claude OIDC WIF via pi SDK (`vars.ANTHROPIC_FEDERATION_RULE_ID` / `_ORGANIZATION_ID`), `claude-code-review.yml` & `claude.yml` removed (2026-11-25): [[claude-actions-billing-wif]]. Throwaway PRs get `do-not-merge` label.
- Chat testing: never ask lyjw to send homepage chats (`workers/ai/README.md`).
- Decisions for lyjw: present 4 parts (user-visible symptom → impact if unchanged → impact if changed → recommendation) and structured clickable choices for UI OKs. Check precedent first (`not-adopting` / `HUMAN.md`).
- No task board. Hand-offs carry constraints, single-target routing, latest stance only: [[handoff-carry-user-constraints]].
- **Briefs must include process steps verbatim** (10-26 eval): bug → 「改代码前先造一条会报红的复现」; code/workflow → 「先 rg 找仓库现有同类实现照抄，开 PR 前独立验证」: [[agent-knowledge-eval-plan]].
- Secrets never enter chat or repo; commits signed as lyjw: [[credentials-pipe-only]], [[commit-identity-signing]].
- Claude plan rename (Max 5x→Max, 20x→Ultra): 5h bar dropped (#788); show new names via mapping (lyjw 2026-11-01).
- HUMAN.md = lyjw-facing collaboration guide; keep in sync.

## Tools, memory and environment
- **Workflow host (since 2026-11-25)**: migrated from Claude Projects to **T3 Code** on lyjw's Linux desktop (`lyjwpage-coordinator` pinned thread dispatches isolated `origin/main` worktree top-level threads).
- **Devin CLI (since 2026-11-25)**: logged in by lyjw on the local T3 machine and available for `lyjwpage-pr-review` (`agents/pr-review`); if unable to run, skip and note the gap: [[t3-transition-check-skip]].
- **Memory governance (single source + out-of-repo private notes)**: `.claude/memory/` is the single source of truth for public project memory (edit directly; 03:15 mirror sync retired). Local private notes live out-of-repo at `~/.agents/projects/lyjwpage.md`: [[repo-memory-mirror]].
- Previews only `<branch>.preview.lyjw.dev`: [[preview-access-removed]].
- Collector manual run: Actions "Run Collector Jobs". [[cf-cli-migration]], [[openrouter-egress]], [[apple-music-user-api]], [[cloud-otlp-telemetry-audit]].
- lyjw.page 301 → lyjw.me (#747, `docs/ops-facts.md`).

## Routines (T3 Code `schedule_task`, `freshSession: true`)
- **Active (since 2026-11-25)**:
  - `collector 盯防`: every 12h (2x/day), state in `~/.local/state/lyjwpage-routines/superfan-collector/`, telemetry via local `cf` OAuth runner: [[collector-superfan-routine]].
  - `提炼 skill 与偏差复盘`: Mon & Thu 04:53 UTC+8, state in `~/.local/state/lyjwpage-routines/skill-mining/`, reads T3 threads + `scripts/review-sieve.ts`; opens PRs for lyjw review during warm-up: [[skill-mining-routine]].
- **Paused / not yet migrated**: `Anthropic 官方动态` ([[anthropic-updates-routine]]), `每日代码审查` ([[lyjwpage-daily-review-routine]]), `晨报` ([[morning-report-routine]]) — re-enable only when lyjw asks.
- **Retired**: `03:15 记忆镜像同步` (no longer needed under single-source `.claude/memory/`). Old Claude Projects trigger bindings & idle quirks are historical: [[routine-bindings]], [[routines-pause-when-project-idle]], [[token-efficiency-review]].

## Decisions and state
- Aoko summon easter egg live (dark, wide desktop, Konami code); code `src/components/space-backdrop/aoko*`; art production in private repo LYJW131/character-art (#738), sync `characters/aoko/coords.json` when shader lights change.
- PS5 in-game card live (#743).
- `/mcp` public-only (#778); private data only via lyjwhub plugin → core `PrivateHistory`: [[private-data-inventory]].
- Limits history reads StateHub DO; D1 archive-only (#742).
- **Reset cards** live (#802, #806): lyjw states counts in chat → thread POSTs them; per-card expiry tracked: [[reset-card-counts]].
- Visitor build guards relaxed (#710): [[visitor-build-relaxed]]. [[repo-history-slim]], [[chat-tiers]], [[do-physical-locations]].
- Workers alert emails stay as-is; `/image` 502s by design. Cron slots: [[core-heartbeat-slot-claim]], [[core-cron-internal-error]].
- [[site-small-decisions]], [[limit-forecast-backtest]], [[desktop-cls-scrollbar]].
- New model/source/Worker: update every sibling place incl. chat consent copy. iOS app paused.
- [[file-size-rule]], [[readme-diagrams]], [[sentry-exit-done]], [[api-rename-to-core]], [[same-origin-api-traps]], [[first-screen-perf]], [[esa-home-no-layout-purge]], [[now-playing-first-screen-decisions]], [[build-actions-migration]], [[avatar-watch-restored]], [[codeql-policy]], [[pulse-tokens-lane-coverage]].
- Not adopting: [[not-adopting]], [[reporter-otel-decision]]. [[webmcp-evals-baseline]], [[jev-comment-check]], [[idea-jev-context-prefetch]], [[chat-web-search]].
- No new `scripts/*.mjs`: [[mjs-to-ts-migration]]. Baselines shrink-only; only lyjw adds `baseline-exception`.
- HiTw93 rules adopted (#762): diagnose stops after 3 failed fixes; 「回滚：」line when revert can't undo; `chat:probe` regression mode.
