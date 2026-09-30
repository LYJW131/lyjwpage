import { AwaitingReport } from "@/lib/awaiting-report";
import { CHARGER_STALE_MS, heartbeatWindowMs } from "@/lib/freshness";
import { getStored, lastPushReceivedAt } from "@/lib/powerbank-store";
import { readLiveness, withPresence, type Liveness } from "@/lib/reporter-liveness";
import type { PowerBankPayload, PowerBankStatus } from "@/lib/types";


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
  status: PowerBankStatus;
  receivedAt: number;
  liveness: Liveness;
}): PowerBankPayload {
  return withPresence(
    { ...status, pushedAt: receivedAt, staleAfterMs: powerBankStaleAfterMs() },
    liveness,
  );
}

export async function getPowerBankSnapshot(): Promise<PowerBankPayload> {
  const stored = await getStored();
  if (!stored) throw new AwaitingReport("尚未收到充电宝遥测推送");

  const [pushedAt, live] = await Promise.all([lastPushReceivedAt(), readLiveness()]);

  return withPresence({ ...stored.status, pushedAt, staleAfterMs: powerBankStaleAfterMs() }, live);
}
