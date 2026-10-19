---
name: file-size-rule
description: Soft file-size rule in root AGENTS.md; lyjw declined a hard gate, merge only natural splits
metadata:
  type: project
---

**File-size rule (soft, no gate):** lyjw declined a 5,000-token gate 2026-10-19 17:13 SGT, then had a whole-repo split tried (#435): ~3/4 of splits were natural, ~1/4 only to pass the line. lyjw 2026-10-20 00:46 SGT: merge only the natural splits, and only when no other thread is editing those files. Constraint is a soft line in root AGENTS.md (touching a source file over ~20 KB → split one piece by responsibility; skip if no natural boundary). Don't re-propose a hard gate; a non-blocking hint hook needs lyjw's OK.
