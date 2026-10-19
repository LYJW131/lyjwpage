---
name: pulse-tokens-lane-coverage
description: Where coding-agent token usage comes from (Mac scanner, Cursor via agents, OTLP for cloud Claude Code and Mac Devin CLI); Pulse Tokens lane coverage and gaps
metadata:
  type: project
---

Every token figure counts input + output + cache read + cache write (`shared/coding-usage.ts#codingRowTokens`, #217). Pulse Tokens lane fields are `buckets.total` and `summary.totalTokens`.

Sources sending 5-minute buckets (all in the lane):
- `mac`: MacTelemetryHub's Claude Code + Codex JSONL scanner.
- `agents`: Cursor only (agents-reporter, account-level history).
- `agents-otlp` (`/api/ingest/agents/otlp`): cloud Claude Code (`claude_code.*` metrics → agent `claude`) and, since #436 (merged 2026-10-20 01:46 SGT from lyjw's Mac), Devin CLI on the Mac pushing its own OTel (`devin.token.usage` → agent `devin`). Map: `shared/ingest/agents-otlp.ts#METRICS`.

Devin CLI details (#436, #441):
- tokens.ci route is gone: agents-reporter's `devin-usage.ts` / `devin-buckets.ts` and `TOKENS_CI_USER` removed. agents-reporter still reports Devin's quota/limits row, not usage.
- Mac config: `~/.config/devin/config.json` `otel` block (metrics_endpoint used as-is, logs off because they carry prompt text) plus `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` in `~/.zshenv` (protobuf gets 400). Auth reuses the `lyjwpage-mac` service token, now granted `["ingest:mac", "ingest:agents-otlp"]` in `workers/ingress/wrangler.toml#ACCESS_CLIENTS`. Setup text: `workers/ingress/README.md`「Devin CLI（Mac）」.
- Devin only sends delta; core dedupes by per-series window (`coding:otlp` `windows`): resent or late old windows are skipped (undercount, never double). No cost metric, so `costComplete` is false on Devin days.
- Migration: first Devin OTLP moved the old `agents` devin day ledger into `agents-otlp` and deletes any later `agents` devin rows and buckets (`prepareCodingUsage` `moveFrom`). D1 keeps the old `source='agents'` rows.
- #441: site labels Devin's `agents-otlp` source as "Mac", not "Cloud", and its activity light goes off when the Mac declares itself offline (`src/lib/coding-agents.ts#codingSourceOnMac`).

History: from #322 (2026-10-14) to #436, Devin came from tokens.ci daily cumulatives spread into approximate buckets, plus a one-off 3.05B backfill from `~/.local/share/devin/cli/sessions.db` on 2026-10-14. Those days carried over in the migration.

Still daily ledgers only, no buckets: Grok Build, Antigravity, opencode, pi (ccusage on the Mac); Grok was ~6M tokens/day on 2026-10-13, a negligible gap.

**How to apply:** Devin usage problems → check the Mac's Devin otel config and the `lyjwpage-mac` token, not agents-reporter. Adding another agent to the lane: native OTel into `agents-otlp` if the agent supports it, else per-event parsing in MacTelemetryHub. iOS app not updated (paused).
