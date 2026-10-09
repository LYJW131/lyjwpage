import { AwaitingReport } from "@/lib/awaiting-report";
import { CHARGER_STALE_MS, heartbeatWindowMs } from "@/lib/freshness";
import { getStored, lastPushReceivedAt } from "@/lib/powerbank-store";
import { readLiveness, withPresence, type Liveness } from "@/lib/reporter-liveness";
import type { PowerBankPayload, ReportedPowerBankStatus } from "@/lib/types";
import { publicPowerBankStatus } from "@shared/charging-devices";


// 安静时靠空心跳续期，断流窗口不得短于心跳窗口。
export function powerBankStaleAfterMs() {
  const interval = Number(process.env.CHARGER_PUSH_INTERVAL_MS) || 30_000;
  return Math.max(CHARGER_STALE_MS, interval * 3, heartbeatWindowMs());
}

export function powerBankPushPayload({
  status,
  receivedAt,
  liveness,
}: {
  status: ReportedPowerBankStatus;
  receivedAt: number;
  liveness: Liveness;
}): PowerBankPayload {
  return withPresence(
    { ...publicPowerBankStatus(status), pushedAt: receivedAt, staleAfterMs: powerBankStaleAfterMs() },
    liveness,
  );
}

export async function getPowerBankSnapshot(): Promise<PowerBankPayload> {
  const [stored, pushedAt, live] = await Promise.all([getStored(), lastPushReceivedAt(), readLiveness()]);
  if (!stored) throw new AwaitingReport("尚未收到充电宝遥测推送");

  return withPresence({ ...publicPowerBankStatus(stored.status), pushedAt, staleAfterMs: powerBankStaleAfterMs() }, live);
}
