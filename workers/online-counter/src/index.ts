import { DurableObject } from "cloudflare:workers";

export interface Env {
  ONLINE_COUNTER: DurableObjectNamespace<OnlineCounterRoom>;
  ALLOWED_ORIGINS?: string;
}

const WS_PATH = "/ws";
const COUNT_PATH = "/count";
const ROOM_ID = "global";
const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/**
 * 浏览器每 30 秒发一次 "ping"（src/hooks/use-online-count.ts 里的 heartbeatTimer）。
 * 下面两个阈值都从它推，改站点那侧的间隔就得回来改这个常数。
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * 静默这么久就当连接已经死了。
 *
 * 三个心跳周期：连丢两次 ping 还留着，第三次也没到才动手 —— 这条线不能贴着
 * 心跳间隔画，网络抖一下就误杀活人（客户端会立刻重连，于是每 30 秒踢一次、
 * 重连一次，抖成死循环）。
 * 页面隐藏时客户端是**整条连接关掉**、不是留着连接停心跳，所以「活着但不发
 * 心跳」这种连接不存在，能撞到这条线的只有对端没发 FIN 就消失的那些。
 */
const IDLE_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3;

/** 清扫节奏。一条死连接最坏活到 IDLE_TIMEOUT_MS + 这个值（当前 120 秒） */
const SWEEP_INTERVAL_MS = HEARTBEAT_INTERVAL_MS;

/*
 * 下面这四个函数和 live-push / musickit-token 那两个 worker 逐字一样
 * （workers/live-push/src/index.ts），改一处记得同步另外两处。
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
  /**
   * 连接 → 最近一次收到它消息的时刻。
   *
   * 存成 Map 而不是 Set + 另一张表：人数就是 sessions.size，多一张表就多一个
   * 和它对不上的机会。
   */
  private sessions = new Map<WebSocket, number>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === COUNT_PATH) {
      // 读之前先清一次：闹钟最慢要等一个 SWEEP_INTERVAL_MS，而 playstation-reporter
      // 每分钟读这里定上报节奏，虚高一个人就把它钉在快节奏上
      this.sweepIdleSessions();
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
    await this.scheduleSweep();

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * 定期清扫。
   *
   * 用闹钟而不是只在 /count 被读时惰性清：那个入口的调用方是外部的
   * playstation-reporter，靠它才能把自家计数收敛，等于把正确性押在别人的 cron 上。
   * 闹钟自带续订，房间里还有人就一直转，人走光了下一次醒来不再续订、链条自己
   * 结束 —— 所以不必在每次断开时 deleteAlarm（那是每断一条就多一次写）。
   */
  async alarm(): Promise<void> {
    this.sweepIdleSessions();
    if (this.sessions.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }

  /**
   * 排一次清扫。已经排着就别动：每来一个连接都 setAlarm 会覆盖掉待跑的那次，
   * 访客持续接入时清扫被无限往后推。
   */
  private async scheduleSweep(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) !== null) return;
    await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }

  private handleSession(socket: WebSocket): void {
    socket.accept();
    this.sessions.set(socket, Date.now());
    this.broadcastCount();

    socket.addEventListener("message", (event) => {
      // 收到任何东西都算它还活着，"ping" 只是浏览器目前唯一会发的那种。
      // 先看在不在名单里：已经被清扫掉的连接不能靠一条迟到的消息回来
      if (this.sessions.has(socket)) {
        this.sessions.set(socket, Date.now());
      }
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

  /**
   * 踢掉静默太久的连接。
   *
   * 对端没发 close 帧就消失（断网、设备休眠、进程被杀）时，close / error 事件
   * 一个都不会来，这条连接会永远留在 sessions 里把人数顶高。
   *
   * 只做减法，拿不准就留着：时钟往回跳会让 idle 算成负数，那种时候宁可多数一个
   * 人，也别把还活着的访客踢下线。
   */
  private sweepIdleSessions(): void {
    const now = Date.now();
    let removed = 0;

    for (const [socket, lastSeenAt] of this.sessions) {
      const idleMs = now - lastSeenAt;
      if (!Number.isFinite(idleMs) || idleMs <= IDLE_TIMEOUT_MS) continue;

      // 先从名单里删再 close：这样不管运行时接下来补不补一次 close / error 事件，
      // closeSession 那边 delete 都返回 false，不会替这条连接再广播一遍
      this.sessions.delete(socket);
      removed += 1;
      try {
        // 1001 = going away。1005 / 1006 是保留码，自己发会抛（见 live-push 那份）
        socket.close(1001, "idle timeout");
      } catch {
        // 已经烂掉的连接连 close 都可能抛，从名单里删掉就够了
      }
    }

    // 清完只广播一次，别在上面那个循环里播 —— 理由见 broadcastCount 的注释
    if (removed > 0) this.broadcastCount();
  }

  private broadcastCount(): void {
    const payload = JSON.stringify({ online: this.sessions.size });
    for (const socket of this.sessions.keys()) {
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

