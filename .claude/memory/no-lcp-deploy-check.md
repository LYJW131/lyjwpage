---
name: no-lcp-deploy-check
description: lyjw declined a post-deploy PageSpeed/LCP budget check in CI; the site's own PageSpeed card is enough
metadata:
  type: feedback
---

On 2026-10-15 lyjw closed PR #366, a `lcp-budget` job in purge-esa.yml that failed when mobile LCP went over budget. lyjw said: "站点就有数据 我每天都能看到" (the site has the data and lyjw sees it every day).

**Why:** the collector's `pagespeed` job already feeds a PageSpeed card on the site. lyjw doesn't want a second, CI-side alarm for the same numbers.

**How to apply:** don't propose deploy-time performance budgets or CI PageSpeed checks again. For first-screen speed work, measure ad hoc (PageSpeed via proxy, see [[pagespeed-via-proxy]]) and report the numbers in the thread. The `PAGESPEED_API_KEY` GitHub secret that lyjw added for #366 is now unused.
