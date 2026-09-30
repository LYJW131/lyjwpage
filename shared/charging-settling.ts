import { key } from "@/lib/storage";


// 必须覆盖上报器完整追发窗口及往返余量，否则最后的稳定读数会错过推送。
export const SETTLING_MS = 35_000;

export function settlingKey(device: string) {
  return key(device, "structuralAt");
}

export type ChargingDevice = "charger" | "powerbank";
