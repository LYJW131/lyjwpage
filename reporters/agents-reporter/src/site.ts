import type { CursorNow } from "./cursor-now.js";
import type { CursorUsagePush } from "./cursor-usage.js";
import { config } from "./config.js";
import { failure } from "./log.js";
import { createPushLedger } from "./push-ledger.js";

const ledger = createPushLedger(config.pushLedgerPath, config.reporterCommit, (error) => failure("push-ledger", error));

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
  /** 限额那一轮必带；Cursor 活动那条小信封不带，站点就不碰限额镜像 */
  agents?: AgentRow[];
  /** 这一轮 Cursor 云端历史拉成了才带。失败或没登录就省掉，站点留着上一份。 */
  cursorUsage?: CursorUsagePush;
  /** Cursor 最近一条用量事件，见 cursor-now.ts */
  cursorNow?: CursorNow;
};

type SiteEnvelope<T> = { ok?: boolean; error?: string; data?: T };

/**
 * 有 Access service token 就带它（Access 在边缘核对，放行后 Worker 验 JWT）；
 * 过渡期没配时退回旧的共用 Bearer。
 */
function authHeaders(): Record<string, string> {
  const { accessClientId, accessClientSecret, secret } = config.site;
  if (accessClientId && accessClientSecret) {
    return { "CF-Access-Client-Id": accessClientId, "CF-Access-Client-Secret": accessClientSecret };
  }
  return secret ? { Authorization: `Bearer ${secret}` } : {};
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
  const at = Date.now();
  const response = await fetch(config.site.ingestUrl, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    // 每一封带上自己的推送账本：镜像提交 + 过去 12 小时推成功几封（含这一封）与往返中位数。
    // 限额那轮和 Cursor 小信封都算这个上报器的一次推送
    body: JSON.stringify({ ...payload, reporter: await ledger.block(at) }),
    signal: AbortSignal.timeout(config.pushTimeoutMs),
  });
  await readEnvelope(response);
  // 站点收下了才记账；往返从发出请求算到读完回执
  await ledger.succeeded(at, Date.now() - at);
}
