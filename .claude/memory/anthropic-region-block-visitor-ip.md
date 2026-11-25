---
name: anthropic-region-block-visitor-ip
description: Homepage chat Claude tiers 403 "Request not allowed" = Anthropic region block by the visitor's own IP (HK/CN), not key expiry; egress DO can't avoid it since Cloudflare 2026-10-30
metadata:
  type: project
---

2026-11-12 (thread「查与神对话调 Claude 失败」): lyjw saw Claude tiers fail and suspected an expired key. Not the key: same `ANTHROPIC_API_KEY` returns 200 on cron `GET /v1/sessions`. `POST /v1/messages` returned 403 `{"type":"forbidden","message":"Request not allowed"}` in 1–26 ms.

Joining each Anthropic call to its `/api/chat` by traceId: visitor `request.cf.country` US → always 200 (even via HKG colo); HK or CN → always 403, whether the `AnthropicEgress` DO is in KIX or wnam. Matches Cloudflare changelog 2026-10-30 (Worker subrequests to BYOIP hosts keep original client signals). lyjw's 11-10 tests were from a US IP; 11-12 from HK.

**Why:** the egress DO no longer changes who is blocked; this is Anthropic's region policy applied to the real visitor. Don't build ways around it.
**How to apply:** for "chat Claude 失败" first check visitor country vs status (Observability, traceId join) before suspecting keys. lyjw tests Claude tiers from a supported-region exit. lyjw chose (2026-11-12): drop the egress DO, keep the model, only make the error copy clear. PR #811 does that but lyjw said 「先停着不动 不合pr先」: don't merge until lyjw says so. wrangler (4.149–4.161) rejects `deleted_classes` for a class that arrived via `transferred_classes`, so #811 keeps an empty exported `AnthropicEgress` class instead of a delete migration. Pending on #811 (not pushed because of the hold): Codex P2 says `regionBlocked` misses a top-level body; it is wrong about the code (prod log shows nested `{"error":{"type":"forbidden",...}}`, SDK puts that in `error.type`), but `docs/ops-facts.md` row on the region block wrongly writes the body top-level; fix that doc and answer Codex「正文是嵌套的，见生产日志」. Related: [[chat-tiers]].
