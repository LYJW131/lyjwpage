import type { AuthSession } from "./auth";
import { language, type Env } from "./env";

/** psn-api 的响应类型描述的是「一切正常」那条路；上游少给字段不算异常，逐层放松。 */
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

/** 429 退避重试。礼让性 sleep 拿掉之后，上游限流靠这里接住。 */
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

/** 负数一律当没有：站点把所有时间字段按非负数硬校验，一条越界就退整封信。 */
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

/** 业务请求遇到 401 时强制续期一次，并且只重试一次。 */
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

/**
 * psn-api 2.18.1 里有一半取数函数遇上游报错（429 / 401）既不抛也不看 HTTP 状态码，
 * 原样把 `{error:{…}}` 交回来。不断言就会把「空目录」当权威数据推给站点，指纹照写，
 * 下一轮还认为没变化 —— 限流一次，目录就空到下次真变化为止。
 */
export function assertNoPsnError<T>(raw: T, what: string): T {
  const message = describePsnError(raw);
  if (message) throw new Error(`PSN ${what} 报错：${message}`);
  return raw;
}

/**
 * 站点的校验是信封级的全有全无：一个字段越界，整封信 400，这一部分连同同信封的
 * 其它部分一起丢掉。所以数值在源头就钳到站点认的区间，别指望上游一直守规矩。
 */
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

/** 站点的 `text()`：空串和纯空白都算没有。 */
export function trimmed(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
