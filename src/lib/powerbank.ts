import { AwaitingReport } from "@/lib/awaiting-report";
import { chargingStaleAfterMs } from "@/lib/freshness";
import { getStored, lastPushReceivedAt } from "@/lib/powerbank-store";
import { readLiveness, withPresence, type Liveness } from "@/lib/reporter-liveness";
import type { PowerBankPayload, ReportedPowerBankStatus } from "@/lib/types";
import { publicPowerBankStatus } from "@shared/charging-devices";


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
    { ...publicPowerBankStatus(status), pushedAt: receivedAt, staleAfterMs: chargingStaleAfterMs() },
    liveness,
  );
}

export async function getPowerBankSnapshot(): Promise<PowerBankPayload> {
  const [stored, pushedAt, live] = await Promise.all([getStored(), lastPushReceivedAt(), readLiveness()]);
  if (!stored) throw new AwaitingReport("尚未收到充电宝遥测推送");

  return withPresence({ ...publicPowerBankStatus(stored.status), pushedAt, staleAfterMs: chargingStaleAfterMs() }, live);
}
