---
name: haiku-vs-deepseek-flash-bench
description: Where lyjw's Haiku 5.5 vs DeepSeek Flash comparison lives (aapay project, 2026-10-08, Mac session, not a PR)
metadata:
  type: reference
---

2026-10-08 (SGT 12:00–17:30), aapay project on lyjw's Mac (not lyjwpage, no PR). 145 req per model (19+10 cases × 5 rounds): pass DeepSeek deepseek-flash(thinking) 100% / Haiku 5.5 medium 99.3% / Haiku low 98.6% / Gemini flash-lite 95.2%; text median 2.3/2.7/2.5/2.5s; image 2.6/3.3/3.3/5.2s; cost DeepSeek $0.0017 peak ($0.0009 off-peak), Haiku $0.0010, Gemini $0.0027. Verdict: Haiku ≈ DeepSeek; prod DeepSeek, Haiku backup; Haiku low not worth it. Raw: aapay worktree ai-native-accounting-tool-2baa67 `.claude/bench/` (four.jsonl, haiku-final.jsonl); session jsonl 0196ebfd-…; commits fe9ea64, b9ed086 in LYJW131/aapay. DeepSeek API has no per-day usage endpoint (only /user/balance).

Also 2026-10-26 lyjwpage #665 verifier A/B (the one lyjw usually means): table in PR body as "DS max" (DeepSeek-V4.1-Flash max thinking via pi). Round 2: CC·Haiku 16/24, pi·Haiku 17–20, pi·DS max 13–16 at ~2× cost, 1.5× slower → kept Haiku. Round 1: DeepSeek judged too leniently (2/8 FAIL vs Haiku 5–6).
