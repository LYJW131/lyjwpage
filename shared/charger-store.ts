import { key } from "@shared/storage";
import type { ChargerSample, ReportedChargerStatus } from "@/lib/types";

export const DISCONNECTED_HISTORY_AFTER_MS = 30 * 60 * 1000;

export const K_LATEST = key("charger", "latest");

export const K_HISTORY = key("charger", "history");

export const K_LAST_PUSH = key("charger", "lastPush");

export type Stored = {
  status: ReportedChargerStatus;
  receivedAt: number;
  disconnectedAt?: number | null;
};

export type ChargerState = {
  previous: Stored | null;
  history: ChargerSample[];
};

export function disconnectedHistoryExpired(stored: Stored, now: number) {
  if (stored.status.connected) return false;
  const disconnectedAt = stored.disconnectedAt ?? stored.receivedAt;
  return now - disconnectedAt >= DISCONNECTED_HISTORY_AFTER_MS;
}

export type ChargerLanding = {
  structuralChanged: boolean;
  historyCount: number;
  commit: () => Promise<void>;
};
