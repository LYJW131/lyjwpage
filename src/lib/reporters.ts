import type { ReportersPayload } from "@/lib/reporter-ledger";
import { ledgerMirror, REPORTER_NAMES } from "@shared/reporters";

/** 两个常驻上报器最新报来的账本（12 小时推送次数、镜像提交）；还没收到过的是 null */
export async function getReportersStatus(): Promise<ReportersPayload> {
  const entries = await Promise.all(REPORTER_NAMES.map(async (name) => [name, await ledgerMirror(name).get()] as const));
  return { reporters: Object.fromEntries(entries) as ReportersPayload["reporters"] };
}
