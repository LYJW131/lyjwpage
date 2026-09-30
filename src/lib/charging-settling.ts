import { withStorage } from "@/lib/storage";
import { type ChargingDevice, SETTLING_MS, settlingKey } from "@shared/charging-settling";

export function askSettlingAt(device: ChargingDevice): Promise<number> {
  return withStorage(async (storage) => {
    const raw = await storage.get(settlingKey(device));
    return raw ? Number(raw) || 0 : 0;
  }, 0);
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
