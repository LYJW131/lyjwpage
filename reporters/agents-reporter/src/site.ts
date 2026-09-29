import type { CodingActivityReport, CodingTokenBucketReport, CodingUsageReport } from "./coding-usage.js";
import { config } from "./config.js";
import { failure, recovered } from "./log.js";
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
  /** 限额那一轮必带；Cursor 快循环那条小信封不带，站点就不碰限额镜像 */
  agents?: AgentRow[];
  /** Cursor 的日行账本（整份历史）。没登录 Cursor 就省掉，拉失败时只带 error 状态，站点不动历史 */
  codingUsage?: CodingUsageReport;
  /** Cursor 最近一条用量事件，见 cursor-now.ts */
  codingActivity?: CodingActivityReport;
  /** Cursor 的 5 分钟 token 桶：限额那一轮报滚动一天，快循环报最近一段 */
  codingTokenBuckets?: CodingTokenBucketReport;
};

type SiteEnvelope<T> = { ok?: boolean; error?: string; data?: T };

/** 这个来源专用的 Access service token：Access 在边缘核对，放行后 Worker 验 JWT */
function authHeaders(): Record<string, string> {
  return { "CF-Access-Client-Id": config.site.accessClientId, "CF-Access-Client-Secret": config.site.accessClientSecret };
}

/** HTTP 成功且 body.ok === true 才算成功，避免软失败被记入推送账本。 */
async function readEnvelope<T>(response: Response): Promise<T | undefined> {
  const body = (await response.json().catch(() => null)) as SiteEnvelope<T> | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
  }
  return body.data;
}

/**
 * 回执里被拒的 coding 数据。站点对坏的 coding 数据只丢它自己、整封仍回 202（`data.rejected`），
 * 上报器不看回执就没人知道数据没进去。返回一行说明，没有被拒的为 null。
 */
export function rejectedNote(data: unknown): string | null {
  const rejected = data && typeof data === "object" ? (data as { rejected?: unknown }).rejected : null;
  if (!Array.isArray(rejected) || rejected.length === 0) return null;
  return rejected
    .map((entry) => {
      const row = entry && typeof entry === "object" ? (entry as { module?: unknown; error?: unknown }) : {};
      return `${String(row.module)}：${String(row.error)}`;
    })
    .join("；");
}

export async function push(payload: PushPayload): Promise<void> {
  const at = Date.now();
  const response = await fetch(config.site.ingestUrl, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    // 每一封带上自己的推送账本：镜像提交 + 过去 `push-ledger.ts#WINDOW_MS` 内推成功几封（含这一封）与往返中位数。
    // 限额那轮和 Cursor 小信封都算这个上报器的一次推送
    body: JSON.stringify({ ...payload, reporter: await ledger.block(at) }),
    signal: AbortSignal.timeout(config.pushTimeoutMs),
  });
  const receipt = await readEnvelope(response);
  // 站点收下了才记账；往返从发出请求算到读完回执
  await ledger.succeeded(at, Date.now() - at);
  const rejected = rejectedNote(receipt);
  if (rejected) failure("site-rejected", new Error(`站点拒收了这封里的数据：${rejected}`));
  else recovered("site-rejected");
}
