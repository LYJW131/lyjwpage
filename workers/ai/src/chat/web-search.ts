import type Anthropic from "@anthropic-ai/sdk";

// Haiku 5.5 用带动态过滤的版本时，首次调用常把参数包进 {"params": …} 被判 invalid_tool_input，白耗一次 max_uses；
// Opus 5.5、Fable 5.1 实测没有这个毛病，所以只有 Haiku 用基础版。max_uses 只管单次请求，调用方传这条回复还剩的次数（API 不收 0，剩 0 就别带这个工具）。
export function webSearchTool(model: string, maxUses: number): Anthropic.Beta.BetaToolUnion {
  return model.startsWith("claude-haiku-")
    ? { type: "web_search_20250305", name: "web_search", max_uses: maxUses }
    : { type: "web_search_20260318", name: "web_search", max_uses: maxUses };
}
