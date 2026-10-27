---
name: no-edge-case-hardening
description: lyjw rejects tightening guards or patching rare edge cases after a "why was it blocked/red" question; explain the cause, let lyjw pick looser or stricter
metadata:
  type: feedback
---

Three times lyjw rejected Claude defaulting to "stricter / more complete":
- 2026-10-27 04:05 SGT「算了你回退 这东西就是死抠边缘情况徒增复杂度了」. #697 made the advisory verify-pi skip on old branches; bot reviews grew it a merge-base check and a 67-line test. Reverted in #698.
- 2026-10-27 07:19 SGT「这个访客构建这里 我早就想说了 太过度防御了」「之后又不是不审查了」. Asked why a visitor-build PR (#707) was auto-closed, Claude opened #708 to tighten the guard; lyjw wanted it loosened (#710: only block paths that execute before merge).
- 2026-10-28 03:18 SGT「每次都抓一点边缘情况…我觉得是没有必要的」 about review rounds → #729 (review fixes one round, edge cases noted not fixed).

**Why:** a later human or bot review still catches what a looser guard lets through; rare or self-healing cases cost more code than they prevent.

**How to apply:** when asked why something was blocked or is red and the cause is the guard or a non-blocking check itself, explain the cause and stop; offer looser vs stricter for lyjw to pick. If a fix is asked for, keep the first simple version and push back on bot findings that only cover rarer cases. Root AGENTS.md「改法有轻有重」line carries the same rule. Related: [[verify-pi-ab-watch]], [[merge-requires-bot-review-pass]], the "Don't over-engineer" line in MEMORY.md.
