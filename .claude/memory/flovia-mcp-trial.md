---
name: flovia-mcp-trial
description: Flovia MCP (group-buy API aggregator, alpha) tried 2026-10-30 SGT; works, but adds little over existing egress APIs
metadata:
  type: reference
---

lyjw signed up for Flovia (@Flovia402, "group buying for API spend", Base-backed, alpha) and installed its MCP connector (tools `mcp__Flovia__flovia_*`: x, exa, firecrawl, contextdev, coingecko, nansen, zerion, quicknode, openai, runway, fal). Tried 2026-10-30 06:34 SGT.

- One shared free allowance (5-hour + weekly windows). X `quote_posts` 8 posts cost 10% of 5h / 4% of week, so X is ~200 posts/week free. Exa 1 search ≈1% of 5h; CoinGecko <1%.
- Every call needs `request_text`, `purpose`, and (X, Firecrawl) an `operation_id`.
- Firecrawl on `https://lyjw.me/` returned 408 timeout (not charged); cause not checked.
- Verdict: the session already has api.x.com, Exa, Parallel injected via proxy ([[x-api-via-proxy]]), so Flovia is only a fallback. Its X search is limited to 7 days.
