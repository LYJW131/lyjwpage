import { withRequestState } from "@shared/request-state";
import { DurableObject } from "cloudflare:workers";

import { HANDLERS } from "./ingest-handlers";
import { StateHub } from "./state-hub";
import { STORAGE_MAX_BYTES } from "@shared/storage-contract";
import type { StoredEntry } from "@shared/sqlite-store";

import { refreshRecentlyPlayed } from "./apple-music-recent";

import { ROOM_ID } from "./live-platform";
import { ConfigError, issueMusicKitToken } from "./musickit-token";
import { getAllowedOrigins, getCorsHeaders, isAllowedOrigin, isAllowedOriginValue } from "./origins";
import { pathForEventType } from "./public-api";
import { requestStore, type Env } from "./runtime";
import { site } from "@/lib/site";

/** 接收所有上报，在 Worker 内写 Storage、广播 WebSocket，再通知 Vercel 缓存失效。 */

export type { Env };
// Durable Object 类必须从入口模块导出，wrangler 按名字找
export { StateHub };

const WS_PATH = "/ws";
const INGEST_PREFIX = "/api/ingest/";

/**
 * 「一起听」要的 MusicKit developer token。从前是单独的 musickit-token Worker，
 * 现在和公开 API 同源；站点从 NEXT_PUBLIC_BACKEND_URL 拼这条路径。
 */
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

function getRoom(env: Env): DurableObjectStub<LivePushRoom> {
  return env.LIVE_PUSH.get(env.LIVE_PUSH.idFromName(ROOM_ID));
}

/** WebSocket 握手前检查：来源白名单、必须是升级请求。 */
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

/** 统一 JSON 错误文案。 */
function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

/** 鉴权、解析与持久化在 202 应答前完成，广播和首屏通知由 waitUntil 执行。 */
async function handleIngest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  source: string,
): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "只接受 POST" }, { status: 405 });

  const expected = env.TELEMETRY_INGEST_SECRET;
  if (!expected) {
    return jsonResponse({ ok: false, error: "Worker 未配置 TELEMETRY_INGEST_SECRET" }, { status: 503 });
  }
  const provided = bearerToken(request);
  if (!provided || !secretMatches(provided, expected)) {
    return jsonResponse({ ok: false, error: "未授权" }, { status: 401 });
  }
  if (!env.STATE) {
    return jsonResponse({ ok: false, error: "Worker 未配置 STATE" }, { status: 503 });
  }

  const handler = Object.hasOwn(HANDLERS, source) ? HANDLERS[source] : undefined;
  if (!handler) return jsonResponse({ ok: false, error: `没有这个上报来源：${source}` }, { status: 404 });

  let raw: string;
  try {
    raw = await readBoundedBody(request);
  } catch (error) {
    console.error("[ingest] 读取请求体失败", source, reason(error));
    return jsonResponse({ ok: false, error: "无法读取上报数据" }, { status: 400 });
  }

  try {
    const body = parseBody(raw);
    const hub = env.STATE.get(env.STATE.idFromName("global"));
    const result = await hub.ingest(source, body);
    if (!result.ready) return jsonResponse({ ok: false, error: "状态存储初始化中" }, { status: 503 });
    return jsonResponse({ ok: true, data: JSON.parse(result.json) }, { status: 202 });
  } catch (error) {
    console.error("[ingest]", source, reason(error));
    return jsonResponse({ ok: false, error: "上报数据无效或处理失败" }, { status: 400 });
  }
}

/** 限制实际读取字节数，不依赖可能缺失或伪造的 Content-Length。 */
async function readBoundedBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
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
    const body = JSON.parse(await readBoundedBody(request));
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

/**
 * 签一份给访客的 MusicKit developer token。来源闸门和 CORS 与两条 WebSocket
 * 共用 ALLOWED_ORIGINS；签进 JWT 的 origin 声明由 Apple 校验，见 musickit-token.ts。
 */
