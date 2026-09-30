import type { AuthSession } from "./auth.js";
import { language, type Env } from "./env.js";

export type Loose<T> =
  T extends Array<infer Item>
    ? Array<Loose<Item>>
    : T extends object
      ? { [Key in keyof T]?: Loose<T[Key]> }
      : T;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRateLimited(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /\b429\b|too many requests|rate.?limit/i.test(text);
}

export async function retryRateLimit<T>(load: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      last = error;
      if (!isRateLimited(error) || attempt === 3) throw error;
      const waitMs = 500 * 2 ** attempt;
      console.log(JSON.stringify({ event: "psn-rate-limit", attempt: attempt + 1, waitMs }));
      await sleep(waitMs);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

// psn-api 忽略 HTTP 状态直接解析 JSON，Akamai HTML/网关纯文本错误会伪装成 SyntaxError。
export class PsnUpstreamUnavailable extends Error {
  call: string;
  readonly outage = true;
  constructor(call: string, detail: string) {
    super(`PSN 上游不可用（${call}）：${detail}`);
    this.name = "PsnUpstreamUnavailable";
    this.call = call;
  }
}

const NON_JSON_BODY = /is not valid JSON|Unexpected token|Unexpected end of JSON input/i;
const EDGE_REJECTION = /<html|access denied|error code:\s*\d{3}/i;

export function isUpstreamUnavailable(error: unknown): boolean {
  if (error instanceof PsnUpstreamUnavailable) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message;
  if (error instanceof SyntaxError || NON_JSON_BODY.test(message)) return true;
  if (/error code:\s*5\d\d/i.test(message)) return true;
  const status = /PSN 返回 (\d{3})/.exec(message)?.[1];
  if (status?.startsWith("5")) return true;
  return status === "403" && EDGE_REJECTION.test(message);
}

export async function upstream<T>(call: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof PsnUpstreamUnavailable || !isUpstreamUnavailable(error)) throw error;
    throw new PsnUpstreamUnavailable(call, (error as Error).message.slice(0, 200));
  }
}

export function epochMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function isAccessTokenRejected(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:\b401\b|\bunauthori[sz]ed\b|access token.+(?:expired|invalid)|(?:expired|invalid).+access token)/i.test(
    error.message,
  );
}

export async function withToken<T>(
  auth: AuthSession,
  load: (token: string) => Promise<T>,
): Promise<T> {
  try {
    return await load(await auth.accessToken());
  } catch (error) {
    if (!isAccessTokenRejected(error)) throw error;
    return load(await auth.accessToken(true));
  }
}

export function languageHeader(env: Env): { "Accept-Language": string } | undefined {
  const value = language(env);
  return value ? { "Accept-Language": value } : undefined;
}

function describePsnError(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const error = (raw as { error?: unknown }).error;
  if (error == null || error === false) return null;
  if (typeof error !== "object") return String(error).trim() || "未附说明";
  const row = error as { message?: unknown; code?: unknown };
  const parts = [
    typeof row.message === "string" && row.message.trim() ? row.message.trim() : "",
    row.code == null ? "" : `code ${String(row.code)}`,
  ].filter(Boolean);
  return parts.join("，") || JSON.stringify(error).slice(0, 200);
}

// psn-api 部分端点把 401/429 的 {error} 当成功返回；不拦截会将空目录写成权威数据并固化指纹。
export function assertNoPsnError<T>(raw: T, what: string): T {
  const message = describePsnError(raw);
  if (message) throw new Error(`PSN ${what} 报错：${message}`);
  return raw;
}

export function nonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function nonNegativeInt(value: unknown): number {
  return Math.trunc(nonNegative(value));
}

export function percent(value: unknown): number {
  return Math.min(nonNegative(value), 100);
}

export function trimmed(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
