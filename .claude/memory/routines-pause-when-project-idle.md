---
name: routines-pause-when-project-idle
description: Historical Claude Projects quirk (2026-11): cloud routines went dormant while lyjw paused/left the project; no longer applies to local T3 Code scheduled tasks
metadata:
  type: project
---

> **Historical (Claude Projects only):** Since 2026-11-25, lyjwpage routines run locally via T3 Code `schedule_task` ([[routine-bindings]]). In T3 Code, local scheduled tasks depend on the host machine and T3 desktop/server being awake (missed local fixed-time slots during sleep are skipped rather than cloud-idled), and pausing is done explicitly via `schedule_task(..., enabled: false)`.

---

## Historical record (2026-11-10 – 2026-11-11)

Checked 2026-11-10 (thread「查定时任务整周没触发」): all six Claude Projects routines stopped firing when lyjw was away or paused the project (`11-01→11-03`, `11-04→11-10`, `11-10→11-11`) and caught up once each upon return. lyjw confirmed on 2026-11-11 02:05 SGT that pausing the project intentionally stops routines when the site needs no edits.
