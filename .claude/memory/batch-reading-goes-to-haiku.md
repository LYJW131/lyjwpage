---
name: batch-reading-goes-to-haiku
description: Paging through session transcripts / records in bulk goes to a cheap worker (Haiku or Sonnet, case by case), never the lead and never an unspecified model
metadata:
  type: feedback
---

lyjw 2026-10-24 04:46 SGT「大量翻记录就得派 haiku 去」, then 04:50 SGT softened it:「sonnet 和 haiku 都可以 之后看着办吧」. So `lyjwpage-delegate`'s table (成批读 → Sonnet medium) stays as is.

**Why:** cost. Record scanning must not run on Opus.

**How to apply:** bulk reading of transcripts, thread history, logs → Haiku high or Sonnet medium worker, by volume and difficulty. With Haiku, split small and give it a parser script so it never reads raw pages: `list_events` pages bloat with thinking signatures, and a `kinds` filter is applied after the page is read (limit 30 gave about 7 assistant events). Related: [[token-efficiency-review]], [[verification-haiku-worker]].
