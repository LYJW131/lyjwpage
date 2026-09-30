import { currentEnv } from "./runtime";

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
