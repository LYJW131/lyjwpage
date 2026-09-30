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
  agents?: AgentRow[];
  codingUsage?: CodingUsageReport;
  codingActivity?: CodingActivityReport;
  codingTokenBuckets?: CodingTokenBucketReport;
};

type SiteEnvelope<T> = { ok?: boolean; error?: string; data?: T };

function authHeaders(): Record<string, string> {
  return { "CF-Access-Client-Id": config.site.accessClientId, "CF-Access-Client-Secret": config.site.accessClientSecret };
}

async function readEnvelope<T>(response: Response): Promise<T | undefined> {
  const body = (await response.json().catch(() => null)) as SiteEnvelope<T> | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
  }
  return body.data;
}

// coding 子模块被拒时整封仍可能返回 202，必须读取 data.rejected 才能发现丢失。
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
    body: JSON.stringify({ ...payload, reporter: await ledger.block(at) }),
    signal: AbortSignal.timeout(config.pushTimeoutMs),
  });
  const receipt = await readEnvelope(response);
  await ledger.succeeded(at, Date.now() - at);
  const rejected = rejectedNote(receipt);
  if (rejected) failure("site-rejected", new Error(`站点拒收了这封里的数据：${rejected}`));
  else recovered("site-rejected");
}
