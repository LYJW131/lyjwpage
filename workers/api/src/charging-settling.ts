import { getStorage } from "@shared/storage";
import { type ChargingDevice, SETTLING_MS, settlingKey } from "@shared/charging-settling";

export async function askSettlingAt(device: ChargingDevice): Promise<number> {
  const raw = await getStorage().get(settlingKey(device));
  return raw ? Number(raw) || 0 : 0;
}

export function settlingDecision(
  structuralChanged: boolean,
  receivedAt: number,
  since: number,
): { publish: boolean; restart: boolean } {
  if (structuralChanged) return { publish: true, restart: true };
  return {
    publish: Boolean(since) && receivedAt - since <= SETTLING_MS,
    restart: false,
  };
}
export { type ChargingDevice } from "@shared/charging-settling";
