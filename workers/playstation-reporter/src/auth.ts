import {
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForAccessCode,
  exchangeRefreshTokenForAuthTokens,
  type AuthTokensResponse,
} from "psn-api";

import type { Env } from "./env";
import { pastHalfLife, readAuth, writeAuth, type AuthState } from "./state";

export class NpssoMissing extends Error {}
export class NpssoRejected extends Error {}
export class RefreshRejected extends Error {}

export const NPSSO_ADVICE = [
  "去 https://ca.account.sony.com/api/v1/ssocookie 取一串 NPSSO（要先在 playstation.com 登录），写入 Worker secret PSN_NPSSO",
  "别从 PlayStation 网站登出 —— 登出会让已经发出去的 token 在七天内软失效",
  "重新生成 NPSSO 会立刻作废上一串，所以别在两处同时用同一个账号换码",
].join("\n  · ");

class IncompleteAuthTokens extends Error {}

function toState(raw: AuthTokensResponse, issuedAt: number): AuthState {
  if (
    typeof raw.accessToken !== "string" ||
    !raw.accessToken ||
    typeof raw.refreshToken !== "string" ||
    !raw.refreshToken
  ) {
    throw new IncompleteAuthTokens("PSN 没给全 access / refresh token");
  }
  const accessSeconds = Number(raw.expiresIn) || 3600;
  // 今晚真实凭据观察到 refresh token 约 10 天；上游若给出期限，始终以它为准。
  const refreshSeconds = Number(raw.refreshTokenExpiresIn) || 10 * 24 * 3600;
  return {
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken,
    accessTokenIssuedAt: issuedAt,
    accessTokenExpiresAt: issuedAt + accessSeconds * 1000,
    refreshTokenIssuedAt: issuedAt,
    refreshTokenExpiresAt: issuedAt + refreshSeconds * 1000,
  };
}

function stamp(at: number): string {
  return new Date(at).toISOString();
}

function announce(state: AuthState, how: string): void {
  console.log(
    JSON.stringify({
      event: "psn-auth",
      message: how,
      accessTokenExpiresAt: stamp(state.accessTokenExpiresAt),
      refreshTokenExpiresAt: stamp(state.refreshTokenExpiresAt),
    }),
  );
}

/**
 * 每次 scheduled invocation 建一份会话：presence 和 played games 顺序共用 current，
 * single-flight 也只覆盖这一轮，不把请求态留在 Worker 全局。
 */
export class AuthSession {
  private current: AuthState | null = null;
  private inflight: Promise<AuthState> | null = null;

  constructor(private readonly env: Env) {}

  private async exchangeAccessCode(accessCode: string): Promise<AuthState> {
    const issuedAt = Date.now();
    try {
      return toState(await exchangeAccessCodeForAuthTokens(accessCode), issuedAt);
    } catch (error) {
      if (!(error instanceof IncompleteAuthTokens)) throw error;
      throw new NpssoRejected(`access code 换 token 失败：${error.message}\n  · ${NPSSO_ADVICE}`);
    }
  }

  private async exchangeRefreshToken(refreshToken: string): Promise<AuthState> {
    const issuedAt = Date.now();
    try {
      return toState(await exchangeRefreshTokenForAuthTokens(refreshToken), issuedAt);
    } catch (error) {
      if (!(error instanceof IncompleteAuthTokens)) throw error;
      throw new RefreshRejected(`refresh token 被拒：${error.message}`);
    }
  }

  private async fromNpsso(reason: string): Promise<AuthState> {
    const npsso = this.env.PSN_NPSSO?.trim();
    if (!npsso) {
      throw new NpssoMissing(
        `${reason}，而且没有可用的 NPSSO。请写入 Worker secret PSN_NPSSO。\n  · ${NPSSO_ADVICE}`,
      );
    }

    let accessCode: string | null;
    try {
      accessCode = await exchangeNpssoForAccessCode(npsso);
    } catch (error) {
      // 只有 psn-api 固定的拒绝文案才退回凭据问题；网络错误原样抛出。
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

    const state = await this.exchangeAccessCode(accessCode);
    this.current = state;
    await writeAuth(this.env.STATE, state);
    announce(state, "用 NPSSO 换到新 token");
    return state;
  }

  private async renew(): Promise<AuthState> {
    this.current ??= await readAuth(this.env.STATE);
    if (this.current) {
      const now = Date.now();
      if (this.current.refreshTokenExpiresAt > now) {
        try {
          const state = await this.exchangeRefreshToken(this.current.refreshToken);
          this.current = state;
          await writeAuth(this.env.STATE, state);
          announce(state, "续到新 token");
          return state;
        } catch (error) {
          if (!(error instanceof RefreshRejected)) throw error;
          return this.fromNpsso(`refresh token 被上游拒了（${error.message}）`);
        }
      }
      return this.fromNpsso(
        `KV 里的 refresh token 已在 ${stamp(this.current.refreshTokenExpiresAt)} 过期`,
      );
    }
    return this.fromNpsso("KV 里没有可用的 refresh token");
  }

  async accessToken(force = false): Promise<string> {
    // 先把 KV 里的状态认下来再判断半衰期。每轮 invocation 都是新会话，current
    // 初始必为 null —— 不先读 KV 就会一头扎进 renew()，把一串还很新鲜的
    // refresh token 白白轮换掉；每 15 分钟轮换一次，迟早撞上 KV 最终一致
    // 读到旧串的那一天，被拒后就跌回「要 NPSSO」。
    if (!force) this.current ??= await readAuth(this.env.STATE);
    if (
      !force &&
      this.current &&
      !pastHalfLife(this.current.accessTokenIssuedAt, this.current.accessTokenExpiresAt)
    ) {
      return this.current.accessToken;
    }
    if (force) this.current = null;
    this.inflight ??= this.renew().finally(() => {
      this.inflight = null;
    });
    return (await this.inflight).accessToken;
  }
}
