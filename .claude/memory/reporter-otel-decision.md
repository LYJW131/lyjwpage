---
name: reporter-otel-decision
description: lyjw chose not to migrate reporter telemetry to OTel/OTLP (2026-10-19); reasons and exceptions
metadata:
  type: project
---

**No OTel/OTLP migration of reporter telemetry** (lyjw 2026-10-19 18:36 SGT chose 维持现状; Devin CLI was later moved to native OTel by lyjw anyway, #436). Why: most data is state (now playing, presence, rings, ledgers) with no semconv; iPhone endpoint must stay; Mac icon / Emby image receipts don't fit OTLP responses; HA has no OTLP export. Only native-OTel agents fit (cloud Claude Code and Mac Devin CLI do). Report: [遥测换 OTel 评估](<private claude.ai link>). Don't re-propose.
