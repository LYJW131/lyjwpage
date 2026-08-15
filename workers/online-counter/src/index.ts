import { DurableObject } from "cloudflare:workers";

export interface Env {
  ONLINE_COUNTER: DurableObjectNamespace<OnlineCounterRoom>;
  ALLOWED_ORIGINS?: string;
}

const WS_PATH = "/ws";
const COUNT_PATH = "/count";
const ROOM_ID = "global";
const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

function getAllowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOriginValue(origin: string, allowed: string[]): boolean {
  return allowed.includes(origin) || LOCAL_ORIGIN_RE.test(origin);
}

function isAllowedOrigin(request: Request, env: Env): boolean {
  const allowed = getAllowedOrigins(env);
  if (allowed.length === 0) return true;
  const origin = request.headers.get("Origin");
  return origin ? isAllowedOriginValue(origin, allowed) : true;
}

function getCorsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  const allowed = getAllowedOrigins(env);
  if (origin && (allowed.length === 0 || isAllowedOriginValue(origin, allowed))) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  } else if (allowed.length === 0) {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function getRoom(env: Env): DurableObjectStub<OnlineCounterRoom> {
  const id = env.ONLINE_COUNTER.idFromName(ROOM_ID);
  return env.ONLINE_COUNTER.get(id);
}

export class OnlineCounterRoom extends DurableObject<Env> {
  private sessions = new Set<WebSocket>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === COUNT_PATH) {
      return jsonResponse({ online: this.sessions.size });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private handleSession(socket: WebSocket): void {
    socket.accept();
    this.sessions.add(socket);
    this.broadcastCount();

    socket.addEventListener("message", (event) => {
      if (event.data === "ping") {
        socket.send("pong");
      }
    });

    socket.addEventListener("close", () => this.closeSession(socket));
    socket.addEventListener("error", () => this.closeSession(socket));
  }

  private closeSession(socket: WebSocket): void {
    if (!this.sessions.delete(socket)) return;
    this.broadcastCount();
  }

  private broadcastCount(): void {
    const message = { online: this.sessions.size };
    const payload = JSON.stringify(message);
    for (const socket of this.sessions) {
      try {
        socket.send(payload);
      } catch {
        this.closeSession(socket);
      }
    }
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
    }

    if (url.pathname === WS_PATH) {
      if (!isAllowedOrigin(request, env)) {
        return new Response("Forbidden", { status: 403 });
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      return getRoom(env).fetch(request);
    }

    if (url.pathname === COUNT_PATH) {
      const response = await getRoom(env).fetch(request);
      const headers = new Headers(response.headers);
      getCorsHeaders(request, env).forEach((value, key) => headers.set(key, value));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    if (url.pathname === "/") {
      return new Response("Online Counter Worker is running.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

export default worker;

