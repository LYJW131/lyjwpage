import { DurableObject } from "cloudflare:workers";

import { StateHub } from "./state-hub";

import type { LiveEvent } from "@shared/live-events";

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
import { getCorsHeaders, isAllowedOrigin, isForeignOrigin, jsonResponse } from "@shared/http-origins";
import { isPublicApiPath, pathForEventType } from "./public-api";
import { executePublicRequest } from "./public-execution";
import { AI_HTTP_PATHS } from "@shared/ai-paths";
import { LIVE_SOCKET_PATH } from "@shared/live-heartbeat";
import { withPublicCors } from "@shared/status-response";
import type { Env } from "./runtime";
import { site } from "@shared/site";


export type { Env };
export { StateHub };

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

    const cors = getCorsHeaders(request, env);
    if (AI_HTTP_PATHS.has(url.pathname)) {
      if (!env.AI_SERVICE) return jsonResponse({ error: "The oracle is offline." }, { status: 503, headers: cors });
      return env.AI_SERVICE.fetch(request);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname.startsWith("/api/")) {
      const devOverride = process.env.DEV_OVERRIDES?.trim() === "true" && url.pathname.startsWith("/api/dev/");
      if (request.method !== "GET" && !devOverride) return new Response("Method not allowed", { status: 405, headers: cors });
      if (isForeignOrigin(request, env)) return jsonResponse({ ok: false }, { status: 403, headers: cors });
      if (!isPublicApiPath(url.pathname)) return new Response("Not found", { status: 404, headers: cors });
      return withPublicCors(await executePublicRequest(request, env, ctx), cors);
    }

    if (url.pathname === LIVE_SOCKET_PATH) {
      const rejected = rejectSocket(request, env);
      if (rejected) return rejected;
      return liveRoom(env).fetch(request);
    }

    if (url.pathname === "/count") {
      return jsonResponse({ ok: true, ...(await liveRoom(env).audience()) }, { headers: cors });
    }

    if (url.pathname === "/") {
      return jsonResponse({ ok: true, service: "core" });
    }

    return new Response("Not found", { status: 404 });
  },
};

export default worker;
