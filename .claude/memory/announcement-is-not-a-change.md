---
name: announcement-is-not-a-change
description: When lyjw forwards a vendor announcement (plan rename, limit change), only report the impact; change code only after the data the site reads actually changes
metadata:
  type: feedback
---

2026-10-31 SGT: lyjw mentioned that Claude renamed its Max plans (Max 5x → Max, Max 20x → Ultra, 5-hour limit removed for verified Ultra). A thread shipped a hand-written label mapping (#785) at once. lyjw had it reverted (#786):「我只是提醒你一下有改名这个事 没让你直接」「别手动映射啊 它出什么就是什么」「他只是宣布了 没有生效这么快 你看我现在 5 小时限制都还在」.

**Why:** announcements roll out slowly. The API still returned `default_claude_max_20x` and a 5-hour window. Mapping ahead of the data is a copy-only change that can go wrong, and lyjw wants the site to show what the source sends.

**How to apply:** for a vendor announcement, list the affected places and what would change, then stop. Act only when the reporter's raw data changes (new `rate_limit_tier`, `five_hour` gone). At that point, remove the 5-hour bar for Claude and check the card layout (lyjw's ask). Don't add new hand-written plan-name mappings. If you need the raw API value, read it on misaka-jp through the Mac session instead of inferring it. See [[site-small-decisions]].

Follow-up 2026-11-01 00:12 SGT: raw read on misaka-jp showed `five_hour: null` (5-hour limit really gone), `rate_limit_tier` still `default_claude_max_20x`. The profile `organization` also has `plan_display_name` and `plan_display_label` (values not read yet); those are the official display names to use if the plan label ever needs to follow a rename. #788 dropped the 5-hour row and kept the other rows in place on desktop.
