import type { Env } from "./runtime";

export type EsaHomeConfig = {
  siteId: string;
  homeUrl: string;
  accessKeyId: string;
  accessKeySecret: string;
};

export function esaHomeConfig(env: Env): EsaHomeConfig | null {
  const siteId = env.ESA_SITE_ID?.trim();
  const homeUrl = env.ESA_HOME_URL?.trim();
  const accessKeyId = env.ALIYUN_ESA_ACCESS_KEY_ID?.trim();
  const accessKeySecret = env.ALIYUN_ESA_ACCESS_KEY_SECRET?.trim();
  if (!siteId || !homeUrl || !accessKeyId || !accessKeySecret) return null;
  return { siteId, homeUrl, accessKeyId, accessKeySecret };
}

const encoder = new TextEncoder();
const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
const sha256 = async (value: string) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const encode = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

async function hmacSha256(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export type Acs3Request = {
  endpoint: string;
  action: string;
  version: string;
  query: Record<string, string>;
  accessKeyId: string;
  accessKeySecret: string;
  date?: string;
  nonce?: string;
};

// 阿里云 ACS3-HMAC-SHA256 签名，参数放 query、body 为空；scripts/esa-purge.mjs#signAliyunRequest 是 Node 版，两边用同一组官方固定向量测试。
export async function signAcs3(options: Acs3Request): Promise<{ url: string; headers: Record<string, string> }> {
  const query = Object.keys(options.query)
    .sort()
    .map((key) => `${encode(key)}=${encode(options.query[key]!)}`)
    .join("&");
  const payloadHash = await sha256("");
  const headers: Record<string, string> = {
    host: options.endpoint,
    "x-acs-action": options.action,
    "x-acs-content-sha256": payloadHash,
    "x-acs-date": options.date ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    "x-acs-signature-nonce": options.nonce ?? crypto.randomUUID(),
    "x-acs-version": options.version,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]!.trim()}\n`).join("");
  const canonical = ["POST", "/", query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const signature = await hmacSha256(options.accessKeySecret, `ACS3-HMAC-SHA256\n${await sha256(canonical)}`);
  headers.authorization = `ACS3-HMAC-SHA256 Credential=${options.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;
  return { url: `https://${options.endpoint}/?${query}`, headers };
}

const PURGE_TIMEOUT_MS = 10_000;
const PURGE_BACKOFF_MS = [1_000, 2_000];

class EsaPurgeError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

// 每次尝试都要重新签名：复用日期或 nonce 的请求会被拒。
async function purgeOnce(config: EsaHomeConfig, fetcher: typeof fetch): Promise<string> {
  const { url, headers } = await signAcs3({
    endpoint: "esa.cn-hangzhou.aliyuncs.com",
    action: "PurgeCaches",
    version: "2024-09-10",
    query: {
      Content: JSON.stringify({ CacheKeys: [{ Url: config.homeUrl, Headers: {} }] }),
      SiteId: config.siteId,
      Type: "cachekey",
    },
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
  });
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new EsaPurgeError(`ESA purge network: ${error instanceof Error ? error.message : String(error)}`, true);
  }
  const result = (await response.json().catch(() => null)) as { TaskId?: unknown; Code?: unknown; Message?: unknown } | null;
  if (!response.ok || typeof result?.TaskId !== "string" || !result.TaskId) {
    const code = typeof result?.Code === "string" ? result.Code : "InvalidResponse";
    const message = typeof result?.Message === "string" ? result.Message : "";
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new EsaPurgeError(`ESA purge HTTP ${response.status}: ${code} ${message}`.trim(), retryable);
  }
  return result.TaskId;
}

export async function purgeEsaHome(
  config: EsaHomeConfig,
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await purgeOnce(config, fetcher);
    } catch (error) {
      const delay = PURGE_BACKOFF_MS[attempt];
      if (!(error instanceof EsaPurgeError) || !error.retryable || delay === undefined) throw error;
      await wait(delay);
    }
  }
}
