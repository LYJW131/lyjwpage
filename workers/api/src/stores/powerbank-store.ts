import { tellStorage } from "@/lib/storage";
import type { ReportedPowerBankStatus } from "@/lib/types";
import { fallback, K_LAST_PUSH, K_LATEST, type Stored } from "@shared/powerbank-store";


const TTL_MS = 24 * 60 * 60 * 1000;

function structuralKey(status: ReportedPowerBankStatus) {
  return JSON.stringify([
    status.connected,
    status.charging,
    status.thermalLimited,
    status.battery == null ? null : Math.round(status.battery),
    status.device.serialNumber,
    status.device.firmwareVersion,
    status.ports.map((port) => [port.id, port.active, port.direction, port.attached]),
  ]);
}

export function prepareStatus(
  status: ReportedPowerBankStatus,
  receivedAt: number,
  previous: Stored | null,
): { structuralChanged: boolean; commit: () => Promise<void> } {
  const structuralChanged =
    !previous || structuralKey(previous.status) !== structuralKey(status);

  return {
    structuralChanged,
    commit: async () => {
      fallback.persisted = await tellStorage(async (storage) => {
        const pipe = storage.batch();
        pipe.set(K_LATEST, JSON.stringify({ status, receivedAt }), { ttlMs: TTL_MS });
        pipe.set(K_LAST_PUSH, String(receivedAt), { ttlMs: TTL_MS });
        return pipe.execute();
      });
      fallback.latest = status;
      fallback.receivedAt = receivedAt;
      fallback.lastPushAt = receivedAt;
    },
  };
}
