import { currentEnv } from "./runtime";

/**
 * `@/lib/apple-developer-token` 在采集 Worker 里的实现。
 *
 * 私钥只在 api Worker 上，这里经 CORE 的 `appleDeveloperToken()` 取一份签好的，
 * 在本 isolate 里用到离到期还剩 `RENEW_BEFORE_MS` 为止。别的 Worker 不持有 .p8。
 */
const RENEW_BEFORE_MS = 10 * 60_000;

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function appleDeveloperToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - RENEW_BEFORE_MS) return cachedToken.token;
  const issued = await currentEnv().CORE.appleDeveloperToken();
  cachedToken = { token: issued.token, expiresAt: issued.expiresAt };
  return issued.token;
}

export function resetAppleDeveloperTokenForTests(): void {
  cachedToken = null;
}
