import {
  AI_HTTP_PATHS,
  BUILD_PATH,
  BUILD_STATUS_PATH,
  BUILD_UPLOAD_PATH,
  BUILD_PROGRESS_PATH,
  BUILD_WEBHOOK_PATH,
} from "@shared/ai-paths";
import { GOD_CHAT_PATH, GOD_CHAT_USAGE_PATH } from "@shared/god-chat";
import { getAllowedOrigins, getCorsHeaders, isAllowedOrigin, isAllowedOriginValue } from "@shared/http-origins";
import { MCP_PATH } from "@shared/mcp";

import { clientIp, handleChat, quotaStub } from "./chat/handler";
import { handleBuild, handleBuildStatus, handleBuildUpload, handleBuildProgress, handleGithubWebhook } from "./build/handlers";
import { handleGithubIssue } from "./github-issue";
import { handleMcp } from "./mcp";
import type { Env } from "./runtime";
import { fetchProjectDoc } from "./tools/project-docs";
import type { ToolIO } from "./tools/registry";

const BUILD_HANDLERS = new Map<string, (request: Request, env: Env, fetcher?: typeof fetch, ctx?: Pick<ExecutionContext, "waitUntil">) => Promise<Response>>([
  [BUILD_PATH, handleBuild],
  [BUILD_STATUS_PATH, handleBuildStatus],
  [BUILD_UPLOAD_PATH, handleBuildUpload],
  [BUILD_PROGRESS_PATH, handleBuildProgress],
  [BUILD_WEBHOOK_PATH, handleGithubWebhook],
]);
const SERVER_BUILD_PATHS = new Set([BUILD_UPLOAD_PATH, BUILD_PROGRESS_PATH, BUILD_WEBHOOK_PATH]);

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

const worker = {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!AI_HTTP_PATHS.has(pathname)) return new Response("Not found", { status: 404 });

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
        return jsonResponse({ error: "Too many build requests." }, { status: 429, headers: { ...Object.fromEntries(cors), "Retry-After": "60" } });
      }
      const response = await buildHandler(request, env, undefined, ctx);
      const headers = new Headers(response.headers);
      cors.forEach((value, name) => headers.set(name, value));
      return new Response(response.body, { status: response.status, headers });
    }

    if (pathname === GOD_CHAT_USAGE_PATH) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });
      if (!isAllowedOrigin(request, env)) return jsonResponse({ error: "Forbidden" }, { status: 403, headers: cors });
      const quota = quotaStub(env);
      if (!quota) return jsonResponse({ error: "The oracle is offline." }, { status: 503, headers: cors });
      // 不验人，每次都进全站共用的 ChatQuota 跑一个事务；按 IP 限流，刷这个端点拖不慢别人的对话。
      const ip = clientIp(request);
      if (env.CHAT_USAGE_LIMIT && !(await env.CHAT_USAGE_LIMIT.limit({ key: ip })).success) {
        return jsonResponse({ error: "Too many usage checks." }, { status: 429, headers: { ...Object.fromEntries(cors), "Retry-After": "10" } });
      }
      return jsonResponse(await quota.usage(ip), { headers: cors });
    }

    const tools: ToolIO = {
      readStatus: (path) => env.PUBLIC_STATUS.readStatus(path),
      readDoc: fetchProjectDoc,
    };
    let response: Response;
    if (pathname === MCP_PATH) {
      const origin = request.headers.get("Origin");
      if (origin && !isAllowedOriginValue(origin, getAllowedOrigins(env))) return jsonResponse({ error: "Forbidden" }, { status: 403, headers: cors });
      if (env.MCP_LIMIT && !(await env.MCP_LIMIT.limit({ key: clientIp(request) })).success) {
        return jsonResponse({ error: "Too many requests." }, { status: 429, headers: { ...Object.fromEntries(cors), "Retry-After": "60" } });
      }
      response = await handleMcp(request, tools, env.CF_VERSION_METADATA?.id ?? "dev");
    } else {
      if (!isAllowedOrigin(request, env)) return jsonResponse({ error: "Forbidden" }, { status: 403, headers: cors });
      response = pathname === GOD_CHAT_PATH
        ? await handleChat(request, env, tools)
        : await handleGithubIssue(request, env, clientIp(request));
    }
    const headers = new Headers(response.headers);
    cors.forEach((value, name) => headers.set(name, value));
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;

export default worker;
