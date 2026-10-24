---
name: verify-effort-ab-result
description: Result of the Verify Action verifier effort A/B (high vs medium, #625) over 26 PRs / 31 runs, done 2026-10-25 SGT; A/B ended in #659; replaces the 10-27 reminder run
metadata:
  type: project
---

lyjw 2026-10-25 07:00 SGT「看一下验证action的a/b效果吧」. Done in thread「对比验证员 high 和 medium」; report Artifact <private claude.ai link>.

**The coordinator's reminder for 2026-10-27 06:32 SGT to run this same comparison is superseded: skip it** (unless lyjw asks for a re-run on newer PRs).

Data (PRs #628–#656, runs 2026-10-24 04:12 to 10-25 06:44 SGT, Sonnet worker read the A/B JSON lines from job logs):
- Level agreement 22/31. Of 9 disagreements: high right 4 (#656 Clawd overlap, #651, #644, #637 memory sync — all real defects medium missed), medium right 2 (#631, #628: high signed unit-test-verified without covering tests), 3 unclear/split.
- High had FAIL rows in 7 runs, medium in 3. #635: both saw 375px truncation, only high failed it.
- Medians high/medium: 110/75 s, output 19.6k/12.7k tokens, thinking 15.4k/8.1k, $0.032/$0.022; 31-run totals $1.70/$0.92. UI-tier medium is sometimes slower (#650 940 s vs 621 s).
- #654/#648 differences were WebFetch denied for high, medium used curl: tool, not reasoning.

lyjw chose 2026-10-25 07:17 SGT「保留 high，停掉 A/B」. PR #659 removed the A/B job and added two prompt lines: no unit-test-verified unless covering unit tests ran; on WebFetch denial use curl.

Same thread, lyjw 2026-10-25 07:21 SGT picked「只跳过纯注释和文档改动」: after a passing receipt, pushes that only touch docs-tier files or code comments reuse it (coverage `notes-only`) and the verifier is not rerun; small code changes still re-verify. Also in #659.

Related: [[verify-in-actions-plan]], [[verify-action-token-usage]], [[verify-run-timing]].
