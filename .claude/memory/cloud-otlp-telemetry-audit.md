---
name: cloud-otlp-telemetry-audit
description: 2026-10-29 audit of Devin and cloud Claude Code OTLP token telemetry; Claude main process needs OTEL_EXPORTER_OTLP_HEADERS in env vars
metadata:
  type: project
---

Audit 2026-10-29 00:30 SGT (thread「修云端 token 遥测漏记」), from lyjw asking why Devin showed only 53M for 10-28.

**Devin is fine (~92%).** 10-28 SGT real usage 57.3M (cloud eval thread 50.7M + Mac 6.6M, summed from sessions.db) vs ledger 52.5M. Output matches within 1%; the gap is prompt-side, likely runs killed or interrupted before their last export. `devin -p` flushes on exit. Devin only ran 21:30–24:00 SGT that day, so the small number was real.
- Ground truth: sum assistant `metadata.metrics` (dedupe by session + message_id) in `~/.local/share/devin/cli/sessions.db`; script `/mnt/project-files/devin-telemetry-check/devin_usage.py` (prints per-SGT-day totals, read-only).
- Ingress arrivals per user-agent/ISP: Workers Observability on script `ingress`, trigger `POST /api/ingest/agents/otlp` (Devin = `Go-http-client/1.1`, Claude = `OTel-OTLP-Exporter-JavaScript`).

**Cloud Claude Code stopped 10-27 20:27 SGT.** The session's main Claude process does not go through the container's egress proxy (its env has no HTTPS_PROXY), so the Network secret can't add the Access headers; it needs `OTEL_EXPORTER_OTLP_HEADERS` (CF-Access-Client-Id/Secret of `lyjwpage-claude-cloud`) in the env vars. The var was dropped when env vars were re-entered after #717; every cloud session (threads, project chat, routines, in-process subagents) lost usage. Child processes (Devin, tokens, `claude -p`) get HTTPS_PROXY and work without it. Symptom: `/tmp/claude-code.log` shows `[3P telemetry] ... metrics export failed (Unauthorized)` each minute. Fix 2026-10-29 00:3x SGT: lyjw rotated the `lyjwpage-claude-cloud` secret (client id unchanged, so no wrangler/Access change) and re-added the env var; a new session logged `First metrics export: SUCCESS` and ingress got 200s from 00:40 SGT. lyjw first wanted one place only (deleted the Network secret), but Devin can't read `OTEL_*` (Claude strips them from children, setup script can't read saved env vars), so lyjw chose to keep both: env var for the main process, Network secret for children. Rotating this credential = update both. Lost window not recoverable.

**How to apply:** if cloud Claude rows stop, grep `/tmp/claude-code.log` for `3P telemetry` first. Never tell lyjw the header var is optional for Claude Code. Related: [[pulse-tokens-lane-coverage]], [[credentials-pipe-only]].
