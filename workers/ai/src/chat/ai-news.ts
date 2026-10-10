import type Anthropic from "@anthropic-ai/sdk";

export const AI_NEWS_BETA = "mcp-client-2025-11-20";
export const AI_NEWS_SEARCH_TOOL = "aihot_search";

// Anthropic 服务端代连这个公开的只读 MCP（无鉴权），Worker 不出站；工具白名单固定，服务端以后新增的工具不会自动进对话。
export const AI_NEWS_SERVER: Anthropic.Beta.BetaRequestMCPServerURLDefinition = {
  type: "url",
  name: "aihot",
  url: "https://aihot.news/api/mcp",
};

export const AI_NEWS_TOOLSET: Anthropic.Beta.BetaMCPToolset = {
  type: "mcp_toolset",
  mcp_server_name: AI_NEWS_SERVER.name,
  default_config: { enabled: false },
  configs: Object.fromEntries(
    ["aihot_get_latest", AI_NEWS_SEARCH_TOOL, "aihot_get_hot_topics", "aihot_get_story", "aihot_get_daily", "aihot_get_weekly", "aihot_get_monthly"].map((name) => [name, { enabled: true }]),
  ),
};
