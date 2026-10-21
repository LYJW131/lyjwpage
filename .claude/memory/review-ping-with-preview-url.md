---
name: review-ping-with-preview-url
description: Cloud threads asking lyjw to review a PR must wait for the site branch preview to deploy, then post its <name>.preview.lyjw.dev URL and ping lyjw again
metadata:
  type: feedback
---

lyjw 2026-10-21 04:01 SGT (thread「周限额预测图加悬停卡片」, PR #512): 「以后在云端要我审核的 等site预览部署出来了贴出预览地址再叫我一次」.

**Why:** lyjw can't open the cloud dev server; screenshots alone are not enough to judge UI, lyjw wants to click the real page.

**How to apply:** for any PR from a cloud thread that waits on lyjw's review (UI/UX OK, big changes), after the push wait (with a timeout, [[waits-have-timeouts]]) until `https://<previewWorkerName(branch)>.preview.lyjw.dev/api/version` shows the head commit (`scripts/preview-worker-name.ts`), then send a second message with the preview link as markdown ([[links-as-markdown]]) and what to try. The first message with screenshots can still go out right away. If later pushes change what lyjw should look at, re-post the link once the new commit is live. Related: [[design-md-ui-approval]], [[preview-access-removed]].

**Gotcha (PR #512):** the site preview build waits for the core preview of the same SHA; a docs-only head commit gets no core preview, so a site build of it fails ("等不到本分支 … 的 Worker Preview"). Ping lyjw on a commit that touched watched paths, or push docs before the last code commit. A missed site preview build can be re-run with `POST /accounts/{id}/builds/workers/{site tag}/previews/{preview_id}/builds` (auto mode needs lyjw's explicit OK).
