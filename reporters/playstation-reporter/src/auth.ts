import { config } from "./config.js";
import { info } from "./log.js";
import { pastHalfLife, readState, writeState, type AuthState } from "./state.js";

/**
 * PSN 的鉴权。整条链是：
 *
 *   NPSSO（人手工从浏览器里取，见 README）
 *     → access code（GET /authorize，值在 302 的 Location 里）
 *     → access token（约 1 小时）+ refresh token（约 2 个月）
 *     → 之后一直用 refresh 续，过半衰期就换新的
 *
 * 这是一套**非官方**接口：索尼没有公开文档，下面这些常量是 PlayStation 手机端
 * App 用的那一套。所以一个常量都不许凭记忆写 —— 全部原样抄自 MIT 许可的
 * npm 包 psn-api@2.18.1（achievements-app/psn-api），出处逐条标在旁边。
 * 抄常量不抄包：运行时依赖保持为零，只实现我们真正要打的那两个端点。
 *
 * ⚠️ 本文件里的任何请求都**没有用真实凭据跑过**（见 README 顶部的声明）。
 */

/* ── 常量：全部抄自 psn-api@2.18.1 ─────────────────────────── */

/** psn-api@2.18.1 src/authenticate/AUTH_BASE_URL.ts */
const AUTH_BASE_URL = "https://ca.account.sony.com/api/authz/v3/oauth";

/** psn-api@2.18.1 src/authenticate/exchangeNpssoForAccessCode.ts */
const CLIENT_ID = "09515159-7237-4370-9b40-3806e67c0891";
const REDIRECT_URI = "com.scee.psxandroid.scecompcall://redirect";
const SCOPE = "psn:mobile.v2.core psn:clientapp";

/**
 * psn-api@2.18.1 src/authenticate/exchangeAccessCodeForAuthTokens.ts
 * 和 src/authenticate/exchangeRefreshTokenForAuthTokens.ts（两处字面量一致）。
 *
 * 这是手机端 App 的 client id + client secret 做的 Basic —— 是随 App 一起分发的
 * 公开常量，不是任何人的私人凭据，所以可以躺在源码里。真正见不得人的是 NPSSO
 * 和换出来的两个 token，那些走环境变量和 0600 的状态文件。
 */
const CLIENT_AUTHORIZATION =
  "Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=";

/** 取 NPSSO 的地方，同一份源码的 JSDoc 里写着 */
export const NPSSO_URL = "https://ca.account.sony.com/api/v1/ssocookie";

/* ── 错误类型 ──────────────────────────────────────────────── */

/** 压根没配 NPSSO，而且状态文件里也没有可用的 refresh token */
export class NpssoMissing extends Error {}

/** NPSSO 换不出 access code：多半是过期了或者抄漏了一截 */
export class NpssoRejected extends Error {}

/** refresh token 被上游拒了。手上有 NPSSO 的话还能整条重来一遍 */
export class RefreshRejected extends Error {}

/** access token 被业务端点拒了（401），说明该提前续一次 */
export class AccessTokenRejected extends Error {}

/** NPSSO 失效时该说的两条运维提醒，报错和 README 共用一份文案 */
export const NPSSO_ADVICE = [
  `去 ${NPSSO_URL} 取一串 NPSSO（要先在 playstation.com 登录），填进 PSN_NPSSO`,
  "别从 PlayStation 网站登出 —— 登出会让已经发出去的 token 在七天内软失效",
  "重新生成 NPSSO 会**立刻**作废上一串，所以别在两处同时用同一个账号换码",
].join("\n  · ");

/* ── 三次 HTTP 交换 ────────────────────────────────────────── */

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
};

/** 上游出错时把正文截一段带出来定位问题。正文里不会有 token —— 有 token 的是 200 那条路 */
async function briefly(response: Response) {
  return (await response.text().catch(() => "")).slice(0, 200);
}

