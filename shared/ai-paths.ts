export const BUILD_PATH = "/api/build";
export const BUILD_STATUS_PATH = "/api/build/status";
export const BUILD_ISSUE_PATH = "/api/build/issue";
export const BUILD_UPLOAD_PATH = "/api/build/upload";
export const BUILD_PROGRESS_PATH = "/api/build/progress";
export const BUILD_SCREENSHOT_PATH = "/api/build/screenshot";
export const BUILD_WEBHOOK_PATH = "/api/build/webhook";

export const GOD_CHAT_PATH = "/api/chat";
export const GOD_CHAT_USAGE_PATH = "/api/chat/usage";
export const MCP_PATH = "/mcp";

// /mcp 的 OAuth 授权服务器（只发令牌给 lyjw 的 GitHub 账号），由 ai Worker 回答。
export const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";
export const OAUTH_TOKEN_PATH = "/oauth/token";
export const OAUTH_REGISTER_PATH = "/oauth/register";
// 须登记在 GitHub App 的回调地址里（GitHub 严格匹配），见 docs/ops-facts.md 的 GitHub App 一行。
export const OAUTH_GITHUB_CALLBACK_PATH = "/oauth/github/callback";
export const OAUTH_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";
export const MCP_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;
export const OAUTH_HTTP_PATHS = new Set([
  OAUTH_AUTHORIZE_PATH,
  OAUTH_TOKEN_PATH,
  OAUTH_REGISTER_PATH,
  OAUTH_GITHUB_CALLBACK_PATH,
  OAUTH_SERVER_METADATA_PATH,
  MCP_RESOURCE_METADATA_PATH,
]);

export const AI_HTTP_PATHS = new Set([GOD_CHAT_PATH, GOD_CHAT_USAGE_PATH, MCP_PATH, BUILD_PATH, BUILD_STATUS_PATH, BUILD_ISSUE_PATH, BUILD_UPLOAD_PATH, BUILD_PROGRESS_PATH, BUILD_SCREENSHOT_PATH, BUILD_WEBHOOK_PATH, ...OAUTH_HTTP_PATHS]);
