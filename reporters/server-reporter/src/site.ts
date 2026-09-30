import { config } from "./config.js";
import { failure } from "./log.js";
import { createPushLedger, type ReporterBlock } from "./push-ledger.js";

const ledger = createPushLedger(config.pushLedgerPath, config.reporterCommit, (error) => failure("push-ledger", error));

export function reporterBlock(): Promise<ReporterBlock> {
  return ledger.block();
}

type SiteEnvelope = { ok?: boolean; error?: string };

function authHeaders(): Record<string, string> {
  return { "CF-Access-Client-Id": config.site.accessClientId, "CF-Access-Client-Secret": config.site.accessClientSecret };
}

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
    body: JSON.stringify({ ...payload, reporter: await ledger.block(at) }),
    signal: AbortSignal.timeout(config.pushTimeoutMs),
  });
  const body = (await response.json().catch(() => null)) as SiteEnvelope | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
  }
  await ledger.succeeded(at, Date.now() - at);
}
