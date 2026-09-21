import { createHash, createHmac, randomUUID } from "node:crypto";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const encode = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * 阿里云 ACS3 签名；query 的键值按规范编码排序。
 * @param {{
 *   endpoint: string,
 *   action: string,
 *   version: string,
 *   query: Record<string, string>,
 *   accessKeyId: string,
 *   accessKeySecret: string,
 *   date?: string,
 *   nonce?: string
 * }} options
 * @returns {{ url: string, headers: Record<string, string> }}
 */
export function signAliyunRequest(options) {
  const query = Object.keys(options.query)
    .sort()
    .map((key) => `${encode(key)}=${encode(options.query[key])}`)
    .join("&");
  const payloadHash = sha256("");
  const headers = {
    host: options.endpoint,
    "x-acs-action": options.action,
    "x-acs-content-sha256": payloadHash,
    "x-acs-date": options.date ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    "x-acs-signature-nonce": options.nonce ?? randomUUID(),
    "x-acs-version": options.version,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const canonical = ["POST", "/", query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const signature = createHmac("sha256", options.accessKeySecret)
    .update(`ACS3-HMAC-SHA256\n${sha256(canonical)}`)
    .digest("hex");
  headers.authorization = `ACS3-HMAC-SHA256 Credential=${options.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;
  return { url: `https://${options.endpoint}/?${query}`, headers };
}

const PURGE_ATTEMPTS = 3;
const PURGE_BACKOFF_MS = [1_000, 2_000];

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNABORTED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_ABORTED",
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 408 / 429 / 5xx 视为可重试；其余 4xx（鉴权、参数）不重试。 */
function isTransientStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Node fetch 把连接失败包成 `TypeError: fetch failed`，具体码在 cause 上。
 * 超时是 TimeoutError / AbortError。HTTP 应答不会走到这里。
 * @param {unknown} error
 */
function isTransientNetworkError(error) {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return true;
  const cause = "cause" in error ? error.cause : undefined;
  const code =
    (cause && typeof cause === "object" && "code" in cause && cause.code) ||
    ("code" in error ? error.code : undefined);
  if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) return true;
  return "message" in error && error.message === "fetch failed";
}

const CAUSE_LOG_KEYS = ["name", "code", "errno", "syscall", "hostname", "address", "port"];

/** 日志里去掉密钥、签名和带 query 的 URL，避免把鉴权材料打进 Actions。 */
function scrubLogValue(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) text = text.split(secret).join("[redacted]");
  }
  text = text.replace(/https?:\/\/\S+/gi, (url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return "[url]";
    }
  });
  return text.replace(
    /(Signature|Credential|Authorization|AccessKey(?:Id|Secret)?)\s*[=:]\s*\S+/gi,
    "$1=[redacted]",
  );
}

/** 优先用 AggregateError 里真正带 code / syscall 的那条。 */
function pickCauseNode(error) {
  const cause = error instanceof Error ? error.cause : undefined;
  if (!cause || typeof cause !== "object") return undefined;
  if (Array.isArray(cause.errors)) {
    const inner = cause.errors.find(
      (item) => item && typeof item === "object" && (item.code || item.syscall || item.hostname),
    );
    if (inner) return inner;
  }
  return cause;
}

function networkLogFields(error) {
  const fields = {};
  if (error instanceof Error) {
    if (error.name) fields.name = error.name;
    if (error.message) fields.message = error.message;
  } else {
    fields.message = String(error);
  }
  const cause = pickCauseNode(error);
  if (!cause) return fields;
  for (const key of CAUSE_LOG_KEYS) {
    const value = cause[key];
    if (value == null || value === "") continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    fields[`cause.${key}`] = value;
  }
  return fields;
}

