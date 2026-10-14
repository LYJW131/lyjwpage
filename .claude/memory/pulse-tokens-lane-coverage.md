---
name: pulse-tokens-lane-coverage
description: Pulse Tokens lane counts cache reads (PR #217); covers Claude Code, Codex, Cursor, cloud OTLP and Devin (#322, timing approximate), not Grok/Antigravity/opencode/pi
metadata:
  type: project
---

Since PR #217 (merged 2026-10-13, f0c5260), every token figure on the site counts input + output + cache read + cache write (`shared/coding-usage.ts#codingRowTokens`). The Pulse Tokens lane fields are now `buckets.total` and `summary.totalTokens`. Before that they were `fresh` and `freshTokens`.

The lane still covers fewer agents than the daily total. These sources send 5-minute buckets:
- the Mac's Claude Code + Codex JSONL scanner (MacTelemetryHub `CodingTokenScanner.swift`)
- Cursor (agents-reporter)
- Claude Code cloud OTLP
- Devin CLI (agents-reporter, PR #322, merged 2026-10-14). tokens.ci only gives daily cumulatives, so the reporter spreads each growth evenly between two tokens.ci `updatedAt` submissions (`reporters/agents-reporter/src/devin-buckets.ts`). Totals are real and timing is approximate, because tokens.ci submits only every tens of minutes. Core merges bucket reports per agent (`shared/coding-buckets.ts#mergeBucketReport`), so Cursor and Devin, both on source `agents`, don't wipe each other.

Backfill: on 2026-10-14 a Mac Haiku session extracted exact per-message Devin tokens from `~/.local/share/devin/cli/sessions.db` and pushed 3.05B of buckets once, for the range before the reporter ledger's `since`. lyjw approved it; Mac auto mode blocked it until then. Afterwards the lane went from 3.43B to 6.47B and the digest card showed 6.5B after a manual "Run Collector Jobs" with `digest`. The precise long-term route, still pending lyjw's answer, is for MacTelemetryHub to read sessions.db directly.

Only daily ledgers, no buckets: Grok Build, Antigravity, opencode and pi (through ccusage on the Mac). On 2026-10-13 Grok was about 6M tokens a day, a negligible gap.

**How to apply:** if lyjw wants the remaining agents in the lane, that is per-event parsing in MacTelemetryHub, Grok first. The iOS app was not updated for the rename (display side paused, [[ios-paused]]).
