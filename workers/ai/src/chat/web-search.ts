import type Anthropic from "@anthropic-ai/sdk";

// Haiku 5.5 用带动态过滤的版本时，首次调用常把参数包进 {"params": …} 被判 invalid_tool_input，白耗一次 max_uses；
// Opus 5.5、Fable 5.1 实测没有这个毛病，所以只有 Haiku 用基础版。max_uses 只管单次请求，调用方传这条回复还剩的次数（API 不收 0，剩 0 就别带这个工具）。
// 只给设计会话：规划者查外部开发文档。web_fetch 只能抓对话里已经出现过的 URL（访客给的或搜索结果里的），不能凭空访问。
export function webFetchTool(maxUses: number): Anthropic.Beta.BetaToolUnion {
  return { type: "web_fetch_20260318", name: "web_fetch", max_uses: maxUses, max_content_tokens: 8_000 };
}

export function webSearchTool(model: string, maxUses: number): Anthropic.Beta.BetaToolUnion {
  return model.startsWith("claude-haiku-")
    ? { type: "web_search_20250305", name: "web_search", max_uses: maxUses }
    : { type: "web_search_20260318", name: "web_search", max_uses: maxUses };
}

// 带动态过滤的搜索跑在服务端 code_execution 里；模型同一轮又调了客户端工具时，回复停在 tool_use，
// code_execution 留到下一轮请求才出结果，而那一轮的 tools 里必须还有搜索工具。
export function awaitsServerTool(messages: Anthropic.Beta.BetaMessageParam[]): boolean {
  const open = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type === "server_tool_use") open.add(block.id);
      else if ("tool_use_id" in block) open.delete(block.tool_use_id);
    }
  }
  return open.size > 0;
}