function toState(raw: TokenResponse, issuedAt: number): AuthState {
  const { access_token, refresh_token, expires_in, refresh_token_expires_in } = raw;
  if (!access_token || !refresh_token) throw new Error("PSN 没给全 access / refresh token");
  // 上游给的是秒，落库统一成 epoch 毫秒（AGENTS.md 第 4 条）。
  // 两个默认值只是万一上游不给时不至于算出 NaN：1 小时 / 60 天是观测到的量级
  const accessSeconds = Number(expires_in) || 3600;
  const refreshSeconds = Number(refresh_token_expires_in) || 60 * 24 * 3600;
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    accessTokenIssuedAt: issuedAt,
    accessTokenExpiresAt: issuedAt + accessSeconds * 1000,
    refreshTokenIssuedAt: issuedAt,
    refreshTokenExpiresAt: issuedAt + refreshSeconds * 1000,
  };
}

/**
 * NPSSO → access code。
 *
 * 抄自 psn-api@2.18.1 src/authenticate/exchangeNpssoForAccessCode.ts：
 * 这个请求**永远不会返回 200**，正常情况是 302，code 藏在 Location 里，
 * 所以必须 `redirect: "manual"` 自己读头。
 *
 * Location 本身绝对不能进日志 —— 那一串就是 access code。
 */
