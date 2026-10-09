import { site } from "@/lib/site";

import { readJsonBody } from "./chat/guard";
import { EVENT_DEFINITIONS } from "./mcp-event-catalog";
import type { EventRpcReply } from "./mcp-event-errors";
import { SITE_TOOLS, newLedger, type ToolIO } from "./tools/registry";

// 新协议每个请求在 _meta 里自带版本、没有 initialize；旧协议先握手。两代都收，都不发会话 ID。
const MODERN_VERSIONS = ["2026-07-28"];
const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SUPPORTED_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
// 规范：没有 MCP-Protocol-Version 头的旧客户端按 2025-03-26 处理。
const HEADERLESS_VERSION = "2025-03-26";

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

const MAX_BODY_BYTES = 16 * 1024;
// 新协议要求 server/discover、tools/list 带缓存提示，缺了客户端整张工具表都不认；工具表只随部署变。
const CACHE_HINTS = { ttlMs: 60 * 60_000, cacheScope: "public" } as const;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;

const INSTRUCTIONS = [
  `Live, public data from LYJW's personal homepage (${site.url}): what LYJW is listening to, watching, playing and coding with right now and recently, their devices and server, and the site's own health.`,
  "Use get_site_status to look things up instead of guessing; timestamps are epoch milliseconds and every result carries the current time.",
  `Image paths that start with /img/ are relative to ${site.url}.`,
  `Use read_project_doc for how the site works; its source is open at ${site.repo}.`,
  "Requests are rate-limited per IP, so read only the views you need.",
  'Refer to LYJW by name or as "they"; in Chinese write "LYJW" or "TA".',
].join(" ");

const TOOLS = SITE_TOOLS.map(({ name, title, description, inputSchema }) => ({
  name,
  title,
  description,
  inputSchema,
  annotations: { title, readOnlyHint: true, openWorldHint: false },
}));

export type McpEventAccess = {
  principal: string;
  subscribe(principal: string, params: Record<string, unknown>): Promise<EventRpcReply>;
  unsubscribe(principal: string, params: Record<string, unknown>): Promise<EventRpcReply>;
};

type Id = string | number;
type Params = Record<string, unknown>;
type Era = "modern" | "legacy";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

class RpcError extends Error {
  readonly code: number;
  readonly status: number;
  readonly data?: unknown;

