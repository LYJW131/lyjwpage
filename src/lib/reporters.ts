import { summarizeLedger, type ReportersPayload } from "@/lib/reporter-ledger";
import { ledgerMirror, REPORTER_NAMES } from "@shared/reporters";

/** 两个常驻上报器过去 12 小时收到几封、跑的哪个提交；还没收到过的是 null */
export async function getReportersStatus(now = Date.now()): Promise<ReportersPayload> {
  const entries = await Promise.all(
    REPORTER_NAMES.map(async (name) => [name, summarizeLedger(await ledgerMirror(name).get(), now)] as const),
  );
  return { reporters: Object.fromEntries(entries) as ReportersPayload["reporters"] };
}
