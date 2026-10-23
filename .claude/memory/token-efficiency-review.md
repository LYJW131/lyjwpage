---
name: token-efficiency-review
description: 2026-10-23 token-efficiency scan of 45 threads: routines run fully on Opus and persistent sessions bloat; rework from building before measuring; proposals awaiting lyjw's OK
metadata:
  type: project
---

Thread「Token 效率复盘」(2026-10-23 06:3x SGT), report [Token 效率复盘](<private claude.ai link>). 8 Haiku workers scanned 45 threads (10-19 to 10-23) in under 3.5 min each.

Findings, ranked:
1. All 5 lyjwpage routines have an empty `model` field (default = lead model) and do every step there. Collector superfan ≈ $2.3/run API-equivalent (session cumulative modelUsage diff), 4 runs/day. Fix proposed: copy the memory-mirror prompt pattern (lead dispatches a Haiku/Sonnet worker, only judges).
2. Persistent routine sessions grow: morning-report session ran out of context 2026-10-22 14:10 SGT (~100M cumulative cache-read tokens); daily-review session ~$180 cumulative. Prompts already say "don't rely on session memory", so worker-dispatch fixes this too.
3. Rework: building before measuring the original (3D explainer style/audio, petergostev SVG→Canvas→three.js, trq212 replica before checking upstream was open source) or before getting raw evidence (Antigravity #546). Proposed one line in `lyjwpage-explainer`: Haiku style list + earshot audio + confirm tech route before dispatching authors.
4. Lead doing mechanical work despite `lyjwpage-delegate` (PageSpeed 10 runs after lyjw said 派sonnet; 379-link check on Opus max; tweet fetch/summarize in main thread).
5. Skill-mining reader reports uncapped (one ~20k tokens); proposed a word cap in reader-brief.md.

Status (lyjw 2026-10-23 06:34 SGT 「处理定时任务吧」): #566 merged: superfan steps 1–3b triage → Haiku high worker, anthropic-updates steps 2–3 → Sonnet medium reader, skill-mining reader reports ≤3000 字. Morning report prompt → whole read/draft by Sonnet medium worker; daily review prompt gained「## 分工」(steps 5–7 → opus high reviewer). New texts in /mnt/project-files/routine-prompts/ (morning-report.txt, daily-review.txt); each routine's own thread applies them (update_trigger refuses from other threads). Memory mirror unchanged (already Sonnet). Haiku scanners can't page routine session `list_events` (60–77k chars/page); use Sonnet for that. Related: [[verification-haiku-worker]], [[repo-memory-mirror]], [[collector-superfan-routine]].
