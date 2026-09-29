import { config } from "./config.js";
import { failure } from "./log.js";
import { createPushLedger, type ReporterBlock } from "./push-ledger.js";

const ledger = createPushLedger(config.pushLedgerPath, config.reporterCommit, (error) => failure("push-ledger", error));

/** 这一封要带的 `reporter` 块（DRY_RUN 打印用；推送时 push 自己带） */
export function reporterBlock(): Promise<ReporterBlock> {
  return ledger.block();
}

type SiteEnvelope = { ok?: boolean; error?: string };

/** 这个来源专用的 Access service token：Access 在边缘核对，放行后 Worker 验 JWT */
function authHeaders(): Record<string, string> {
  return { "CF-Access-Client-Id": config.site.accessClientId, "CF-Access-Client-Secret": config.site.accessClientSecret };
}

/**
 * 成功 = HTTP 2xx 且信封 `ok === true`，两个条件都要判。上报入口成功回 202
 * `{ ok: true, data }`，失败回 4xx / 5xx `{ ok: false, error }`
 * （workers/ingress/src/worker.ts 的 handleIngest）。
 */
export async function push(payload: Record<string, unknown>): Promise<void> {
  const at = Date.now();
  const response = await fetch(config.site.ingestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "lyjwpage-server-reporter/2.0",
      ...authHeaders(),
    },
    // 每一封带上自己的推送账本：镜像提交 + 窗口内推成功几封（含这一封）与往返中位数
    body: JSON.stringify({ ...payload, reporter: await ledger.block(at) }),
    signal: AbortSignal.timeout(config.pushTimeoutMs),
  });
  const body = (await response.json().catch(() => null)) as SiteEnvelope | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
  }
  // 站点收下了才记账；往返从发出请求算到读完回执
  await ledger.succeeded(at, Date.now() - at);
}