  constructor(code: number, message: string, status: number, data?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

function rpcResponse(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(id: Id | null, error: RpcError): Response {
  const body = { code: error.code, message: error.message, ...(error.data !== undefined && { data: error.data }) };
  return rpcResponse(error.status, { jsonrpc: "2.0", ...(id !== null && { id }), error: body });
}

// 规范允许把头里放不下的值写成 =?base64?…?=，比对前先解开。
function headerValue(raw: string | null): string | null {
  const encoded = raw && /^=\?base64\?(.*)\?=$/.exec(raw)?.[1];
  if (!encoded) return raw;
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

function unsupported(requested: string): RpcError {
  return new RpcError(UNSUPPORTED_VERSION, "Unsupported protocol version", 400, { supported: SUPPORTED_VERSIONS, requested });
}

function eraOf(request: Request, method: string, params: Params): Era {
  const meta = isObject(params._meta) ? params._meta : {};
  const header = request.headers.get("MCP-Protocol-Version");
  const declared = typeof meta[META_VERSION] === "string" ? meta[META_VERSION] : header ?? HEADERLESS_VERSION;
  if (method === "initialize" || LEGACY_VERSIONS.includes(declared)) return "legacy";
  if (!MODERN_VERSIONS.includes(declared)) throw unsupported(declared);
  if (header !== declared) throw new RpcError(HEADER_MISMATCH, `MCP-Protocol-Version header must be ${declared}`, 400);
  if (meta[META_VERSION] !== declared || !isObject(meta[META_CAPABILITIES])) {
    throw new RpcError(INVALID_PARAMS, `Missing _meta ${META_VERSION} or ${META_CAPABILITIES}`, 400);
  }
  if (request.headers.get("Mcp-Method") !== method) {
    throw new RpcError(HEADER_MISMATCH, `Mcp-Method header must be ${method}`, 400);
  }
  if (method === "tools/call" && headerValue(request.headers.get("Mcp-Name")) !== params.name) {
    throw new RpcError(HEADER_MISMATCH, "Mcp-Name header must match params.name", 400);
  }
  return "modern";
}

async function callTool(params: Params, io: ToolIO) {
  const tool = SITE_TOOLS.find((candidate) => candidate.name === params.name);
  if (!tool) throw new RpcError(INVALID_PARAMS, `Unknown tool: ${String(params.name)}`, 200);
  if (params.arguments !== undefined && !isObject(params.arguments)) {
    throw new RpcError(INVALID_PARAMS, "arguments must be an object", 200);
  }
  const { text, isError } = await tool.run(params.arguments ?? {}, io, newLedger());
  return { content: [{ type: "text", text }], isError };
}

async function dispatch(era: Era, method: string, params: Params, io: ToolIO, serverInfo: object, events?: McpEventAccess | null) {
  switch (method) {
    case "initialize": {
      const requested = params.protocolVersion;
      return {
        protocolVersion: typeof requested === "string" && LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo,
        instructions: INSTRUCTIONS,
      };
    }
    case "server/discover":
      if (era !== "modern") break;
      return {
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: {}, ...(events && { events: {} }) },
        instructions: INSTRUCTIONS,
        ttlMs: 0,
        cacheScope: "private",
      };
    case "events/list":
    case "events/subscribe":
    case "events/unsubscribe": {
      if (era !== "modern") break;
      if (!events) throw new RpcError(-32012, "Authenticated event access required", 401);
      if (method === "events/list") {
        if (Object.keys(params).some((key) => key !== "cursor" && key !== "_meta") || (params.cursor !== undefined && params.cursor !== null)) {
          throw new RpcError(INVALID_PARAMS, "Invalid event catalog parameters", 200);
        }
        return { events: EVENT_DEFINITIONS, ttlMs: 0, cacheScope: "private" };
      }
      const reply = await events[method === "events/subscribe" ? "subscribe" : "unsubscribe"](events.principal, params);
      if ("error" in reply) throw new RpcError(reply.error.code, reply.error.message, 200, reply.error.data);
      return reply.result;
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS, ...(era === "modern" && CACHE_HINTS) };
    case "tools/call":
      return callTool(params, io);
  }
  throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`, era === "modern" ? 404 : 200);
}

export async function handleMcp(request: Request, io: ToolIO, version: string, events?: McpEventAccess | null): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("MCP endpoint (Streamable HTTP). Send JSON-RPC with POST. Public tools; authenticated events.\n", {
      status: 405,
      headers: { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const message = await readJsonBody(request, MAX_BODY_BYTES);
  if (Array.isArray(message)) {
    return errorResponse(null, new RpcError(INVALID_REQUEST, "JSON-RPC batches are not supported", 400));
  }
  if (!isObject(message)) return errorResponse(null, new RpcError(PARSE_ERROR, "Parse error", 400));

  const { id, method, params = {} } = message;
  const hasId = "id" in message;
  const validId = typeof id === "string" || (typeof id === "number" && Number.isInteger(id));
  if (message.jsonrpc !== "2.0" || typeof method !== "string" || (hasId && !validId) || !isObject(params)) {
    return errorResponse(validId ? (id as Id) : null, new RpcError(INVALID_REQUEST, "Invalid request", 400));
  }
  if (!hasId) return new Response(null, { status: 202 });

  const serverInfo = { name: "lyjwpage", title: site.name, version, websiteUrl: site.url };
  try {
    const era = eraOf(request, method, params);
    const result = await dispatch(era, method, params, io, serverInfo, events);
    return rpcResponse(200, {
      jsonrpc: "2.0",
      id,
      result: era === "modern" ? { resultType: "complete", ...result, _meta: { [META_SERVER_INFO]: serverInfo } } : result,
    });
  } catch (error) {
    if (error instanceof RpcError) return errorResponse(id as Id, error);
    throw error;
  }
}