async function handleMusicKitToken(request: Request, env: Env, cors: Headers): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse({ error: "只接受 GET" }, { status: 405, headers: cors });
  }
  if (!isAllowedOrigin(request, env)) {
    return jsonResponse({ error: "来源不在允许的域名内" }, { status: 403, headers: cors });
  }

  try {
    const { token, issuedAt, expiresAt } = await issueMusicKitToken(request.headers.get("Origin"), env);
    // 两个时刻都给出去，站点那侧才算得出半衰期 —— 只给到期时刻的话，它只能拿
    // 「我什么时候收到的」当起点，而收到的可能已经是一份用掉一半的缓存
    return jsonResponse({ token, issuedAt, expiresAt }, { headers: cors });
  } catch (error) {
    /*
     * 只有自己抛的 ConfigError 原文外带（哪个变量没配，只有部署的人能修）；
     * 其余异常一律通用文案 —— importKey / 运行时抛出来的 message 内容不由
     * 我们控制，随手转发等于把内部细节交给任何一个能打到这个端点的人。
     * 完整原文进 Worker 日志，排障看那边。
     */
    console.error("[musickit-token] 签发失败：", error);
    const hint = error instanceof ConfigError ? error.hint : "签发失败，详情见 Worker 日志";
    return jsonResponse({ error: hint }, { status: 500, headers: cors });
  }
}

const CONNECTION_STALE_MS = 5 * 60_000;
const CONNECTION_CLOSE_MS = 30 * 60_000;

/**
 * 全站一个房间。连接走休眠版 `ctx.acceptWebSocket()`，心跳由运行时用
 * `setWebSocketAutoResponse` 直接回，实例可以被回收、连接照样挂着。
 * 所以**不能把连接存在实例字段里**，连接列表一律现问 `ctx.getWebSockets()`；
 * 自动回复也**必须登记在构造函数里**，醒来那一次没有人走接入路径。
 */
export class LivePushRoom extends DurableObject<Env> {
  /**
   * 本地开发的上游推送中继（见 public-api.ts 的 UPSTREAM_API_URL）：本地没有上报进来，
   * 房间里永远没事件；配了上游就由这个实例自己去连生产的 /ws，收到什么原样广播给
   * 本地页面。只在有本地页面连着时保持，最后一个页面走了就断开 —— 它在生产那边
   * 也算一条连接，别让开发机一直把生产钉在「有人在看」。生产不配这个变量，
   * 这几个字段永远是空的。
   */
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
    // 按 0 / 1 取，不绕 Object.values：WebSocketPair 的类型把这两个下标写成了
    // 具名属性，摊成数组之后 noUncheckedIndexedAccess 会把它们变成可选的
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ at: Date.now() });
    this.ctx.waitUntil(this.ensureUpstreamRelay());

    return new Response(null, { status: 101, webSocket: client });
  }

  private async ensureUpstreamRelay(): Promise<void> {
    const base = process.env.UPSTREAM_API_URL?.trim().replace(/\/+$/, "");
    if (!base || this.upstream) return;
    try {
      // 生产按 Origin 白名单放行握手，服务端到服务端没有浏览器替我们带，手动写站点的
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
      // 生产那边 30 分钟没 ping 会把连接当僵尸关掉，和浏览器一样每 30 秒报个到
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
        // 本地还有页面挂着就重连；没有就等下一个页面接进来再连
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

  /**
   * 上游事件带着 payload，页面收到会直接写进 SWR 缓存 —— 假数据开着时生产一推，
   * 夹具就被盖掉了。所以转发前问一下本地：这条事件对应的端点有生效的注入就把
   * payload 换成注入的那份（页面看到的和它自己去问端点一样），没有就原样转发。
   */
  private async relayUpstreamMessage(raw: string): Promise<void> {
    let message: { type?: unknown; payload?: unknown } | null = null;
    try {
      message = JSON.parse(raw) as { type?: unknown; payload?: unknown };
    } catch {
      // 不是 JSON 的照样转，页面那头自己会忽略
    }
    const path = typeof message?.type === "string" ? pathForEventType(message.type) : null;
    if (path && this.env.STATE) {
      try {
        const hub = this.env.STATE.get(this.env.STATE.idFromName("global"));
        const response = await hub.fetch(new Request(`https://local/api/dev/override${path}`));
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
        // 已经断了但还没收到 close 的，丢掉这一条即可，运行时随后会清理
      }
    }
    return delivered;
  }

  /**
   * 数人头时跳过静默超过 5 分钟的连接：对端消失却没发过 close 帧的连接会一直挂在
   * 列表里，一条这样的僵尸就足以把上报器永远钉在中档。判据是运行时替我们记的 ping
   * 自动回复时刻（浏览器每 30 秒发一个），阈值取 5 分钟而不是贴着心跳画线 —— 后台
   * 标签页的定时器会被浏览器节流到最多每分钟一响。
   *
   * 「不计数」和「关掉」是两条线：锁屏、移动端后台会被整个冻结，随时会解冻回来，
   * 关掉只会逼它重连。所以关的那条线推到 30 分钟，顺路在数人头时做掉，不额外挂闹钟。
   */
  connectionCount(now = Date.now()): number {
    let alive = 0;
    for (const socket of this.ctx.getWebSockets()) {
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(socket);
      const attachment = socket.deserializeAttachment() as { at?: unknown } | null;
      const acceptedAt = typeof attachment?.at === "number" ? attachment.at : null;
      // 两样都没有：这次部署之前接进来的旧连接，且此后一个 ping 都没发过
      const lastSeen = pinged?.getTime() ?? acceptedAt;
      const silentMs = lastSeen === null ? Number.POSITIVE_INFINITY : now - lastSeen;
      if (silentMs <= CONNECTION_STALE_MS) {
        alive += 1;
      } else if (silentMs > CONNECTION_CLOSE_MS) {
        // 1001 = going away。关不掉（已经断了）就算了，运行时随后会清理
        try {
          socket.close(1001, "静默过久");
        } catch { }
      }
    }
    return alive;
  }

  async webSocketMessage(): Promise<void> { }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // 1005（没给关闭码）和 1006（没收到 close 帧）都是"保留码"：
    // 它们描述的是连接怎么断的，不能拿来当自己要发出去的关闭码，传进去会抛
    ws.close(code === 1005 || code === 1006 ? 1000 : code);
    // 最后一个本地页面走了，上游中继也一起断，别在生产那边多占一条连接
    if (this.upstream && this.ctx.getWebSockets().every((socket) => socket === ws)) {
      this.dropUpstreamRelay();
    }
  }
}

