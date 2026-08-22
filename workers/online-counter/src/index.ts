import { DurableObject } from "cloudflare:workers";

export interface Env {
  ONLINE_COUNTER: DurableObjectNamespace<OnlineCounterRoom>;
  ALLOWED_ORIGINS?: string;
}

const WS_PATH = "/ws";
const COUNT_PATH = "/count";
const ROOM_ID = "global";
const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/*
 * 下面这四个函数和 live-push / musickit-token / am-motion-artwork 那三个 worker
 * 逐字一样（workers/live-push/src/index.ts），改一处记得同步另外三处。
 * —— am-motion-artwork 那份唯一的差别是引号：那个文件通篇用单引号。
 *
 * 没抽成共享包是故意的：域名名单本来就得在每份 wrangler.toml 里各配一次，
 * 抽包省不掉那份重复，却要多一个包和一层依赖解析。
 */

function getAllowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * 允许 `https://*.vercel.app` 这样的后缀通配。
 *
 * Vercel 的预览域名每次部署都换一个（`lyjwpage-<hash>-....vercel.app`），
 * 只做全等匹配的话，预览环境永远连不上。
 *
 * 按 hostname 的后缀比，不是按字符串包含 —— 后者会把
 * `https://vercel.app.evil.com` 也放进来。
 */
function originMatches(origin: string, pattern: string): boolean {
  if (origin === pattern) return true;
  if (!pattern.includes("*")) return false;

  const wildcard = pattern.match(/^(https?:)\/\/\*\.(.+)$/);
  if (!wildcard) return false;
  const [, protocol, suffix] = wildcard;

  try {
    const url = new URL(origin);
    return url.protocol === protocol && url.hostname.endsWith(`.${suffix}`);
  } catch {
    return false;
  }
}

function isAllowedOriginValue(origin: string, allowed: string[]): boolean {
  if (LOCAL_ORIGIN_RE.test(origin)) return true;
  return allowed.some((pattern) => originMatches(origin, pattern));
}

/**
 * 没配 ALLOWED_ORIGINS 就不限制 —— `wrangler dev` 不配也要能跑，而 localhost
 * 本来就始终放行。**配了之后，不带 Origin 头一律拒绝**：浏览器发 WebSocket
 * 握手时一定带这个头，所以卡死它对真实访客零代价，却堵上了「curl 不带头就
 * 绕过白名单」这个口子。
 */
function isAllowedOrigin(request: Request, env: Env): boolean {
  const allowed = getAllowedOrigins(env);
  if (allowed.length === 0) return true;
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  return isAllowedOriginValue(origin, allowed);
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
  // getByName 就是 idFromName + get 这两步，和 live-push 那份写法保持一致
  return env.ONLINE_COUNTER.getByName(ROOM_ID);
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
    // 按 0 / 1 取，不绕 Object.values：WebSocketPair 的类型把这两个下标写成了
    // 具名属性，摊成数组之后 noUncheckedIndexedAccess 会把它们变成可选的
    const client = pair[0];
    const server = pair[1];

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
    const payload = JSON.stringify({ online: this.sessions.size });
    for (const socket of this.sessions) {
      try {
        socket.send(payload);
      } catch {
        /*
         * 已经断了但还没收到 close 的，丢掉这一条即可 —— close / error 事件随后
         * 会把它从 sessions 里清掉，那时才补一次广播。
         *
         * 别在这里调 closeSession：它会广播，而我们还在遍历 sessions 里 ——
         * 内层遍历把剩下的连接又发一遍，发的还是删除**之前**算出来的人数。
         * N 个死连接一起被发现时，嵌套深度和重复发送量都是 O(N)，总量 O(N²)，
         * 客户端会连着收到几条互相矛盾的计数。
         * 隔壁 live-push 的 broadcast 同一处就是这么写的。
         */
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

