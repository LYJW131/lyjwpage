import type Anthropic from "@anthropic-ai/sdk";

export const TOOL_SEARCH_TOOL: Anthropic.Beta.Messages.BetaToolSearchToolBm25_20251119 = { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" };

export const DOC_SEARCH_BETA = "mcp-client-2025-11-20";

// Anthropic 服务端代连这些公开的只读 MCP（免 key），Worker 不出站；每个服务器的工具白名单固定，服务端以后新增的工具不会自动进对话。
// 白名单里的工具都 defer_loading，模型经 tool search 找到才加载定义。
const SERVERS = [
  { name: "context7", url: "https://mcp.context7.com/mcp", tools: { "resolve-library-id": "libraryName", "query-docs": "query" } },
  { name: "cloudflare-docs", url: "https://docs.mcp.cloudflare.com/mcp", tools: { search_cloudflare_documentation: "query" } },
  { name: "grep-app", url: "https://mcp.grep.app", tools: { searchGitHub: "query" } },
  { name: "deepwiki", url: "https://mcp.deepwiki.com/mcp", tools: { ask_wiki_question: "question" } },
] as const;

export const DOC_SEARCH_SERVERS: Anthropic.Beta.BetaRequestMCPServerURLDefinition[] = SERVERS.map(({ name, url }) => ({ type: "url", name, url }));

export const DOC_SEARCH_TOOLSETS: Anthropic.Beta.BetaMCPToolset[] = SERVERS.map(({ name, tools }) => ({
  type: "mcp_toolset",
  mcp_server_name: name,
  default_config: { enabled: false },
  configs: Object.fromEntries(Object.keys(tools).map((tool) => [tool, { enabled: true, defer_loading: true }])),
}));

export function docSearchQuery(server: string, tool: string, input: unknown): string | undefined {
  const field = SERVERS.find((candidate) => candidate.name === server)?.tools[tool as never] as string | undefined;
  const value = field && (input as Record<string, unknown> | null)?.[field];
  return typeof value === "string" && value ? value : undefined;
}