async function exchangeNpssoForAccessCode(npsso: string): Promise<string> {
  const query = new URLSearchParams({
    access_type: "offline",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
  });

  const response = await fetch(`${AUTH_BASE_URL}/authorize?${query.toString()}`, {
    headers: { Cookie: `npsso=${npsso}` },
    redirect: "manual",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  const location = response.headers.get("location");
  if (!location?.includes("?code=")) {
    throw new NpssoRejected(
      `NPSSO 换不出 access code（HTTP ${response.status}，Location ${location ? "里没有 code" : "缺席"}）。\n  · ${NPSSO_ADVICE}`,
    );
  }

  // 上游给的是 com.scee.psxandroid.scecompcall://redirect/?code=v3.XXXX&cid=...，
  // 不是合法的 http URL，psn-api 是按 "redirect/" 切开再当查询串解析的，照抄
  const code = new URLSearchParams(location.split("redirect/")[1] ?? "").get("code");
  if (!code) throw new NpssoRejected(`Location 里解不出 code。\n  · ${NPSSO_ADVICE}`);
  return code;
}

/** access code → 两个 token。抄自 psn-api@2.18.1 src/authenticate/exchangeAccessCodeForAuthTokens.ts */
async function exchangeAccessCodeForTokens(accessCode: string): Promise<AuthState> {
  const issuedAt = Date.now();
  const response = await fetch(`${AUTH_BASE_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: CLIENT_AUTHORIZATION,
    },
    body: new URLSearchParams({
      code: accessCode,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      token_format: "jwt",
    }).toString(),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    // 换码这一步的 4xx 基本都是 NPSSO 的问题（过期、被新生成的那串顶掉），
    // 所以直接报成可操作的那一类，别让人对着一个裸状态码猜
    const detail = `access code 换 token 失败（HTTP ${response.status}）：${await briefly(response)}`;
    if (response.status === 400 || response.status === 401) {
      throw new NpssoRejected(`${detail}\n  · ${NPSSO_ADVICE}`);
    }
    throw new Error(detail);
  }

  return toState((await response.json()) as TokenResponse, issuedAt);
}

/** refresh token → 新的两个 token。抄自 psn-api@2.18.1 src/authenticate/exchangeRefreshTokenForAuthTokens.ts */
async function exchangeRefreshTokenForTokens(refreshToken: string): Promise<AuthState> {
  const issuedAt = Date.now();
  const response = await fetch(`${AUTH_BASE_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: CLIENT_AUTHORIZATION,
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      token_format: "jwt",
      scope: SCOPE,
    }).toString(),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    throw new RefreshRejected(
      `refresh token 被拒（HTTP ${response.status}）：${await briefly(response)}`,
    );
  }

  return toState((await response.json()) as TokenResponse, issuedAt);
}

/* ── 对外：一把手上的 access token ─────────────────────────── */

let current: AuthState | null = null;
/** 同一时刻只允许一条续期在飞 —— 两个轮询器会同时来要 token */
let inflight: Promise<AuthState> | null = null;

function stamp(at: number) {
  return new Date(at).toISOString();
}

/** 只说到期时刻，不说 token 本身 */
function announce(state: AuthState, how: string) {
  info(
    `${how}：access token 到 ${stamp(state.accessTokenExpiresAt)}，` +
      `refresh token 到 ${stamp(state.refreshTokenExpiresAt)}`,
  );
}

/** 整条重来：NPSSO → code → token。没配 NPSSO 就只能把话说清楚然后放弃 */
async function fromNpsso(reason: string): Promise<AuthState> {
  if (!config.psn.npsso) {
    throw new NpssoMissing(
      `${reason}，而且没有可用的 NPSSO。请设置环境变量 PSN_NPSSO。\n  · ${NPSSO_ADVICE}`,
    );
  }
  const state = await exchangeAccessCodeForTokens(
    await exchangeNpssoForAccessCode(config.psn.npsso),
  );
  // `current` 必须在这里就落定，别只写文件。漏了这一句的后果不是「下次再读一遍」
  // 那么轻：下一次要 token 时 current 仍是 null，renew() 会从文件里把这份**刚拿到的**
  // refresh token 读出来再换一次 —— 白白多打一次上游，还立刻把它轮换掉了。
  // 模拟跑第一版的日志里就是「用 NPSSO 换到新 token」紧跟着一条「续到新 token」
  current = state;
  await writeState(state);
  announce(state, "用 NPSSO 换到新 token");
  return state;
}

async function renew(): Promise<AuthState> {
  // 手上没有就先看状态文件 —— 重启后接着用上次那份 refresh token，这正是它存在的理由
  current ??= await readState();

  if (current) {
    const now = Date.now();
    if (current.refreshTokenExpiresAt > now) {
      try {
        const state = await exchangeRefreshTokenForTokens(current.refreshToken);
        // 上游每次都发一串新的 refresh token，必须一起存回去，
        // 否则两个月后手上那串到期而我们从没更新过，白白退回 NPSSO
        current = state;
        await writeState(state);
        announce(state, "续到新 token");
        return state;
      } catch (error) {
        if (!(error instanceof RefreshRejected)) throw error;
        // 被拒了才退回 NPSSO；超时 / 断网这类要原样抛出去让调用方退避重试，
        // 不该拿一串宝贵的 NPSSO 去撞一堵网络的墙（换一次就作废上一串）
        return fromNpsso(`refresh token 被上游拒了（${error.message}）`);
      }
    }
    return fromNpsso(`状态文件里的 refresh token 已在 ${stamp(current.refreshTokenExpiresAt)} 过期`);
  }

  return fromNpsso("状态文件里没有可用的 refresh token");
}

/**
 * 手上那把 access token，过了半衰期就先换新的。
 *
 * `force` 给业务端点用：它吃了 401，说明这把已经不作数了（上游可能提前作废，
 * 比如账号在网站上登出过），这时别等半衰期。
 */
export async function accessToken(force = false): Promise<string> {
  if (
    !force &&
    current &&
    !pastHalfLife(current.accessTokenIssuedAt, current.accessTokenExpiresAt)
  ) {
    return current.accessToken;
  }
  if (force) current = null;
  inflight ??= renew().finally(() => {
    inflight = null;
  });
  return (await inflight).accessToken;
}

/**
 * 启动时的自检，只看本地，不出网。
 *
 * 「没配 NPSSO」要在**起来的那一刻**就说清楚，而不是等第一轮轮询打完上游才发现；
 * 但状态文件里有货时 NPSSO 本来就不该是必填的，所以判据是两者都没有。
 */
export async function assertUsableCredentials(): Promise<void> {
  if (config.psn.npsso) return;
  const state = await readState();
  if (state && state.refreshTokenExpiresAt > Date.now()) return;
  throw new NpssoMissing(
    "缺少环境变量 PSN_NPSSO" +
      `（状态文件 ${config.stateFile} 里也没有还能用的 refresh token）。\n  · ${NPSSO_ADVICE}`,
  );
}
