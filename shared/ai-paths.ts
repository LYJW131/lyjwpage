export const GOD_CHAT_PATH = "/api/chat";
export const GOD_CHAT_USAGE_PATH = "/api/chat/usage";
export const GITHUB_ISSUE_PATH = "/api/github/issue";
export const MCP_PATH = "/mcp";
export const MCP_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";
export const MCP_RESOURCE_METADATA_ROOT_PATH = "/.well-known/oauth-protected-resource";

export const AI_HTTP_PATHS = new Set([
  GOD_CHAT_PATH, GOD_CHAT_USAGE_PATH, GITHUB_ISSUE_PATH, MCP_PATH,
  MCP_RESOURCE_METADATA_PATH, MCP_RESOURCE_METADATA_ROOT_PATH,
]);
