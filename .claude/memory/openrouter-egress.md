---
name: openrouter-egress
description: Cloud sessions can call OpenRouter keyless (proxy injects lyjw's capped key on openrouter.ai/api/v1/); what works and what is blocked
metadata:
  type: reference
---

lyjw added an egress secret 2026-10-20 14:54 SGT: host `openrouter.ai`, path `/api/v1/`, Bearer injected; the key has a spending cap ("额度是有限制的"), so keep experiments cheap. Use it for trying new models, not production.

Verified 2026-10-20 SGT: `/api/v1/models`, `/api/v1/credits`, `/api/v1/chat/completions` and the Anthropic-compatible `/api/v1/messages` (Anthropic SDK works with baseURL `https://openrouter.ai/api`; drop `x-api-key`). Inception models (`inception/mercury-3`) work. `anthropic/*` and `openai/*` models answer 403 "violation of provider Terms Of Service", so cross-vendor comparisons need the direct APIs (DeepSeek via api.deepseek.com injection, Anthropic via `LYJWPAGE_ANTHROPIC_API_KEY`). New models can hit 429 "rate-limited upstream" from OpenRouter's shared pool; retry with backoff.

Real-chat model swaps: run the chat handler like `workers/ai/scripts/chat-probe.ts` with a fetch shim rewriting api.deepseek.com to OpenRouter (Mercury needs the `role: "system"` + `output_config` effort messages hoisted out). Result of the Mercury 3 trial: [[not-adopting]].
