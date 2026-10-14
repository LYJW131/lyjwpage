import { getStorage } from "@shared/storage";
import { type ChargingDevice, SETTLING_MS, settlingKey } from "@shared/charging-settling";

export function writeSettlingAt(device: ChargingDevice, receivedAt: number): Promise<unknown> {
  return getStorage().set(settlingKey(device), String(receivedAt), { ttlMs: SETTLING_MS });
}
