import { DurableObject } from "cloudflare:workers";

/**
 * 服务端 → 浏览器的实时推送。
 *
 * 站点把一条事件 POST 到 /publish，这里广播给所有连在 /ws 上的浏览器。
 * 站点自己不持有任何长连接，所以它照旧可以是 serverless 的。
 *
 * 和隔壁 online-counter 分开部署：那个只数人头，谁连上谁断开就是全部输入；
 * 这个要接站点的写入、要鉴权、要转发任意负载。两件事挤在一个 Worker 里的话，
 * 人数广播的改动会和推送的鉴权面互相牵连。
 */

export interface Env {
  LIVE_PUSH: DurableObjectNamespace<LivePushRoom>;
  /** 发布用的共享密钥。没配则 /publish 一律拒绝 —— 见 worker.fetch 里的说明 */
  LIVE_PUSH_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

const WS_PATH = "/ws";
const PUBLISH_PATH = "/publish";

/** 全站一个房间：浏览器不往回发东西，事件类型已经把内容分开了 */
const ROOM_ID = "global";

const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/*
 * 下面这四个函数和 online-counter / musickit-token 那两个 worker 逐字一样
 * （workers/online-counter/src/index.ts），改一处记得同步另外两处。
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
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

/** 逐字节等时比较，别让 401 的返回快慢把密钥一位一位漏出去 */
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
  return env.LIVE_PUSH.getByName(ROOM_ID);
}

/**
 * 静默多久之后不再把一条连接算进人头。理由见 connectionCount。
 */
const CONNECTION_STALE_MS = 5 * 60_000;
/**
 * 静默多久之后把连接关掉。
 *
 * 和上面那条是两个判断，不能合成一个：不计数问的是「此刻这一份能不能收到并画
 * 出来」——冻住的页面（手机锁屏、移动端后台标签页会被浏览器整个冻结，定时器完全
 * 停掉）两样都做不到，5 分钟就不算数是对的；关不关问的是「这条还有没有主」，
 * 关错的代价是逼一个还活着的页面重连，所以线推到 30 分钟，只收真正回不来的。
 *
 * 不关也不是没有代价：连接一直挂着占着实例的连接表，而运行时对休眠实例的连接数
 * 有上限。计数那条线已经挡住了「僵尸把上报器钉在快档」这个真问题，这条只是打扫。
 */
const CONNECTION_CLOSE_MS = 30 * 60_000;

