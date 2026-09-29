import type { AuthSession } from "./auth.js";
import { language, type Env } from "./env.js";

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

/** 429 退避重试：上游限流靠这里接住。 */
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

/**
 * PSN 前面那层 CDN（Akamai）挡人、或者网关超时：不是凭据问题，也不是我们的数据问题，
 * 等一会儿就好。单独成一类，tick 按它退避，日志里也能一眼和别的失败分开。
 *
 * 为什么要自己认：psn-api（版本以 package.json 锁定的为准）的取数外壳不看 HTTP 状态码，直接 `.json()`，
 * 于是 Akamai 的 HTML 拒绝页变成 `Unexpected token '<', "<HTML><HEA"... is not valid JSON`，
 * 纯文本的 `error code: 504` 变成 `Unexpected token 'e', "error code: 504"...`；
 * 游玩列表那一路是自己 fetch 的，看得到状态码，报成 `PSN 返回 403：<HTML>…Access Denied…`。
 */
export class PsnUpstreamUnavailable extends Error {
  /** 哪一路调用先撞上的：presence / trophy-summary / played-games / auth … */
  call: string;
  /** 已知的外部故障：任务外层按 warn 记，不当成报错再打一遍（见 registry.ts 的 runJob） */
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
  // 响应体根本不是 JSON：HTML 拒绝页或纯文本的网关错误
  if (error instanceof SyntaxError || NON_JSON_BODY.test(message)) return true;
  if (/error code:\s*5\d\d/i.test(message)) return true;
  // 自己 fetch 的那一路：5xx 一律算，403 只有边缘拒绝页才算（JSON 的 403 是权限问题）
  const status = /PSN 返回 (\d{3})/.exec(message)?.[1];
  if (status?.startsWith("5")) return true;
  return status === "403" && EDGE_REJECTION.test(message);
}

/** 给一路调用贴上名字：上游不可用就换成 PsnUpstreamUnavailable，别的原样抛 */
export async function upstream<T>(call: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof PsnUpstreamUnavailable || !isUpstreamUnavailable(error)) throw error;
    throw new PsnUpstreamUnavailable(call, (error as Error).message.slice(0, 200));
  }
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
