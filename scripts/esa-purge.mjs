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

/**
 * 调用 ESA PurgeCaches 刷新首页 cachekey，不影响带哈希的一年静态资源。
 * @param {{
 *   siteId?: string,
 *   cacheUrl?: string,
 *   accessKeyId?: string,
 *   accessKeySecret?: string
 * }} config
 * @returns {Promise<{ ok: boolean, taskId?: string, requestId?: string, error?: string }>}
 */
export async function purgeEsaHomepage(config) {
  const { siteId, cacheUrl, accessKeyId, accessKeySecret } = config;
  if (!siteId || !cacheUrl || !accessKeyId || !accessKeySecret) {
    return { ok: false, error: "缺少必要配置：ESA_SITE_ID, ESA_CACHE_URL, ALIYUN_ACCESS_KEY_ID 或 ALIYUN_ACCESS_KEY_SECRET" };
  }

  try {
    const { url, headers } = signAliyunRequest({
      endpoint: "esa.cn-hangzhou.aliyuncs.com",
      action: "PurgeCaches",
      version: "2024-09-10",
      query: {
        Content: JSON.stringify({ CacheKeys: [{ Url: cacheUrl, Headers: {} }] }),
        SiteId: siteId,
        Type: "cachekey",
      },
      accessKeyId,
      accessKeySecret,
    });

    const response = await fetch(url, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });

    const result = (await response.json().catch(() => null));

    if (!response.ok || result?.Code || typeof result?.TaskId !== "string" || !result.TaskId) {
      return {
        ok: false,
        error: `ESA 刷新失败 (HTTP ${response.status}): ${result?.Code ?? "InvalidResponse"} - ${result?.Message ?? ""}`.trim(),
        requestId: result?.RequestId,
      };
    }

    return {
      ok: true,
      taskId: result.TaskId,
      requestId: result.RequestId,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
