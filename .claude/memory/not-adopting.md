---
name: not-adopting
description: Tools and ideas lyjw or Claude decided not to adopt for lyjwpage, with reasons; check before proposing
metadata:
  type: project
---

Not adopting: Inception Mercury 3 for the chat Small Fry tier (tested 2026-10-20 SGT with the real flash prompt + tools via OpenRouter: per-round first token ~0.6-0.85 s vs DeepSeek Flash ~0.9-1.4 s, but worse persona/tool use, gives up on 404 views, 400s on mid-conversation `output_config` effort messages, launch rate limits made 3/6 turns wait 54 s-2 min; see [[openrouter-egress]]); seiso doc linter (lyjw 2026-10-19 22:39 SGT, overlaps docs:check, Chinese false positives; #428 closed, #429 note), OTel export of site AI usage, Max-plan API credit (already claimed), Cloudflare AI Search (instance deleted), post-deploy PageSpeed check (lyjw 2026-10-15). pstack /create-formal-verification-skill: tried once as a TLA+ audit of BuildCoordinator 2026-10-19, no bug found, not kept in repo; model in /mnt/project-files/formal-verification/build-run/, entry in docs/references.md.

Formal verification update (lyjw 2026-10-20 02:03 SGT): standing checks stay rejected, but on-demand TLA+ modelling for race/ordering/retry bugs is adopted as skill `lyjwpage-formal-model` (Boris Cherny's four steps: model, counterexample, reproduce, fix), linked from `lyjwpage-diagnose` step 2. Lean is not used. Explainer report: [形式化验证是什么](<private claude.ai link>).

Site Worker image fetching stays in the site Worker (lyjw 2026-10-22 22:01 SGT「不搬了」): README card inlining (`src/lib/remote-image.ts`) and the `/image` proxy fetch allowlisted public image hosts directly. Devin Review flagged it on #554 as breaking the「站点侧不写后端」rule. It is not a breach in spirit: no secrets, no state, no IP rate limits involved. Don't move it to collector/core, and answer the same bot finding with this.

Jev 1.14 as a second PR verifier beside the Haiku Verify Action (lyjw 2026-10-23 18:17 SGT「不进main」): fast and near-free but reads only the diff, borderline on a bug the test locks in, generic image questions noisy. Details [[jev-verify-trial]].

Also not adopting: tester-army / e2e suites; Jev as explainer image checker ([[jev-vision-qa-result]]); Gemini as explainer video checker ([[gemini-video-qa-result]]); splitting main CI (2026-10-22); skipping CI on docs PRs (2026-10-23); Blacksmith or GitHub larger runners (2026-10-23: org-only; the public repo's ubuntu-latest is already a free 4-core runner).
