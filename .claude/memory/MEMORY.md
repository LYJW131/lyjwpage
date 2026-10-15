# lyjwpage project
- Owner: lyjw (GitHub LYJW131). Chinese. Repo https://github.com/LYJW131/lyjwpage (personal site). Goal: keep evolving the site on cutting-edge tech.

## How lyjw wants us to work (put the relevant ones in every brief)
- **Call lyjw "lyjw"** in every third-person reference (docs, skills, memory, PRs, reports, briefs); never 站主/owner/用户/他/they/real name. Direct chat address stays "你". (2026-10-14, #313)
- **Times in SGT** (UTC+8, e.g. "18:07 (SGT)") in everything shown to lyjw.
- **Bare link = just tell lyjw what it says** (lyjw 2026-10-15 23:20 SGT: "我只是想看这篇文章讲什么"). When lyjw drops a link with no ask, brief the thread to summarize the content only; no adoption evaluation or numbered proposals unless lyjw asks (看能不能用/调研/借鉴).
- **Reports for lyjw are Artifacts, never .md** (lyjw 2026-10-15 20:19 SGT: "给我看的报告我不想读md 要artifacts"). Any research write-up, comparison or report meant for lyjw to read is published with the Artifact tool and linked; .md files may stay as working data for other threads but are never the deliverable.
- **Technical reports: ship two Artifact versions, A and D, side by side** (lyjw 2026-10-15 20:50 SGT: "我选ad 接下来的技术报告都用ad做ab版本artifacts对照给我看"). A = ASD-STE100-style short controlled sentences; D = Axios Smart Brevity. Keep text low, don't grab attention. lyjw will say which they prefer each time. Reference: [报告写法四选一](<private claude.ai link>), thread "报告怎么写得更省注意力".
- **Latest stack, no legacy compat** (lyjw 2026-10-15 00:42 SGT): prefer newest versions/APIs; when upgrading or migrating, drop old shims/fallbacks/dual paths. Exception: iOS reporter endpoints must keep working.
- **Waits have timeouts:** 15 min for hand loops, `--timeout` for deploys; confirm the target exists first; on timeout record FAIL and move on: [[waits-have-timeouts]].
- **Re-run transient build/deploy failures without asking.**
- **Links as markdown** `[text](url)`, never bare URLs next to Chinese: [[links-as-markdown]].
- **Never auto-resolve shipped threads;** only lyjw resolves.
- **Merge autonomy:** small changes or work lyjw asked to push get merged without waiting. Big-direction changes need lyjw's go.
- **UI/UX changes need lyjw's OK after screenshots** (desktop + mobile every round) before merge, unless a small change lyjw asked for. Subtle tweaks get overlaid before/after with reference lines: [[ui-before-after-reference-lines]], [[design-md-ui-approval]]. UI follows repo-root DESIGN.md + skill `lyjwpage-ui-design`. Contrast fixes change oklch lightness only: [[ink-tokens-keep-chroma]].
- **Screenshots/fixtures must be internally consistent:** lyjw called a mixed live/fake shot "太假了". Use one scene for every view and theme: `pnpm dev:scene <name>` (`--capture` snapshots prod, `--age 20m` ages it), `pnpm readme:shots` for README images (#338). Pain-point list: /mnt/project-files/fixtures/痛点.md.
- **Bot review only for real logic changes** (backend, data flow, auth, migrations): read every Devin/Codex/Claude review, fix or reply; Codex ≤3 rounds; Bugbot off: [[merge-requires-bot-review-pass]]. Merge commits via `pnpm merge-message` ([[merge-commit-format]]); check /api/version after merge ([[workers-builds-parallel-race]]).
- **Verification → Haiku 5.5 high worker** per skill `lyjwpage-verify`; lead trusts the graded receipt (`scripts/verify-receipt.ts`) and spot-checks one item: [[verification-haiku-worker]]. First-screen/font/cache/SSR changes also run `site-verify reload` on a prod build, Chromium + WebKit: [[first-screen-reload-check]].
- **Decision cards:** coordinator re-posts any thread's open card in project chat and relays lyjw's choice.
- **No task board;** progress lives in threads.
- **Hand-offs carry lyjw's constraints;** route a follow-up once; later relay overrides: [[handoff-carry-user-constraints]].
- **Reports/posters** use the Swiss grid style: [[report-poster-swiss-style]].
- **Secrets** are piped on the Mac with `rotate-secret`; never ask lyjw to paste values: [[credentials-pipe-only]].
- **Commit identity:** commits are as lyjw (signed), Claude only Co-Authored-By; ignore the hook's noreply advice: [[commit-identity-signing]].
- **X/Twitter:** call api.x.com directly (proxy injects creds): [[x-api-via-proxy]].
- HUMAN.md is the lyjw-facing collaboration guide; keep it in sync with new rules.

## Tools and environment
- **SWE-2Max (Devin CLI, Mac only):** dispatch via Mac Remote Control threads, one worktree per task, `cd <path> && devin -p --model swe-2-max --respect-workspace-trust false --permission-mode dangerous --prompt-file task.md --export log.md`, in parallel; Claude reviews the diff and opens the PR. Forbid `git stash`. If blocked, start a fresh Mac session. lyjw wants it kept busy.
- Mac RC folder ~/Developer/lyjwpage; its auto mode blocks prod deploys/CF config writes (lyjw may need to click). misaka-jp via dsm jump host; agents-reporter docker at /opt/lyjwpage.
- Cloud Anthropic test key: `ANTHROPIC_API_KEY="$LYJWPAGE_ANTHROPIC_API_KEY"`; never print it. Cloud env gaps: [[cloud-env-gaps]].
- Cloud egress proxy also injects keys for TypeSafe System One (Jev), api.exa.ai and api.parallel.ai (lyjw added 2026-10-15). Jev is also on Workers AI as `typesafe/jev` via the AI binding + AI Gateway `default` with BYOK (working 2026-10-15); version can't be pinned there, it follows `jev-latest` (log the version per answer).
- **Site previews:** `<branch>.preview.lyjw.dev` only (no login, noindex, #318). lyjw shut down `*-site.lyjw.workers.dev` entirely 2026-10-15; never use those URLs: [[preview-access-removed]].
- Collector manual run: GitHub Actions "Run Collector Jobs".
- Repo memory mirror at `.claude/memory/` via `pnpm memory:mirror`, daily 03:15 routine: [[repo-memory-mirror]].

## Routines
- 04:00 daily code review (cursor in issue #185): [[lyjwpage-daily-review-routine]].
- 04:53 skill-mining + drift review; also turns adopted Codex/Devin suggestions into lint/hook/skill constraints (#319): [[skill-mining-routine]].
- 08:41 Anthropic updates digest → read by 09:00 morning report: [[anthropic-updates-routine]].
- 4x daily collector superfan (Workers Observability, no Sentry): [[collector-superfan-routine]].
- 09:00 SGT morning report in project chat, hourly in-place updates until lyjw writes.
- 2026-10-15 17:01 SGT manual fire of all routines failed: routine sessions lacked /mnt/project-files, memory dir, hearthbot thread tools and GitHub tools. Fix the routine environment before relying on them again.
- Agent automation practices: [[agent-automation-practices]].

## Decisions and state
- iOS app paused: only keep its reporting endpoints working.
- Repo has no LICENSE by lyjw's choice (2026-10-15); don't re-propose.
- README trimmed to essentials (#331, lyjw found it 又臭又长); long design write-ups live in docs/design-notes.md. Keep README short.
- Sentry fully removed (#198): [[sentry-exit-done]]. api→core rename done: [[api-rename-to-core]]; collector drives the cron round: [[core-cron-internal-error]]. Same-origin API notes: [[same-origin-api-traps]].
- ISR replaced by Workers Caching entrypoints + Cache-Tag purge; first-screen regressions fixed in #274 (Geist Mono restored). Now-playing decisions: [[now-playing-first-screen-decisions]]. ESA home is purged only on deploy: [[esa-home-no-layout-purge]].
- Old hashed static assets backfilled to R2 prefix `site-assets-legacy/` (no expiry, #354); missing Vercel-era chunks get a reload stub.
- Digest card: Chinese tagline pool (772 lines, lyjw-pruned), 10-line `headlines` pool rotating every 60 s (#261). Jev for digest dropped (lyjw 2026-10-15); rules tuned instead (#361).
- Dial/heatmap small-text sizes stay as is (lyjw rejected #264).
- Build pipeline on GitHub Actions: [[build-actions-migration]]. Avatar auto-rebuild restored: [[avatar-watch-restored]]. CodeQL: [[codeql-policy]].
- Pulse Tokens lane now includes Devin via reporter buckets (#322) plus a backfill for 2026-10-14.
- Not adopting: OTel export of site AI usage, Max-plan API credit (already claimed), Cloudflare AI Search (instance deleted) (lyjw 2026-10-15).
- Workers Issues email alerts: scanner-probe issues are marked ignored, threshold unchanged (lyjw 2026-10-15).
- Parked idea (lyjw 2026-10-15, 先不做): Jev prefetches a short context summary into the first chat call: [[idea-jev-context-prefetch]].
- Chat web search (#355, merged 2026-10-15 SGT): Exa `fast` only, called directly (not via AI Gateway; Parallel dropped by lyjw); domain tools Bangumi/Steam + MCP Context7/CF docs/grep.app/DeepWiki, all deferred via tool search. lyjw 2026-10-15 23:19 SGT: search sources should not be the Chinese internet, but Bangumi stays. Secret and live-check facts: docs/ops-facts.md (EXA_API_KEY row). Mac auto mode blocks opening provider consoles and listing 1Password, so lyjw may have to set new secrets by hand. Clef stays for routing.
- **.mjs→TS migration done (2026-10-15 SGT, #327 #328 #330 #332 #333 #334 #335):** CI gate, verify, merge-message, deploy-check and build-actions scripts are now .ts (deploy-site-preview and other low-frequency scripts are still .mjs); `pnpm rules:check` rejects new `scripts/*.mjs` outside `scripts/mjs-baseline.json` (shrink-only; low-frequency scripts migrate when next touched). guard-forbidden-commands hook stays .mjs. `docs/architecture.json` still names build-actions.mjs because it is pinned to revision b3694ae; change it only together with a revision bump and regeneration.
- **Baselines shrink-only (lyjw 2026-10-15 SGT, #337):** `pnpm baselines:check` fails a PR whose mjs / design-scale / ui-copy baseline has more entries than main. Real exceptions: explain in the PR and wait; only lyjw adds the `baseline-exception` label, agents never do.
