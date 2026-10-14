---
name: verification-haiku-worker
description: Verification steps can be delegated to a Haiku 5.5 high Agent worker (lead decides/judges, worker executes); trial on #228 2026-10-13 was accurate at ~1/30 the cost
metadata:
  type: project
---

User asked (2026-10-13) to extract a verification skill from past threads and hand verification to Haiku 5.5 at effort high to cut cost. Skill proposed as `lyjwpage-verify` (propose_skills card in thread "提炼验证 skill 交给 Haiku"); check whether the user saved it before relying on it.

How: `Agent(subagent_type: "general-purpose", model: "haiku", effort: "high", run_in_background: true)` with a self-contained brief: forbidden actions (no edits/push/merge/GitHub comments/CF changes/hearthbot), what changed with measurable expectations, ordered checks, artifact paths, report table PASS/FAIL/SKIPPED + evidence. Lead spot-checks one screenshot and judges; bot-review triage, root cause, merge and rebuild decisions stay with the lead.

Trial 2026-10-13, post-merge check of #228 (exit-node card): both domains' /api/version, Workers Builds: site on main, Playwright 1280+375 with bbox/font measurements, SSR HTML. 91 s, 14 tool calls, all correct (screenshot spot-checked). Tokens: 815K cache read, 90K cache write, 2.2K output on claude-haiku-5-5. Estimated ~$0.02 vs ~$0.65 for the same tokens on Opus 5.5 (inferred: Haiku cache rates assumed 0.1x/1.25x of $0.10).

Container gotchas found: global Playwright at /opt/node22/lib/node_modules (createRequire); never waitUntil "networkidle" (polling + WS); WS 426 console errors are proxy noise; GitHub MCP check tools only see PR head checks, `gh api .../commits/<sha>/check-runs` (read-only) works for main. Related: [[workers-builds-parallel-race]], [[merge-requires-bot-review-pass]], [[ssr-fixture-proxy-e2e]].

Sign-off (2026-10-14, from poteto's pstack ledger, #289): the verifier ends its report with a receipt `验证回执 <full sha>：<level>` (live-ui-verified > unit-test-verified > type-check-only; verifier-blocked / verifier-failed don't pass); the lead posts it verbatim as a PR comment; `scripts/verify-receipt.mjs check --pr N [--need level] [--judge]` says whether the latest receipt/judge still covers head (exact, or carried when only main was merged in and `git patch-id` is unchanged). Break-in: user said keep it (2026-10-14 06:30Z) but end it automatically after 5 consecutive matching double-checks logged in `/mnt/project-files/verify-breakin/ledger.tsv`; a mismatch resets the count.