export class LivePushRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    /**
     * 心跳由运行时直接回，不唤醒实例。
     *
     * **必须挂在构造函数里**：休眠醒来会重新 new 一遍实例，只在 accept 那条路上
     * 登记的话，这一次就没人登记了 —— 后面的 ping 落到空的 webSocketMessage，
     * 自动回复时间戳不再走动，而 connectionCount 正是拿那个时刻判活的，还开着的
     * 后台页面会被一条条算成死连接，中间那档就再也进不去了。
     *
     * 浏览器那侧要定时发点东西，否则中间的代理会把这条空转的连接掐掉；
     * 但要是每次心跳都把休眠的实例叫醒，休眠就白做了。
     */
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /**
   * 用休眠版的 acceptWebSocket，不是 accept() + 自己攒一个 Set。
   *
   * 这些连接绝大多数时间是空转的（上报器几十秒才来一条），休眠之后实例可以被
   * 回收、连接照样挂着，事件到了再唤醒。代价是**不能把连接存在实例字段里** ——
   * 休眠会把内存清掉，醒来时构造函数重跑一遍，那个 Set 就空了。
   * 连接列表一律现问 ctx.getWebSockets()。
   */
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
    /**
     * 接入时刻。数人头时要用它兜底：刚连上还没发过第一个 ping 的那 30 秒里，
     * 自动回复的时间戳还是 null，只看那个会把新连接算成死的。
     * 附件跟着连接走，休眠醒来还在（实例字段不行，见上面那段）。
     */
    server.serializeAttachment({ at: Date.now() });

    return new Response(null, { status: 101, webSocket: client });
  }

  /** 广播一条已经序列化好的事件，返回发出去的连接数 */
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
   * 此刻**开着**本站的页面数。上报器拿它调频，所以宁可少数不可多数。
   *
   * 不能直接数 `getWebSockets().length`：对端消失却没发过 close 帧的连接会一直
   * 挂在列表里（手机进电梯、进程被杀），而一条这样的僵尸就足以把上报器永远钉在
   * 快档上 —— online-counter 当初栽的就是这一下。改看运行时替我们记的自动回复
   * 时刻：浏览器每 30 秒发一个 ping（use-live-events 的 HEARTBEAT_MS），静默超过
   * 阈值的就不算数。
   *
   * 阈值取 5 分钟而不是 90 秒：后台标签页的 setInterval 会被浏览器节流到最多每
   * 分钟一响，贴着心跳间隔画线会成片误杀真实的后台连接 —— 而后台标签页恰恰是这
   * 个数存在的理由（可见的那些由 online-counter 数）。
   *
   * 静默 5 分钟只是不计数，不关：关错的代价是逼一个还活着的页面重连。真正回不来
   * 的那些由 CONNECTION_CLOSE_MS 那条线收走，顺路做，不额外挂闹钟 —— 定时唤醒
   * 实例会把休眠省下的东西抵消掉。
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
        } catch {}
      }
    }
    return alive;
  }

  /**
   * 浏览器发来的消息一律不理。
   *
   * 这是单向广播：页面上没有任何东西需要往回说。"ping" 已经被上面的
   * 自动回复接走了，走到这里的都是意料之外的内容。
   */
  async webSocketMessage(): Promise<void> {}

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // 1005（没给关闭码）和 1006（没收到 close 帧）都是"保留码"：
    // 它们描述的是连接怎么断的，不能拿来当自己要发出去的关闭码，传进去会抛
    ws.close(code === 1005 || code === 1006 ? 1000 : code);
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // 每条返回都带上，不只是成功那条：只有 200 带 CORS 头的话，浏览器侧的调用方
    // 看到的会是一句 CORS 错误，而不是 401 / 400 这些真正说明问题的状态码
    const cors = getCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
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

    if (url.pathname === PUBLISH_PATH) {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "只接受 POST" }, { status: 405, headers: cors });
      }

      /**
       * 没配密钥就拒绝，不是放行。
       *
       * 和 /ws 的来源白名单反着来是故意的：那边放开顶多是别的站点蹭一份本来就
       * 公开的广播，这边放开等于让任何人往所有访客的页面里塞任意内容。
       */
      const expected = env.LIVE_PUSH_SECRET;
      if (!expected) {
        return jsonResponse(
          { ok: false, error: "Worker 未配置 LIVE_PUSH_SECRET" },
          { status: 503, headers: cors },
        );
      }
      const provided = bearerToken(request);
      if (!provided || !secretMatches(provided, expected)) {
        return jsonResponse({ ok: false, error: "未授权" }, { status: 401, headers: cors });
      }

      let event: unknown;
      try {
        event = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: "请求体不是合法 JSON" }, { status: 400, headers: cors });
      }
      if (
        typeof event !== "object" ||
        event === null ||
        typeof (event as { type?: unknown }).type !== "string" ||
        !(event as { type: string }).type
      ) {
        return jsonResponse({ ok: false, error: "事件缺少 type" }, { status: 400, headers: cors });
      }

      /**
       * 负载不校验形状，原样转发：事件种类和字段是站点和它自己前端之间的约定，
       * 在这里再抄一份就等于同一份契约维护两处，加一种事件得改两个仓库。
       */
      const delivered = await getRoom(env).broadcast(JSON.stringify(event));
      return jsonResponse({ ok: true, delivered }, { headers: cors });
    }

    /**
     * 调频口。上报器（server-reporter）每轮读一次，据此决定下一轮多久：
     * 有页面开着就别睡太死。不鉴权 —— 调用方是服务端进程，不带 Origin 头，
     * 而这个数本来就等价于站点页脚那个公开的人头数。
     *
     * 字段叫 connections 不叫 online：它和 online-counter 的 `online` 是两个
     * 概念 —— 这个数的是**开着**（含后台标签页、锁了屏的手机），那个数的是
     * **此刻可见**。
     */
    if (url.pathname === "/count") {
      return jsonResponse({ ok: true, connections: await getRoom(env).connectionCount() });
    }

    if (url.pathname === "/") {
      const online = await getRoom(env).connectionCount();
      return jsonResponse({ ok: true, service: "live-push", connections: online });
    }

    return new Response("Not found", { status: 404 });
  },
};

export default worker;
