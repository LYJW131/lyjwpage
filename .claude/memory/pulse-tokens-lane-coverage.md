---
name: pulse-tokens-lane-coverage
description: Where coding-agent token usage comes from (Mac scanner, Cursor via agents, OTLP agents-otlp for cloud, mac-otlp for Mac Devin CLI); Pulse Tokens lane coverage and gaps
metadata:
  type: project
---

Every token figure counts input + output + cache read + cache write (`shared/coding-usage.ts#codingRowTokens`, #217). Pulse Tokens lane fields are `buckets.total` and `summary.totalTokens`.

Sources sending 5-minute buckets (all in the lane):
- `mac`: MacTelemetryHub's Claude Code + Codex JSONL scanner.
- `agents`: Cursor only (agents-reporter, account-level history).
- `agents-otlp` (`/api/ingest/agents/otlp`, `lyjwpage-claude-cloud` token): cloud Claude Code (`claude_code.*` → agent `claude`) and cloud Devin CLI (env <cloud env>; `devin.token.usage` → `devin`; setup in `docs/ops-facts.md`「Claude Code 云端 routine」). Map: `shared/ingest/agents-otlp.ts#METRICS`.
- `mac-otlp` (same path, chosen by ingress from the verified credential's permission `ingest:mac-otlp`; mechanism #453, Mac token flip #456): Devin CLI on the Mac. The first mac-otlp batch moves the Mac's Devin ledger, buckets, activity and dedupe windows out of `agents-otlp` once.

Devin CLI details (#436, #441):
- tokens.ci route is gone: agents-reporter's `devin-usage.ts` / `devin-buckets.ts` and `TOKENS_CI_USER` removed. agents-reporter still reports Devin's quota/limits row, not usage.
- Mac config: `~/.config/devin/config.json` `otel` block (metrics_endpoint used as-is, logs off because they carry prompt text) plus `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` in `~/.zshenv` (protobuf gets 400). Auth reuses the `lyjwpage-mac` service token, granted `["ingest:mac", "ingest:mac-otlp"]` in `workers/ingress/wrangler.toml#ACCESS_CLIENTS`. Setup text: `workers/ingress/README.md`「Devin CLI（Mac）」.
- Devin only sends delta; core dedupes by per-series window (`coding:otlp` `windows`): resent or late old windows are skipped (undercount, never double). No cost metric, so `costComplete` is false on Devin days.
- Migration: first Devin OTLP moved the old `agents` devin day ledger into `agents-otlp` and deletes any later `agents` devin rows and buckets (`prepareCodingUsage` `moveFrom`). D1 archive only upserts, so moves leave duplicate rows there; lyjw chose manual cleanup (2026-10-20 04:31 SGT): `source='agents'` devin days/models deleted, its 678 buckets kept (only bucket record of that period). After the Mac's first `mac-otlp` batch, the same cleanup applies to D1 `agents-otlp` devin days/models/buckets dated before the move: list the exact rows to lyjw in the thread and delete only after an explicit OK.
- Site labels by source: `mac`/`mac-otlp` → Mac (light goes off when the Mac declares itself offline), `agents-otlp` → Cloud (`src/lib/coding-agents.ts#codingSourceOnMac`). iOS app still treats only `mac` as Mac (paused).

History: from #322 (2026-10-14) to #436, Devin came from tokens.ci daily cumulatives spread into approximate buckets, plus a one-off 3.05B backfill from `~/.local/share/devin/cli/sessions.db` on 2026-10-14.

Daily ledgers only, no buckets: Grok, Antigravity, opencode, pi (ccusage on the Mac); negligible.

OTLP sources do count sessions (per `session.id`) and active days (date union in `shared/coding-usage-view.ts#codingTotals`); verified on prod 2026-10-21 03:2x SGT: OTLP 326 of 2064 sessions, its 23 days all overlap Mac days so ACTIVE DAYS doesn't move. Only gap: pre-OTel Devin history has no session count. Per-source ledgers readable via Cloudflare DO query API (core_StateHub `global`, table `fields`, key `lyjwpage:coding:usage:<source>`).

**How to apply:** Devin usage problems → check the Devin otel config and the token for that side (`lyjwpage-mac` / Network secret for cloud), not agents-reporter. Adding another agent to the lane: native OTel into `agents-otlp` if the agent supports it, else per-event parsing in MacTelemetryHub. iOS app not updated (paused).
