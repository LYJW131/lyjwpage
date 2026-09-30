import { key } from "@/lib/storage";
import type { ChargerSample, ChargerStatus } from "@/lib/types";

export const DISCONNECTED_HISTORY_AFTER_MS = 30 * 60 * 1000;

export const K_LATEST = key("charger", "latest");

export const K_HISTORY = key("charger", "history");

export const K_LAST_PUSH = key("charger", "lastPush");

// 未持久化的内存值可能是唯一副本，SQLite 的空值不能把它当作已删除。
export const fallback = {
  latest: null as ChargerStatus | null,
  receivedAt: 0,
  disconnectedAt: 0,
  lastPushAt: 0,
  history: [] as ChargerSample[],
  persisted: false,
};

export type Stored = {
  status: ChargerStatus;
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
