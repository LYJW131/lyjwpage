import { config } from "./config.js";

/**
 * 和站点之间的两个方向，走的是同一个地址、同一把锁：
 * GET 取干活要用的凭据，POST 交算好的列表。
 */

export type Credentials = {
  developerToken: string;
  musicUserToken: string;
  /** developer token 的到期时刻，Unix 秒 */
  expiresAt: number;
};

/** 推给站点的一份「最近在听」。字段名和站点的 ListeningPayload 对齐 */
export type ListeningReport = {
  items: Array<{
    id: string;
    title: string;
    artist: string;
    artwork: string | null;
    link: string | null;
    palette: string[];
    /** 只有排在最前那项会算，列表行不显示时长 */
    durationMs: number | null;
  }>;
  /** 推断不出来就是 null，站点原样接受 */
  nowPlaying: { itemId: string; startedAt: number; durationMs: number } | null;
};

type SiteEnvelope<T> = { ok?: boolean; error?: string; data?: T };

function authHeaders(): Record<string, string> {
  return config.site.secret ? { Authorization: `Bearer ${config.site.secret}` } : {};
}

async function readEnvelope<T>(response: Response): Promise<T | undefined> {
  const body = (await response.json().catch(() => null)) as SiteEnvelope<T> | null;
  if (!response.ok || body?.ok !== true) {
    // 把站点给的原因带出来：401 是密钥不对，503 是 Mac 那边还没授权，差得远
    throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
  }
  return body.data;
}

/**
 * 取凭据。
 *
 * 签 developer token 的 .p8 私钥留在 Mac 的钥匙串里，这边签不出来，只能问站点要
 * Mac 上报器推上去的那份。站点也只是转交，不做加工。
 */
export async function fetchCredentials(): Promise<Credentials> {
  const response = await fetch(config.site.ingestUrl, {
    headers: { ...authHeaders(), Accept: "application/json" },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  const data = await readEnvelope<Partial<Credentials>>(response);
  const { developerToken, musicUserToken, expiresAt } = data ?? {};
  if (!developerToken || !musicUserToken || !expiresAt) {
    throw new Error("站点给的凭据不全");
  }
  return { developerToken, musicUserToken, expiresAt };
}

export async function push(payload: ListeningReport): Promise<{ items: number; changed: boolean }> {
  const response = await fetch(config.site.ingestUrl, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.pushTimeoutMs),
  });

  const data = await readEnvelope<{ items?: number; changed?: boolean }>(response);
  return { items: data?.items ?? 0, changed: data?.changed === true };
}
