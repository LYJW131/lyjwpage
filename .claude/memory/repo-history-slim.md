---
name: repo-history-slim
description: Repo git size analysis and the deferred plan to replace main with media-stripped history (lyjw 2026-10-23: noted, not now)
metadata:
  type: project
---

Measured 2026-10-23 (thread「仓库 git 体积」): main history ~81 MiB packed (all branches 114 MiB). Audio mp3 ~51%, png/webp/gif ~29%; deleted-path media ~50 MiB (v2/score.mp3 23 MiB, architecture-*.png 12 MiB, old docs/screenshots ~10 MiB). v1 explainer music `docs/explainer/music-*.mp3` (~19 MiB) removed from main in #579 and gitignored.

Branch `slim-history-preview` (9c6741d) = main before #579 rewritten with git-filter-repo dropping 53 media paths not in HEAD tree: 33 MiB, tree identical. Stripping all mp3+png too: 14 MiB (code ~5.5, explainer font subsets 2.5, commits/trees 2.3, md 1.4).

**Deferred** (lyjw 2026-10-23 16:51 SGT「先记下吧 之后想做再说」): making it the new main. Plan if revived: freeze merges; re-run filter on latest main; archive old main OUTSIDE this repo (private archive repo or git bundle), else objects stay; lift no-force-push, force-push, restore; delete stale branches, rebuild open PRs. Costs: all SHAs change (issue #185 cursor, receipts, links), old commit signatures lost, Mac and misaka clones reset; GitHub-side size may not drop (refs/pull/* need GitHub Support). Gain: clone ~114 MB → ~15 MB.
