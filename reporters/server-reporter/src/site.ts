import { config } from "./config.js";
import { failure } from "./log.js";
import { createPushLedger, type ReporterBlock } from "./push-ledger.js";

const ledger = createPushLedger(config.pushLedgerPath, config.reporterCommit, (error) => failure("push-ledger", error));

/** 这一封要带的 `reporter` 块（DRY_RUN 打印用；推送时 push 自己带） */
export function reporterBlock(): Promise<ReporterBlock> {
  return ledger.block();
}

type SiteEnvelope = { ok?: boolean; error?: string };

/**
 * 「站点回了 `ok !== true` 就算失败」这条约定是**协议**的一部分：站点的 ingestRoute
 * 会用 200 之外的状态码和一个 `ok: false` 的信封表示软失败，认错了就会把它当成
 * 上报成功。和 agents-reporter 的 site.ts 同一条，抄的时候一起抄走。
 */
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
    // 每一封带上自己的推送账本：镜像提交 + 过去 12 小时推成功几封（含这一封）与往返中位数
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
