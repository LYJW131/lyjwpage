import { DurableObject } from "cloudflare:workers";

import { StateHub } from "./state-hub";
import { STORAGE_MAX_BYTES } from "@shared/storage-contract";
import type { StoredEntry } from "@shared/sqlite-store";

import type { LiveEvent } from "@/lib/live-events";

import {
  HEARTBEAT_INTERVAL_MS,
  parseVisibility,
  readMark,
  takeCensus,
  type Census,
  type SocketMark,
  type SocketSample,
} from "./live-census";
import { liveRoom } from "./live-platform";
import { ConfigError, issueMusicKitToken } from "./musickit-token";
import { getAllowedOrigins, getCorsHeaders, isAllowedOrigin, isAllowedOriginValue } from "@shared/http-origins";
import { fetchPreviewUpstream, isPreviewProxyPath, previewWorkerEnabled } from "./preview";
import { isPublicApiPath, pathForEventType } from "./public-api";
import { executePublicRequest } from "./public-execution";
import { isLookupPath, serveLookup } from "./lookup-routes";
import { AI_HTTP_PATHS } from "@shared/ai-paths";
import type { Env } from "./runtime";
import { site } from "@/lib/site";


export type { Env };
export { StateHub };

const WS_PATH = "/ws";

const MUSICKIT_TOKEN_PATH = "/api/musickit/token";

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function secretMatches(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function rejectSocket(request: Request, env: Env): Response | null {
  if (!isAllowedOrigin(request, env)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }
  return null;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readBoundedBody(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > STORAGE_MAX_BYTES) { await reader.cancel(); throw new Error("Body too large"); }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function handleImport(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ ok: false }, { status: 405 });
  const expected = env.STATE_IMPORT_SECRET;
  if (!expected || !env.STATE) return jsonResponse({ ok: false }, { status: 503 });
  const provided = bearerToken(request);
  if (!provided || !secretMatches(provided, expected)) return jsonResponse({ ok: false }, { status: 401 });
  try {
    const body = JSON.parse(await readBoundedBody(request.body));
    const hub = env.STATE.get(env.STATE.idFromName("global"));
    const prefix = env.STORAGE_PREFIX ?? "lyjwpage";
    {
      if (!Array.isArray(body.entries) || body.entries.length > 1000 || !body.entries.every((entry: StoredEntry) =>
        entry && typeof entry.key === "string" && entry.key.startsWith(`${prefix}:`) &&
        (entry.expiresAt === null || Number.isSafeInteger(entry.expiresAt)))) throw new Error("Invalid import");
      const imported = await hub.importMissing(body.entries);
      if (body.finalize === true) await hub.finishImport();
      return jsonResponse({ imported });
    }
  } catch (error) {
    console.error("[storage]", reason(error));
    return jsonResponse({ ok: false, error: "存储请求失败" }, { status: 400 });
  }
}

async function handleMusicKitToken(request: Request, env: Env, cors: Headers): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse({ error: "只接受 GET" }, { status: 405, headers: cors });
  }
  if (!isAllowedOrigin(request, env)) {
    return jsonResponse({ error: "来源不在允许的域名内" }, { status: 403, headers: cors });
  }

  try {
    const { token, issuedAt, expiresAt } = await issueMusicKitToken(request.headers.get("Origin"), env);
    // 缓存令牌可能已消耗半段寿命，客户端必须用签发时刻而非收到时刻计算续期。
    return jsonResponse({ token, issuedAt, expiresAt }, { headers: cors });
  } catch (error) {
    console.error("[musickit-token] 签发失败：", error);
    const hint = error instanceof ConfigError ? error.hint : "签发失败，详情见 Worker 日志";
    return jsonResponse({ error: hint }, { status: 500, headers: cors });
  }
}

const SWEEP_INTERVAL_MS = HEARTBEAT_INTERVAL_MS;

