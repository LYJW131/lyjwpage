---
name: prod-domain-lyjw-me
description: The production site is https://lyjw.me; lyjw.dev only hosts branch previews (<branch>.preview.lyjw.dev) and the bare lyjw.dev is unreachable from cloud
metadata:
  type: reference
---

Production site: `https://lyjw.me` (reachable from cloud containers; 200 on 2026-10-22 SGT). `lyjw.dev` is only the branch-preview domain (`<branch>.preview.lyjw.dev`); the bare `lyjw.dev` is refused by the cloud egress proxy.

**Why:** a thread on 2026-10-22 00:5x SGT called the site "lyjw.dev" and lyjw corrected it ("我们域名不是lyjw.me吗？？？").
**How to apply:** for any check against the live site, use lyjw.me. See [[preview-access-removed]].
