import { OAuthAuthorizationServer, OAuthResourceServer, type OAuthResourceHandler } from "@cloudflare/workers-oauth-provider";
import { OAUTH_AUTHORIZE_PATH, OAUTH_REGISTER_PATH, OAUTH_TOKEN_PATH } from "@shared/ai-paths";
import { MCP_AUTH_ISSUER, MCP_HISTORY_SCOPE, MCP_RESOURCE } from "@shared/mcp-auth";
import { site } from "@shared/site";

import type { Env } from "../runtime";

// 令牌里只放 GitHub 数字 ID；只有 lyjw 走得完授权（oauth/authorize.ts 在回调处拦），这里不再重复判断。
export type McpGrantProps = { githubId: number };

// 访问令牌一小时；刷新令牌闲置 30 天才过期，常用的客户端不必每月重新登录。
const ACCESS_TOKEN_TTL_S = 60 * 60;
const REFRESH_IDLE_TTL_S = 30 * 24 * 60 * 60;

export const authorizationServer = new OAuthAuthorizationServer<Env>({
  issuer: MCP_AUTH_ISSUER,
  resources: [MCP_RESOURCE],
  authorizeEndpoint: OAUTH_AUTHORIZE_PATH,
  tokenEndpoint: OAUTH_TOKEN_PATH,
  // MCP 2026-07-28 首选 CIMD；动态注册留给还不支持 CIMD 的客户端（如部分 Claude Code 版本）。
  clientIdMetadataDocumentEnabled: true,
  clientRegistrationEndpoint: OAUTH_REGISTER_PATH,
  scopesSupported: [MCP_HISTORY_SCOPE],
  accessTokenTTL: ACCESS_TOKEN_TTL_S,
  refreshTokenIdleTTL: REFRESH_IDLE_TTL_S,
});

export function mcpResourceServer(handler: OAuthResourceHandler<Env, McpGrantProps>) {
  return new OAuthResourceServer<Env, McpGrantProps>({
    resourceMetadata: {
      resource: MCP_RESOURCE,
      authorization_servers: [MCP_AUTH_ISSUER],
      bearer_methods_supported: ["header"],
      resource_name: site.name,
    },
    requiredScopes: [MCP_HISTORY_SCOPE],
    validateToken: (env) => (resource, token) => authorizationServer.validateToken<McpGrantProps>(resource, token, env),
    handler,
  });
}
