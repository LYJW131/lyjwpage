export const BUILD_PATH = "/api/build";
export const BUILD_SESSION_PATH = "/api/build/session";
export const BUILD_STATUS_PATH = "/api/build/status";
export const BUILD_UPLOAD_PATH = "/api/build/upload";
export const BUILD_PROGRESS_PATH = "/api/build/progress";
export const BUILD_WEBHOOK_PATH = "/api/build/webhook";

export const GOD_CHAT_PATH = "/api/chat";
export const GOD_CHAT_USAGE_PATH = "/api/chat/usage";
export const GITHUB_ISSUE_PATH = "/api/github/issue";
export const MCP_PATH = "/mcp";

export const AI_HTTP_PATHS = new Set([GOD_CHAT_PATH, GOD_CHAT_USAGE_PATH, GITHUB_ISSUE_PATH, MCP_PATH, BUILD_PATH, BUILD_SESSION_PATH, BUILD_STATUS_PATH, BUILD_UPLOAD_PATH, BUILD_PROGRESS_PATH, BUILD_WEBHOOK_PATH]);
