import { config } from "./config.js";

export type AgentLimit = {
  key: string;
  label: string | null;
  group: string | null;
  windowMinutes: number | null;
  usedPercent: number;
  resetsAt: number | null;
};

export type AgentRow = {
  id: string;
  plan: { tier: string; label: string } | null;
  limits: AgentLimit[];
  limitsError: string | null;
};

export type PushPayload = {
  collectedAt: string;
  agents: AgentRow[];
};

type SiteEnvelope<T> = { ok?: boolean; error?: string; data?: T };

function authHeaders(): Record<string, string> {
  return config.site.secret ? { Authorization: `Bearer ${config.site.secret}` } : {};
}

/**
 * 「站点回了 `ok !== true` 就算失败」这条约定是**协议**的一部分，不是这个函数的
 * 内部实现 —— 站点的 ingestRoute 会用 200 之外的状态码和一个 `ok: false` 的信封
 * 表示软失败，认错了就会把它当成上报成功，而没有任何测试或类型会拦住。
 *
 * 将来再添上报器仍然是各自抄一份、各自是独立部署单元（理由见 log.ts），
 * 抄的时候连这条约定一起抄走。
 */
async function readEnvelope<T>(response: Response): Promise<T | undefined> {
  const body = (await response.json().catch(() => null)) as SiteEnvelope<T> | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
  }
  return body.data;
}

export async function push(payload: PushPayload): Promise<void> {
  const response = await fetch(config.site.ingestUrl, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.pushTimeoutMs),
  });
  await readEnvelope(response);
}
