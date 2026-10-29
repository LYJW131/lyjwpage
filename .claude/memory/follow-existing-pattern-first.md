---
name: follow-existing-pattern-first
description: Before designing a new mechanism (workflow, state carrier, notification), copy the closest existing pattern in the repo first; lyjw 2026-10-29 after 4 redesigns of the CodeQL alert carrier
metadata:
  type: feedback
  modified: 2026-10-29T06:16:09.199Z
---

lyjw 2026-10-29 14:15 SGT「这种操作应该是先按站点当前类似的实现来做呀 你看你今天改了多少次啊」.

The CodeQL alert hand-off to the daily review went through four designs in one day: artifact (#753) → bot draft PR (#758) → bot-opened, bot-edited issue (#760/#761) → a standing issue that lyjw opened (#763), where the bot only comments on changes and fix PRs write `Refs #763` (#764). The last one is just how #185 and #280 already work.

**Why:** each redesign cost a PR, a verify round and lyjw's attention; the right answer was already in the repo.

**How to apply:** before proposing any new workflow, state carrier, label or notification path, `rg` for the nearest existing equivalent (standing Automation issues #185/#280, avatar-sync PR flow, comment-check bot comments) and copy it. Name the pattern you copied in the first reply. Only deviate with a stated reason. Related: [[codeql-policy]], [[no-edge-case-hardening]].
