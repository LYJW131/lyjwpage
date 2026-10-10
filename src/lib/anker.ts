import { AwaitingReport } from "@/lib/awaiting-report";
import { getStored, lastPushReceivedAt } from "@/lib/charger-store";
import { chargingStaleAfterMs } from "@/lib/freshness";
import { publicAssetPath } from "@/lib/asset-url";
import { readLiveness, withPresence, type Liveness } from "@/lib/reporter-liveness";
import type { ChargerPayload, ChargerStatus, ReportedChargerStatus } from "@/lib/types";
import { publicChargerStatus } from "@shared/charging-devices";


function withCoverIconUrl<T extends { cover: ChargerStatus["cover"] }>(payload: T): T {
  const cover = payload.cover;
  if (!cover) return payload;
  const iconUrl = cover.iconObjectKey ? publicAssetPath(cover.iconObjectKey) : null;
  if (cover.iconUrl === iconUrl) return payload;
  return { ...payload, cover: { ...cover, iconUrl } };
}

export async function getChargerSnapshot(): Promise<ChargerPayload> {
  const [stored, pushedAt, live] = await Promise.all([getStored(), lastPushReceivedAt(), readLiveness()]);
  if (!stored) throw new AwaitingReport("尚未收到充电头遥测推送");

  return withPresence(
    withCoverIconUrl({
      ...publicChargerStatus(stored.status),
      history: stored.history,
      historyPartial: false,
      pushedAt,
      staleAfterMs: chargingStaleAfterMs(),
    }),
    live,
  );
}

export function sliceChargerHistory(payload: ChargerPayload, since?: number): ChargerPayload {
  const all = payload.history;
  const oldest = all[0]?.t;
  // 游标早于保留区间时必须回全量，否则丢失的中段会被拼成连续曲线。
  const historyPartial = since != null && oldest != null && since >= oldest;
  return {
    ...payload,
    history: historyPartial ? all.filter((sample) => sample.t > since) : all,
    historyPartial,
  };
}

export function chargerPushPayload({
  status,
  receivedAt,
  historyCount,
  liveness,
}: {
  status: ReportedChargerStatus;
  receivedAt: number;
  historyCount: number;
  liveness: Liveness;
}): ChargerPayload {
  return withPresence(
    withCoverIconUrl({
      ...publicChargerStatus(status),
      history: [],
      historyPartial: historyCount > 0,
      pushedAt: receivedAt,
      staleAfterMs: chargingStaleAfterMs(),
    }),
    liveness,
  );
}
