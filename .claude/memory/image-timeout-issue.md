---
name: image-timeout-issue
description: Workers Issue "[image] The operation was aborted due to timeout" on site (c83cb225) is Apple image hosts timing out at 8s; its email count is cumulative since 2026-10-14
metadata:
  type: project
---

Thread "查 CF 邮件里 121 次同一问题" (2026-10-29 SGT): lyjw got a Workers Issues email "在 site 中观察到 121 次相同的问题".
- Issue `c83cb225-11f4-409f-8c45-4f907208abf6`, title `[image] The operation was aborted due to timeout`, entrypoint `ImageVariants`, 502 on `/image`.
- Cause: `fetchImageUpstream` (`src/lib/image-proxy.ts`, `IMAGE_UPSTREAM_TIMEOUT_MS`) aborts after 8s on mzstatic.com / blobstore.apple.com; the TimeoutError is not an `ImageUpstreamError`, so `workers/site/src/index.ts` logs `[image]` and returns 502. The comment in image-proxy says timeouts are meant to alert as gateway failures.
- The number in the email is the issue's lifetime count. The mail comes from automation 「沉寂一天后复发发邮件」 (recurrence after 24h quiet), not a burst. 115 by 2026-10-23, 121 by 2026-10-29: about 1 per day.
- Decision: left as-is, no code change (alerts stay as-is, see MEMORY.md). If the rate jumps, look at which host times out via telemetry `$workers.event.request.url`.
- Same day's other email (974 times) is the `security` issue "Potential vulnerability scan · known-scanner-path", already `ignored`.
