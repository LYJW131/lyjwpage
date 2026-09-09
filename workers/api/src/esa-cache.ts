import { signAliyunRequest } from "@api/aliyun-signature";

export interface EsaCacheEnv {
  ESA_SITE_ID?: string;
  ESA_CACHE_URL?: string;
  ALIYUN_ACCESS_KEY_ID?: string;
  ALIYUN_ACCESS_KEY_SECRET?: string;
}

/** 与控制台 TypeScript 示例相同：只刷新首页 cachekey，不清空静态资源。 */
export async function purgeEsaHomepage(env: EsaCacheEnv): Promise<void> {
  if (!env.ESA_SITE_ID && !env.ESA_CACHE_URL) return;
  if (!env.ESA_SITE_ID || !env.ESA_CACHE_URL || !env.ALIYUN_ACCESS_KEY_ID || !env.ALIYUN_ACCESS_KEY_SECRET) {
    console.error("[esa-purge] missing configuration or credentials");
    return;
  }
  try {
    const { url, headers } = signAliyunRequest({
      endpoint: "esa.cn-hangzhou.aliyuncs.com",
      action: "PurgeCaches",
      version: "2024-09-10",
      query: {
        Content: JSON.stringify({ CacheKeys: [{ Url: env.ESA_CACHE_URL, Headers: {} }] }),
        SiteId: env.ESA_SITE_ID,
        Type: "cachekey",
      },
      accessKeyId: env.ALIYUN_ACCESS_KEY_ID,
      accessKeySecret: env.ALIYUN_ACCESS_KEY_SECRET,
    });
    const response = await fetch(url, {
      method: "POST", headers, signal: AbortSignal.timeout(5_000), redirect: "manual",
    });
    const result = await response.json().catch(() => null) as {
      TaskId?: string; RequestId?: string; Code?: string;
    } | null;
    if (!response.ok || result?.Code || typeof result?.TaskId !== "string" || !result.TaskId) {
      // 不记录请求签名、密钥或服务端回显的完整请求。
      console.error("[esa-purge] failed", response.status, result?.Code ?? "InvalidResponse", result?.RequestId ?? "");
      return;
    }
    console.info("[esa-purge] accepted", result.TaskId, result.RequestId);
  } catch (error) {
    console.error("[esa-purge] request failed", error instanceof Error ? error.name : "UnknownError");
  }
}