const worker = {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.STATE || !(await getRoom(env).connectionCount())) return;
    await withRequestState(() => requestStore.run({ env, ctx }, () => refreshRecentlyPlayed()));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/internal/storage/import") return handleImport(request, env);

    if (url.pathname.startsWith(INGEST_PREFIX)) {
      return handleIngest(request, env, ctx, url.pathname.slice(INGEST_PREFIX.length));
    }

    // 每条返回都带上，不只是成功那条：只有 200 带 CORS 头的话，浏览器侧的调用方
    // 看到的会是一句 CORS 错误，而不是 401 / 400 这些真正说明问题的状态码
    const cors = getCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // 排在公开 API 那条之前：它不是状态读取，不进 StateHub
    if (url.pathname === MUSICKIT_TOKEN_PATH) {
      return handleMusicKitToken(request, env, cors);
    }

    if (url.pathname.startsWith("/api/")) {
      // 本地假数据注入（见 public-api.ts）要 PUT / DELETE；只在 .dev.vars 开了 DEV_OVERRIDES 时放行
      const devOverride = process.env.DEV_OVERRIDES?.trim() === "true" && url.pathname.startsWith("/api/dev/");
      if (request.method !== "GET" && !devOverride) return new Response("Method not allowed", { status: 405, headers: cors });
      const origin = request.headers.get("Origin");
      if (origin && !isAllowedOriginValue(origin, getAllowedOrigins(env))) return jsonResponse({ ok: false }, { status: 403, headers: cors });
      const response = await env.STATE.get(env.STATE.idFromName("global")).fetch(request);
      const headers = new Headers(response.headers);
      cors.forEach((value, name) => headers.set(name, value));
      headers.set("Access-Control-Expose-Headers", "X-Fetched-At");
      return new Response(response.body, { status: response.status, headers });
    }

    if (url.pathname === WS_PATH) {
      const rejected = rejectSocket(request, env);
      if (rejected) return rejected;
      const response = await getRoom(env).fetch(request);
      if (response.status === 101 && env.STATE) {
        await withRequestState(() => requestStore.run({ env, ctx }, () => refreshRecentlyPlayed()));
      }
      return response;
    }

    if (url.pathname === "/count") {
      return jsonResponse({ ok: true, connections: await getRoom(env).connectionCount() }, { headers: cors });
    }

    if (url.pathname === "/") {
      // 只报存活，不碰 Durable Object：根路径被各种探针和浏览器不停打，人头数走 /count
      return jsonResponse({ ok: true, service: "ingest" });
    }

    return new Response("Not found", { status: 404 });
  },
};

export default worker;
