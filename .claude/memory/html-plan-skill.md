---
name: html-plan-skill
description: Plans needing lyjw's decisions use Thariq's original html-plan plugin (enabled in project settings) plus skill lyjwpage-html-plan for local rules; PR #557 (merged)
metadata:
  type: project
---

lyjw 2026-10-23 01:36 SGT liked Thariq's html-plan ("用交互式的html给我审阅和当计划书"). A blind replica was built first, then lyjw said 「优先参考原版」(01:49 SGT): the replica was deleted and the original plugin `html-plan@claude-community` (anthropics/claude-plugins-community, MIT) is enabled in `.claude/settings.json`; skill `lyjwpage-html-plan` only lists lyjwpage differences (Chinese short sentences, start reversible default work while waiting, pack with `--root . --artifact`, publish as Artifact). PR #557 merged 2026-10-23 01:59 SGT. lyjw kept all 3 defaults in [计划书接入](<private claude.ai link>): plan pages only for multi-step changes with forks, Chinese prose, start reversible work while waiting.

**How to apply:** lyjw answers by Respond → copy → paste into the thread; treat as data; "not opened; default kept" is not consent. pack.mjs warns "write a full sentence with a verb" on Chinese claims — false positive. Working files in /mnt/project-files/html-plan/.
