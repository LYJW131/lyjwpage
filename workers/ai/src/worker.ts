import Anthropic from "@anthropic-ai/sdk";
import { insufficientScope } from "@cloudflare/workers-oauth-provider";

import {
  AI_HTTP_PATHS,
  BUILD_PATH,
  BUILD_STATUS_PATH,
  BUILD_ISSUE_PATH,
  BUILD_UPLOAD_PATH,
  BUILD_PROGRESS_PATH,
  BUILD_SCREENSHOT_PATH,
  BUILD_WEBHOOK_PATH,
  MCP_RESOURCE_METADATA_PATH,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_GITHUB_CALLBACK_PATH,
  OAUTH_HTTP_PATHS,
} from "@shared/ai-paths";
import { GOD_CHAT_USAGE_PATH } from "@shared/god-chat";
import { getCorsHeaders, isAllowedOrigin, isForeignOrigin, jsonResponse } from "@shared/http-origins";
import { MCP_PATH } from "@shared/mcp";
import { MCP_HISTORY_SCOPE } from "@shared/mcp-auth";

import { deleteExpiredDesignSessions } from "./chat/design-cleanup";
import { anthropicFetch } from "./chat/egress";
import { clientIp, handleChat, quotaStub } from "./chat/handler";
import { webSearchServices } from "./chat/web-search";
import { handleBuild, handleBuildIssue, handleBuildStatus, handleBuildUpload, handleBuildProgress, handleBuildScreenshot, handleGithubWebhook } from "./build/handlers";
import { handleMcp } from "./mcp";
import { handleAuthorize, handleGithubCallback } from "./oauth/authorize";
import { authorizationServer, mcpResourceServer } from "./oauth/server";
import type { Env } from "./runtime";
import type { ReadHistory } from "./tools/private-history";
import { fetchProjectDoc } from "./tools/project-docs";
import { sandboxRunner } from "./tools/code-sandbox";
import type { ToolIO } from "./tools/registry";

const BUILD_HANDLERS = new Map<string, (request: Request, env: Env, fetcher?: typeof fetch, ctx?: Pick<ExecutionContext, "waitUntil">) => Promise<Response>>([
  [BUILD_PATH, handleBuild],
  [BUILD_STATUS_PATH, handleBuildStatus],
  [BUILD_ISSUE_PATH, handleBuildIssue],
  [BUILD_UPLOAD_PATH, handleBuildUpload],
  [BUILD_PROGRESS_PATH, handleBuildProgress],
  [BUILD_SCREENSHOT_PATH, handleBuildScreenshot],
  [BUILD_WEBHOOK_PATH, handleGithubWebhook],
]);
const SERVER_BUILD_PATHS = new Set([BUILD_UPLOAD_PATH, BUILD_PROGRESS_PATH, BUILD_SCREENSHOT_PATH, BUILD_WEBHOOK_PATH]);

// 照 Cloudflare MCP 门户的约定：连接地址带 ?codemode（值不是 off）才开 Code Mode，工具表随连接地址变。
const codeModeRequested = (request: Request) => {
  const value = new URL(request.url).searchParams.get("codemode");
  return value !== null && value !== "off";
};

function publicTools(request: Request, env: Env): ToolIO {
  const tools: ToolIO = { readStatus: (path) => env.PUBLIC_STATUS.readStatus(path), readDoc: fetchProjectDoc };
  return env.LOADER && codeModeRequested(request) ? { ...tools, runCode: sandboxRunner(env.LOADER) } : tools;
}

const mcpVersion = (env: Env) => env.CF_VERSION_METADATA?.id ?? "dev";

// 带 Authorization 的 /mcp 先由资源服务器验令牌（受众须是 MCP_RESOURCE），过了才多给 readHistory。
const signedInMcp = mcpResourceServer({
  fetch(request, env, ctx) {
    if (!ctx.auth.scope.includes(MCP_HISTORY_SCOPE)) {
      return handleMcp(request, publicTools(request, env), mcpVersion(env), () => insufficientScope(ctx.auth, [MCP_HISTORY_SCOPE]));
    }
    const archive = env.PRIVATE_HISTORY;
    const readHistory: ReadHistory = archive
      ? (query) => archive.readHistory(query)
      : async () => ({ ok: false, error: "The history archive is not bound here." });
    return handleMcp(request, { ...publicTools(request, env), readHistory }, mcpVersion(env));
  },
});

// 测试不传 ctx；资源服务器要往 ctx 上挂 props 与 auth。
const noContext = () => ({ waitUntil() {}, passThroughOnException() {}, props: {} }) as unknown as ExecutionContext;

