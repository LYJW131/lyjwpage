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
 *
 * 这里也数连接（`GET /count`），但和那边数的不是一回事：online-counter 的数是
 * **此刻可见**的页面（它在 visibilitychange 时整条连接关掉，印在页面上给人看），
 * 这里的数是**开着**的页面（含后台标签页、锁了屏的手机）。两个上报器的调频门读
 * 的是后者 —— 「有人可能回来看」比「此刻正盯着」更贴上报该不该保持新鲜。
 */

export interface Env {
  LIVE_PUSH: DurableObjectNamespace<LivePushRoom>;
  /** 发布用的共享密钥。没配则 /publish 一律拒绝 —— 见 worker.fetch 里的说明 */
  LIVE_PUSH_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

const WS_PATH = "/ws";
const PUBLISH_PATH = "/publish";
const COUNT_PATH = "/count";

/** 全站一个房间：浏览器不往回发东西，事件类型已经把内容分开了 */
const ROOM_ID = "global";

const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/**
 * 静默这么久就当对端已经没了。
 *
 * **不能照抄 online-counter 的三个心跳周期（90 秒）。** 那边挂着的只可能是前台
 * 可见的页面 —— 它在 visibilitychange 时整条连接关掉；这边故意相反，后台标签页的
 * 连接一直留着，`/count` 要数的就是这一批。而后台页的 setInterval 会被浏览器节流
 * 到最多每分钟一响（Chrome 的 intensive throttling），贴着 90 秒画线会把真实的后台
 * 连接成片误杀。按被节流后的 60 秒推三个周期，取 5 分钟。
 *
 * 浏览器那侧的心跳间隔是 30 秒（src/hooks/use-live-events.ts 的 HEARTBEAT_MS），
 * 改那个数就回来重算这一条。
 */
const IDLE_TIMEOUT_MS = 5 * 60_000;

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

export class LivePushRoom extends DurableObject<Env> {
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
     * 接上的时刻随连接一起存 —— 实例字段活不过休眠，attachment 可以。
     * 清扫拿它兜底：刚接上、还没发出第一次 ping 的连接没有自动回复时间戳。
     */
    server.serializeAttachment({ connectedAt: Date.now() });
    /**
     * 心跳由运行时直接回，不唤醒实例。
     *
     * 浏览器那侧要定时发点东西，否则中间的代理会把这条空转的连接掐掉；
     * 但要是每次心跳都把休眠的实例叫醒，休眠就白做了。
     */
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));

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
   * 此刻真正挂着的连接数，回答前先清一次死连接。
   *
   * 这个数唯一的消费方是两个上报器的调频门（playstation-reporter 和
   * apple-music-reporter），虚高一条就把它们永久钉在快档上 —— online-counter
   * 当初也是栽在这里。
   *
   * 和那边不同的是这里**没有**定时清扫的闹钟：那份计数印在页面上、必须自己
   * 收敛；这一份只在被问到的那一刻才有意义，而为它每分钟叫醒一次实例，正好把
   * 休眠省下的东西抵消掉。所以清扫挂在读的那一刻。
   */
  liveConnectionCount(): number {
    return this.sweepDeadSockets();
  }

  /**
   * 清掉对端已经消失、却没发过 close 帧的连接，返回还活着的条数。
   *
   * 不能照抄 online-counter 那份 `Map<WebSocket, number>`：休眠会把实例内存清掉，
   * 醒来时构造函数重跑一遍，那个 Map 就空了。改读运行时替我们记的那一枚 ——
   * `setWebSocketAutoResponse` 每回一次 "pong" 就更新它，读它不用把实例叫醒。
   *
   * 只做减法，拿不准就留着：两枚时刻都取不到、或者时钟往回跳算出负数，一律不动。
   */
  private sweepDeadSockets(): number {
    const now = Date.now();
    let live = 0;

    for (const socket of this.ctx.getWebSockets()) {
      const lastPingAt = this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime();
      const attachment = socket.deserializeAttachment() as { connectedAt?: unknown } | null;
      const connectedAt = Number(attachment?.connectedAt);
      const lastSeenAt = lastPingAt ?? (Number.isFinite(connectedAt) ? connectedAt : Number.NaN);
      const idleMs = now - lastSeenAt;

      if (Number.isFinite(idleMs) && idleMs > IDLE_TIMEOUT_MS) {
        try {
          // 1001 = going away。1005 / 1006 是保留码，自己发会抛，见 webSocketClose
          socket.close(1001, "idle timeout");
        } catch {
          // 已经烂掉的连接连 close 都可能抛，不计进 live 就够了
        }
        continue;
      }

      live += 1;
    }

    return live;
  }

  /**
   * 浏览器发来的消息一律不理。
   *
   * 这是单向广播：页面上没有任何东西需要往回说。"ping" 已经被上面的
   * 自动回复接走了，走到这里的都是意料之外的内容。
   */
  async webSocketMessage(): Promise<void> {}

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      // 1005（没给关闭码）和 1006（没收到 close 帧）都是"保留码"：
      // 它们描述的是连接怎么断的，不能拿来当自己要发出去的关闭码，传进去会抛
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {
      // 清扫自己关掉的那些连接会走到这里：close 已经调过一次，再调就抛。
      // 收尾的握手本来就是关掉它，已经关掉的没有第二次可做
    }
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
     * 调频门读的就是这条。不鉴权：上报器是服务端进程，不带 Origin 头，卡白名单
     * 等于把它们挡在外面；而这个数本身没什么可藏的。字段叫 `connections` 不叫
     * online-counter 那个 `online` —— 那边数的是**此刻可见**的页面（它在
     * visibilitychange 时整条连接关掉），这边数的是**开着**的页面（含后台），
     * 两个不同的概念不该共用一个名字。
     */
    if (url.pathname === COUNT_PATH) {
      const connections = await getRoom(env).liveConnectionCount();
      return jsonResponse({ connections }, { headers: cors });
    }

    if (url.pathname === "/") {
      // 一行存活文本，不碰 Durable Object。从前这里挂着连接数，于是浏览器和各种
      // 探针每打一次根路径就把休眠的实例叫醒一回 —— 那个数现在在 /count 上
      return new Response("Live Push Worker is running.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

export default worker;
