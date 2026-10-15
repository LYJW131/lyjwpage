import type Anthropic from "@anthropic-ai/sdk";

export const DOC_SEARCH_BETA = "mcp-client-2025-11-20";

// Anthropic 服务端代连这两个公开的只读文档 MCP（免 key），Worker 不出站；每个服务器的工具白名单固定，服务端以后新增的工具不会自动进对话。
const SERVERS = [
  { name: "context7", url: "https://mcp.context7.com/mcp", tools: { "resolve-library-id": "libraryName", "query-docs": "query" } },
  { name: "cloudflare-docs", url: "https://docs.mcp.cloudflare.com/mcp", tools: { search_cloudflare_documentation: "query" } },
] as const;

export const DOC_SEARCH_SERVERS: Anthropic.Beta.BetaRequestMCPServerURLDefinition[] = SERVERS.map(({ name, url }) => ({ type: "url", name, url }));

export const DOC_SEARCH_TOOLSETS: Anthropic.Beta.BetaMCPToolset[] = SERVERS.map(({ name, tools }) => ({
  type: "mcp_toolset",
  mcp_server_name: name,
  default_config: { enabled: false },
  configs: Object.fromEntries(Object.keys(tools).map((tool) => [tool, { enabled: true }])),
}));

export function docSearchQuery(server: string, tool: string, input: unknown): string | undefined {
  const field = SERVERS.find((candidate) => candidate.name === server)?.tools[tool as never] as string | undefined;
  const value = field && (input as Record<string, unknown> | null)?.[field];
  return typeof value === "string" && value ? value : undefined;
}
