---
name: fixes-merge-without-asking
description: Clear bug fixes and small changes (even with a UI touch) merge once CI is green, without waiting for lyjw's OK
metadata:
  type: feedback
---

lyjw 2026-10-20 05:11 SGT, on PR #475 (a one-rule CSS fix for the Recently Played rows jumping 4→3→4): "直接合 明确修复+小改动不用问".

**Why:** lyjw doesn't want to approve obvious fixes. Waiting for a nod on them only stalls the thread.

**How to apply:** if a PR is a clear bug fix or a small change, merge it once CI and the bot reviews are clean. This also applies when the change touches UI and the static look does not change. Still wait for lyjw's look-and-OK on real UI/UX changes, meaning anything that changes what the page looks like. Narrows [[design-md-ui-approval]].
