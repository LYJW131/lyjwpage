---
name: pulse-tokens-lane-coverage
description: Pulse Tokens lane counts cache reads (PR #217) but only covers agents with 5-min buckets (Claude Code, Codex, Cursor), not Grok/Antigravity/opencode/pi/Devin
metadata:
  type: project
---

Since PR #217 (merged 2026-10-13, f0c5260), every token figure on the site counts input + output + cache read + cache write (`shared/coding-usage.ts#codingRowTokens`). The Pulse Tokens lane fields are now `buckets.total` and `summary.totalTokens`. Before that they were `fresh` and `freshTokens`.

The lane still covers fewer agents than the daily total. Only these sources send 5-minute buckets: the Mac's Claude Code + Codex JSONL scanner (MacTelemetryHub `CodingTokenScanner.swift`), Cursor (agents-reporter) and Claude Code cloud OTLP.

These agents only send daily ledgers:
- Grok Build, Antigravity, opencode and pi, which come through ccusage on the Mac.
- Devin, because tokens.ci only offers daily data.

On 2026-10-13 Claude was about 1.92B tokens/day and Grok about 6M, so the gap was under 1%.

**How to apply:** if lyjw wants the lane to match the daily total, that is reporter work in the MacTelemetryHub repo, per-event parsing, Grok first. Devin cannot be covered. The iOS app was not updated for the rename (display side paused, [[ios-paused]]).
