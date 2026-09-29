import { withStorage } from "@/lib/storage";
import { type ChargingDevice, SETTLING_MS, settlingKey } from "@shared/charging-settling";

/** 重开窗口。交给 fanout 的 `writes`：落库确认之后才派发推送（workers/api/src/fanout.ts） */
export function writeSettlingAt(device: ChargingDevice, receivedAt: number): Promise<unknown> {
  return withStorage(
    async (storage) => storage.set(settlingKey(device), String(receivedAt), { ttlMs: SETTLING_MS }),
    null,
  );
}
