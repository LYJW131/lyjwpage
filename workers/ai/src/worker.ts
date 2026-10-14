import Anthropic from "@anthropic-ai/sdk";

import {
  AI_HTTP_PATHS,
  BUILD_PATH,
  BUILD_STATUS_PATH,
  BUILD_ISSUE_PATH,
  BUILD_UPLOAD_PATH,
  BUILD_PROGRESS_PATH,
  BUILD_SCREENSHOT_PATH,
  BUILD_WEBHOOK_PATH,
} from "@shared/ai-paths";
import { GOD_CHAT_USAGE_PATH } from "@shared/god-chat";
import { getCorsHeaders, isAllowedOrigin, isForeignOrigin, jsonResponse } from "@shared/http-origins";
import { MCP_PATH } from "@shared/mcp";

import { deleteExpiredDesignSessions } from "./chat/design-cleanup";
import { anthropicFetch } from "./chat/egress";
import { clientIp, handleChat, quotaStub } from "./chat/handler";
import { handleBuild, handleBuildIssue, handleBuildStatus, handleBuildUpload, handleBuildProgress, handleBuildScreenshot, handleGithubWebhook } from "./build/handlers";
import { handleMcp } from "./mcp";
import { mcpCodeModeEnabled, type Env } from "./runtime";
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
      return jsonResponse(await quota.usage(ip), { headers: cors });
    }

    const tools: ToolIO = {
      readStatus: (path) => env.PUBLIC_STATUS.readStatus(path),
      readDoc: fetchProjectDoc,
    };
    let response: Response;
    if (pathname === MCP_PATH) {
      if (isForeignOrigin(request, env)) return jsonResponse({ error: "Forbidden" }, { status: 403, headers: cors });
      if (env.MCP_LIMIT && !(await env.MCP_LIMIT.limit({ key: clientIp(request) })).success) {
        return tooMany("Too many requests.", cors, "60");
      }
      response = await handleMcp(request, mcpCodeModeEnabled(env) && env.LOADER ? { ...tools, runCode: sandboxRunner(env.LOADER) } : tools, env.CF_VERSION_METADATA?.id ?? "dev");
    } else {
      if (!isAllowedOrigin(request, env)) return jsonResponse({ error: "Forbidden" }, { status: 403, headers: cors });
      response = await handleChat(request, env, tools);
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