function logAttemptFailure({ attempt, attempts, willRetry, delayMs, fields, secrets }) {
  const decision = willRetry ? `还会重试（${delayMs}ms 后）` : "不再重试";
  const parts = [`[esa-purge] 第 ${attempt}/${attempts} 次失败，${decision}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    parts.push(`${key}=${scrubLogValue(value, secrets)}`);
  }
  console.warn(parts.join(" "));
}

/** 把 undici 藏在 cause 里的码和原文拼进退出摘要，并去掉密钥。 */
function describeFetchError(error, secrets = []) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = pickCauseNode(error);
  const code = cause && "code" in cause ? cause.code : undefined;
  const causeMessage = cause instanceof Error ? cause.message : "";
  const parts = [message];
  if (typeof code === "string" && code && !message.includes(code)) parts.push(code);
  if (causeMessage && causeMessage !== message && !message.includes(causeMessage)) parts.push(causeMessage);
  return scrubLogValue(parts.join(": "), secrets);
}

/**
 * 单次 PurgeCaches。每次调用重新签名，nonce 和日期必须是新的。
 * @param {{ siteId: string, cacheUrl: string, accessKeyId: string, accessKeySecret: string }} config
 */
async function requestPurge(config) {
  const { url, headers } = signAliyunRequest({
    endpoint: "esa.cn-hangzhou.aliyuncs.com",
    action: "PurgeCaches",
    version: "2024-09-10",
    query: {
      Content: JSON.stringify({ CacheKeys: [{ Url: config.cacheUrl, Headers: {} }] }),
      SiteId: config.siteId,
      Type: "cachekey",
    },
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
  });

  const response = await fetch(url, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(10_000),
    redirect: "manual",
  });

  const result = await response.json().catch(() => null);
  const code = typeof result?.Code === "string" ? result.Code : undefined;
  const requestId = typeof result?.RequestId === "string" ? result.RequestId : undefined;

  if (!response.ok || code || typeof result?.TaskId !== "string" || !result.TaskId) {
    return {
      ok: false,
      retryable: isTransientStatus(response.status),
      error: scrubLogValue(
        `ESA 刷新失败 (HTTP ${response.status}): ${code ?? "InvalidResponse"} - ${result?.Message ?? ""}`.trim(),
        [config.accessKeyId, config.accessKeySecret],
      ),
      requestId,
      status: response.status,
      code,
    };
  }

  return {
    ok: true,
    taskId: result.TaskId,
    requestId: result.RequestId,
  };
}

/**
 * 调用 ESA PurgeCaches 刷新首页 cachekey，不影响带哈希的一年静态资源。
 * 只对瞬时网络错误和 408 / 429 / 5xx 重试，最多 3 次，间隔 1s、2s。
 * @param {{
 *   siteId?: string,
 *   cacheUrl?: string,
 *   accessKeyId?: string,
 *   accessKeySecret?: string
 * }} config
 * @param {{
 *   attempts?: number,
 *   backoffMs?: number[],
 *   sleep?: (ms: number) => Promise<void>
 * }} [options]
 * @returns {Promise<{ ok: boolean, taskId?: string, requestId?: string, error?: string }>}
 */
export async function purgeEsaHomepage(config, options = {}) {
  const { siteId, cacheUrl, accessKeyId, accessKeySecret } = config;
  if (!siteId || !cacheUrl || !accessKeyId || !accessKeySecret) {
    return { ok: false, error: "缺少必要配置：ESA_SITE_ID, ESA_CACHE_URL, ALIYUN_ACCESS_KEY_ID 或 ALIYUN_ACCESS_KEY_SECRET" };
  }

  const attempts = options.attempts ?? PURGE_ATTEMPTS;
  const backoffMs = options.backoffMs ?? PURGE_BACKOFF_MS;
  const wait = options.sleep ?? sleep;
  const secrets = [accessKeyId, accessKeySecret];
  let last = { ok: false, error: "ESA 刷新失败" };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 1_000;
    try {
      const outcome = await requestPurge({ siteId, cacheUrl, accessKeyId, accessKeySecret });
      if (outcome.ok) return { ok: true, taskId: outcome.taskId, requestId: outcome.requestId };
      const willRetry = outcome.retryable && attempt < attempts;
      logAttemptFailure({
        attempt,
        attempts,
        willRetry,
        delayMs: delay,
        secrets,
        fields: { status: outcome.status, code: outcome.code, requestId: outcome.requestId },
      });
      last = { ok: false, error: outcome.error, requestId: outcome.requestId };
      if (!willRetry) return last;
    } catch (error) {
      const willRetry = isTransientNetworkError(error) && attempt < attempts;
      logAttemptFailure({
        attempt,
        attempts,
        willRetry,
        delayMs: delay,
        secrets,
        fields: networkLogFields(error),
      });
      last = { ok: false, error: describeFetchError(error, secrets) };
      if (!willRetry) return last;
    }

    await wait(delay);
  }

  return last;
}

/**
 * 刷新后打一下目标 URL 触发边缘回源并写入缓存（预热）。
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
export async function warmupEsaCache(url, options = {}) {
  const { timeoutMs = 15_000 } = options;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EsaWarmupBot/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    // 消耗 response body 确保请求完整结束
    await response.text().catch(() => "");
    return {
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

