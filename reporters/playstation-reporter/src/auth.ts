import {
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForAccessCode,
  exchangeRefreshTokenForAuthTokens,
  type AuthTokensResponse,
} from "psn-api";

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
 * 这是一套**非官方**接口：索尼没有公开文档，鉴权流程交给 psn-api 维护。
 *
 * ⚠️ 这些调用都**没有用真实凭据跑过**（见 README 顶部的声明）。
 */

/* ── 错误类型 ──────────────────────────────────────────────── */

/** 压根没配 NPSSO，而且状态文件里也没有可用的 refresh token */
export class NpssoMissing extends Error {}

/** NPSSO 换不出 access code：多半是过期了或者抄漏了一截 */
export class NpssoRejected extends Error {}

/** refresh token 被上游拒了。手上有 NPSSO 的话还能整条重来一遍 */
export class RefreshRejected extends Error {}

/** NPSSO 失效时该说的两条运维提醒，报错和 README 共用一份文案 */
export const NPSSO_ADVICE = [
  "去 https://ca.account.sony.com/api/v1/ssocookie 取一串 NPSSO（要先在 playstation.com 登录），填进 PSN_NPSSO",
  "别从 PlayStation 网站登出 —— 登出会让已经发出去的 token 在七天内软失效",
  "重新生成 NPSSO 会**立刻**作废上一串，所以别在两处同时用同一个账号换码",
].join("\n  · ");

/* ── psn-api 的鉴权结果 → 状态文件 ─────────────────────────── */

class IncompleteAuthTokens extends Error {}

function toState(raw: AuthTokensResponse, issuedAt: number): AuthState {
  // psn-api 的声明把这些字段都写成必给，但它当前不会先检查 HTTP 状态：
  // 上游 4xx 的 JSON 也会走到映射逻辑，运行时可能得到一组 undefined，仍要自己验。
  if (
    typeof raw.accessToken !== "string" ||
    !raw.accessToken ||
    typeof raw.refreshToken !== "string" ||
    !raw.refreshToken
  ) {
    throw new IncompleteAuthTokens("PSN 没给全 access / refresh token");
  }
  // 上游给的是秒，落库统一成 epoch 毫秒（AGENTS.md 第 4 条）。
  // 两个默认值只是万一上游不给时不至于算出 NaN：1 小时 / 60 天是观测到的量级
  const accessSeconds = Number(raw.expiresIn) || 3600;
  const refreshSeconds = Number(raw.refreshTokenExpiresIn) || 60 * 24 * 3600;
  return {
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken,
    accessTokenIssuedAt: issuedAt,
    accessTokenExpiresAt: issuedAt + accessSeconds * 1000,
    refreshTokenIssuedAt: issuedAt,
    refreshTokenExpiresAt: issuedAt + refreshSeconds * 1000,
  };
}

async function exchangeAccessCodeForTokens(accessCode: string): Promise<AuthState> {
  const issuedAt = Date.now();
  try {
    return toState(await exchangeAccessCodeForAuthTokens(accessCode), issuedAt);
  } catch (error) {
    if (!(error instanceof IncompleteAuthTokens)) throw error;
    throw new NpssoRejected(`access code 换 token 失败：${error.message}\n  · ${NPSSO_ADVICE}`);
  }
}

async function exchangeRefreshTokenForTokens(refreshToken: string): Promise<AuthState> {
  const issuedAt = Date.now();
  try {
    return toState(await exchangeRefreshTokenForAuthTokens(refreshToken), issuedAt);
  } catch (error) {
    if (!(error instanceof IncompleteAuthTokens)) throw error;
    throw new RefreshRejected(`refresh token 被拒：${error.message}`);
  }
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
  let accessCode: string;
  try {
    accessCode = await exchangeNpssoForAccessCode(config.psn.npsso);
  } catch (error) {
    // psn-api 对 NPSSO 被拒只抛普通 Error，也不带 HTTP 状态；网络错误同样是普通 Error。
    // 只把它那条固定的「NPSSO 是否有效」错误归成可操作的凭据问题，断网仍原样上抛。
    if (
      !(error instanceof Error) ||
      !error.message.includes("problem retrieving your PSN access code")
    ) {
      throw error;
    }
    throw new NpssoRejected(`NPSSO 换不出 access code。\n  · ${NPSSO_ADVICE}`);
  }
  if (!accessCode) {
    throw new NpssoRejected(`NPSSO 换回了空 access code。\n  · ${NPSSO_ADVICE}`);
  }
  const state = await exchangeAccessCodeForTokens(accessCode);
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
