import { MCP_PATH } from "./ai-paths";
import { site } from "./site";

// /mcp 不带令牌照样公开可用；带了 OAuth 令牌（只发给 lyjw 的 GitHub 账号）才多读私有历史。
export const MCP_AUTH_ISSUER = site.url;
export const MCP_RESOURCE = `${site.url}${MCP_PATH}`;
export const MCP_HISTORY_SCOPE = "history:read";