// DO 休眠会销毁实例字段；连接与可见性须从运行时恢复，自动回复须在构造函数登记。
export class LivePushRoom extends DurableObject<Env> {
  private upstream: WebSocket | null = null;
  private upstreamPing: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const now = Date.now();
    const visible = new URL(request.url).searchParams.get("visible") === "1";
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ at: now, visible, seenAt: now } satisfies SocketMark);
    this.ctx.waitUntil(this.ensureUpstreamRelay());
    this.ctx.waitUntil(this.announce(this.census(), server));

    return new Response(null, { status: 101, webSocket: client });
  }

  private async ensureUpstreamRelay(): Promise<void> {
    const base = process.env.UPSTREAM_API_URL?.trim().replace(/\/+$/, "");
    if (!base || this.upstream) return;
    try {
      const response = await fetch(`${base}/ws`, {
        headers: { Upgrade: "websocket", Origin: site.url },
      });
      const socket = response.webSocket;
      if (!socket) {
        console.warn("[upstream ws] 握手失败", response.status);
        return;
      }
      socket.accept();
      this.upstream = socket;
      this.upstreamPing = setInterval(() => {
        try {
          socket.send("ping");
        } catch { }
      }, 30_000);
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string" || event.data === "pong") return;
        void this.relayUpstreamMessage(event.data);
      });
      const drop = () => {
        if (this.upstream !== socket) return;
        this.dropUpstreamRelay();
        if (this.ctx.getWebSockets().length > 0) {
          setTimeout(() => void this.ensureUpstreamRelay(), 5_000);
        }
      };
      socket.addEventListener("close", drop);
      socket.addEventListener("error", drop);
      console.log("[upstream ws] 已连上", base);
    } catch (error) {
      console.warn("[upstream ws]", reason(error));
    }
  }

  // 推送 payload 会覆盖 SWR 缓存；本地注入必须同时覆盖推送，避免被生产数据冲掉。
  private async relayUpstreamMessage(raw: string): Promise<void> {
    let message: { type?: unknown; payload?: unknown } | null = null;
    try {
      message = JSON.parse(raw) as { type?: unknown; payload?: unknown };
    } catch {
    }
    if (message?.type === "online") return;
    const path = typeof message?.type === "string" ? pathForEventType(message.type) : null;
    if (path && this.env.DEV_OVERRIDE_READER) {
      try {
        const response = await this.env.DEV_OVERRIDE_READER.devOverride(path);
        if (response.ok) {
          const override = (await response.json()) as { ok?: unknown; data?: unknown };
          if (override.ok === true) {
            this.broadcast(JSON.stringify({ ...message, payload: override.data }));
            return;
          }
        }
      } catch (error) {
        console.warn("[upstream ws] 查注入失败，原样转发", reason(error));
      }
    }
    this.broadcast(raw);
  }

  private dropUpstreamRelay(): void {
    if (this.upstreamPing) clearInterval(this.upstreamPing);
    this.upstreamPing = null;
    const socket = this.upstream;
    this.upstream = null;
    try {
      socket?.close(1000, "本地没有页面了");
    } catch { }
  }

  broadcast(message: string): number {
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
        delivered += 1;
      } catch {
      }
    }
    return delivered;
  }

  // close/error 回调期间连接仍在 getWebSockets() 中，计数必须显式排除 leaving。
  private census(leaving?: WebSocket, now = Date.now()): Census<WebSocket> {
    const samples: SocketSample<WebSocket>[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === leaving) continue;
      samples.push({
        socket,
        pinged: this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? null,
        mark: readMark(socket.deserializeAttachment()),
      });
    }
    const result = takeCensus(samples, now);
    for (const socket of result.expired) {
      try {
        socket.close(1001, "静默过久");
      } catch { }
    }
    return result;
  }

  audience(): { connections: number; online: number } {
    const { connections, online } = this.census();
    return { connections, online };
  }

  private lastOnline: number | null = null;

  private publishOnline(census: Census<WebSocket>, newcomer?: WebSocket): void {
    const message = JSON.stringify({ type: "online", payload: { online: census.online } } satisfies LiveEvent);
    if (census.online !== this.lastOnline) {
      this.lastOnline = census.online;
      this.broadcast(message);
    } else if (newcomer) {
      try {
        newcomer.send(message);
      } catch { }
    }
  }

  // 已有闹钟不能反复后推，否则持续切换标签会无限推迟清扫。
  private async announce(census: Census<WebSocket>, newcomer?: WebSocket): Promise<void> {
    this.publishOnline(census, newcomer);
    if (census.online > 0 && (await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }

  async alarm(): Promise<void> {
    const census = this.census();
    this.publishOnline(census);
    if (census.online > 0) await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const visible = parseVisibility(message);
    if (visible === null) return;
    const now = Date.now();
    const mark = readMark(ws.deserializeAttachment(), now);
    ws.serializeAttachment({ at: mark?.at ?? now, visible, seenAt: now } satisfies SocketMark);
    await this.announce(this.census(undefined, now));
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // 1005/1006 是接收端保留码，不能传给 close，否则会抛错。
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch { }
    if (this.upstream && this.ctx.getWebSockets().every((socket) => socket === ws)) {
      this.dropUpstreamRelay();
    }
    await this.announce(this.census(ws));
  }

  // error 后运行时未必再触发 close，必须在这里同步人数。
  async webSocketError(ws: WebSocket): Promise<void> {
    await this.announce(this.census(ws));
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/internal/storage/import") {
      if (previewWorkerEnabled()) return new Response("Not found", { status: 404 });
      return handleImport(request, env);
    }

    const cors = getCorsHeaders(request, env);
    if (AI_HTTP_PATHS.has(url.pathname)) {
      if (!env.AI_SERVICE) return jsonResponse({ error: "The oracle is offline." }, { status: 503, headers: cors });
      return env.AI_SERVICE.fetch(request);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (previewWorkerEnabled() && isPreviewProxyPath(url.pathname)) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });
      if (!isAllowedOrigin(request, env)) {
        return jsonResponse({ error: "来源不在允许的域名内" }, { status: 403, headers: cors });
      }
      const upstream = await fetchPreviewUpstream(request);
      const headers = new Headers(upstream.headers);
      cors.forEach((value, name) => headers.set(name, value));
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    if (url.pathname === MUSICKIT_TOKEN_PATH) {
      return handleMusicKitToken(request, env, cors);
    }

    if (url.pathname.startsWith("/api/")) {
      const devOverride = process.env.DEV_OVERRIDES?.trim() === "true" && url.pathname.startsWith("/api/dev/");
      if (request.method !== "GET" && !devOverride) return new Response("Method not allowed", { status: 405, headers: cors });
      const origin = request.headers.get("Origin");
      if (origin && !isAllowedOriginValue(origin, getAllowedOrigins(env))) return jsonResponse({ ok: false }, { status: 403, headers: cors });
      const lookup = isLookupPath(url.pathname);
      if (!lookup && !isPublicApiPath(url.pathname)) return new Response("Not found", { status: 404, headers: cors });
      const response = lookup ? await serveLookup(request, env, ctx) : await executePublicRequest(request, env, ctx);
      const headers = new Headers(response.headers);
      cors.forEach((value, name) => headers.set(name, value));
      headers.set("Access-Control-Expose-Headers", "X-Fetched-At, X-Edge-Cache");
      return new Response(response.body, { status: response.status, headers });
    }

    if (url.pathname === WS_PATH) {
      const rejected = rejectSocket(request, env);
      if (rejected) return rejected;
      return liveRoom(env).fetch(request);
    }

    if (url.pathname === "/count") {
      return jsonResponse({ ok: true, ...(await liveRoom(env).audience()) }, { headers: cors });
    }

    if (url.pathname === "/") {
      return jsonResponse({ ok: true, service: "api" });
    }

    return new Response("Not found", { status: 404 });
  },
};

export default worker;