const signInOffline = () => jsonResponse({ error: "Sign-in is not configured here." }, { status: 503, headers: { "Cache-Control": "no-store" } });

async function handleOAuth(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.OAUTH_KV) return signInOffline();
  const { pathname } = new URL(request.url);
  if (pathname === OAUTH_AUTHORIZE_PATH) return handleAuthorize(request, env);
  if (pathname === OAUTH_GITHUB_CALLBACK_PATH) return handleGithubCallback(request, env);
  if (pathname === MCP_RESOURCE_METADATA_PATH) return signedInMcp.fetch(request, env, ctx);
  return authorizationServer.fetch(request, env, ctx);
}

function withCors(response: Response, cors: Headers): Response {
  const headers = new Headers(response.headers);
  cors.forEach((value, name) => headers.set(name, value));
  return new Response(response.body, { status: response.status, headers });
}

function tooMany(error: string, cors: Headers, retryAfter: string): Response {
  return jsonResponse({ error }, { status: 429, headers: { ...Object.fromEntries(cors), "Retry-After": retryAfter } });
}

const worker = {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!AI_HTTP_PATHS.has(pathname)) return new Response("Not found", { status: 404 });
    // OAuth 端点的 CORS 与预检由 workers-oauth-provider 自己回；同 IP 限流和 /mcp 共用一个额度。
    if (OAUTH_HTTP_PATHS.has(pathname)) {
      if (env.MCP_LIMIT && !(await env.MCP_LIMIT.limit({ key: clientIp(request) })).success) {
        return tooMany("Too many requests.", new Headers(), "60");
      }
      return handleOAuth(request, env, ctx ?? noContext());
    }

    const cors = getCorsHeaders(request, env);
    if (pathname === MCP_PATH) {
      cors.set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name");
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const buildHandler = BUILD_HANDLERS.get(pathname);
    if (buildHandler) {
      if (!SERVER_BUILD_PATHS.has(pathname) && !isAllowedOrigin(request, env)) {
        return jsonResponse({ error: "Forbidden" }, { status: 403, headers: cors });
      }
      if (pathname !== BUILD_WEBHOOK_PATH && env.BUILD_REQUEST_LIMIT && !(await env.BUILD_REQUEST_LIMIT.limit({ key: clientIp(request) })).success) {
        return tooMany("Too many build requests.", cors, "60");
      }
      return withCors(await buildHandler(request, env, undefined, ctx), cors);
    }

    if (pathname === GOD_CHAT_USAGE_PATH) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });
      if (!isAllowedOrigin(request, env)) return jsonResponse({ error: "Forbidden" }, { status: 403, headers: cors });
      const quota = quotaStub(env);
      if (!quota) return jsonResponse({ error: "The oracle is offline." }, { status: 503, headers: cors });
      // 不验人，每次都进全站共用的 ChatQuota 跑一个事务；按 IP 限流，刷这个端点拖不慢别人的对话。
      const ip = clientIp(request);
      if (env.CHAT_USAGE_LIMIT && !(await env.CHAT_USAGE_LIMIT.limit({ key: ip })).success) {
        return tooMany("Too many usage checks.", cors, "10");
      }
      return jsonResponse({ ...await quota.usage(ip), webSearch: webSearchServices(env) }, { headers: cors });
    }

    let response: Response;
    if (pathname === MCP_PATH) {
      if (isForeignOrigin(request, env)) return jsonResponse({ error: "Forbidden" }, { status: 403, headers: cors });
      if (env.MCP_LIMIT && !(await env.MCP_LIMIT.limit({ key: clientIp(request) })).success) {
        return tooMany("Too many requests.", cors, "60");
      }
      if (request.headers.has("Authorization") && !env.OAUTH_KV) return withCors(signInOffline(), cors);
      response = request.headers.has("Authorization")
        ? await signedInMcp.fetch(request, env, ctx ?? noContext())
        : await handleMcp(request, publicTools(request, env), mcpVersion(env));
    } else {
      if (!isAllowedOrigin(request, env)) return jsonResponse({ error: "Forbidden" }, { status: 403, headers: cors });
      response = await handleChat(request, env, { readStatus: (path) => env.PUBLIC_STATUS.readStatus(path), readDoc: fetchProjectDoc }, ctx);
    }
    return withCors(response, cors);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    if (!env.ANTHROPIC_API_KEY) return;
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, fetch: anthropicFetch(env) });
    const deleted = await deleteExpiredDesignSessions(client.beta.sessions, env);
    if (deleted) console.info("[design] deleted expired sessions", JSON.stringify({ deleted }));
  },
} satisfies ExportedHandler<Env>;

export default worker;
