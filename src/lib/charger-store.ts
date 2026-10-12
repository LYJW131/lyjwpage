import { getStorage } from "@shared/storage";
import type { ChargerSample } from "@/lib/types";
import { type ChargerState, disconnectedHistoryExpired, K_HISTORY, K_LAST_PUSH, K_LATEST, type Stored } from "@shared/charger-store";

async function readLatest(): Promise<Stored | null> {
  const raw = await getStorage().get(K_LATEST);
  if (!raw) return null;
  let stored: Stored;
  try {
    stored = JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
  const disconnectedAt = stored.status.connected
    ? 0
    : stored.disconnectedAt ?? stored.receivedAt;
  return { ...stored, disconnectedAt: disconnectedAt || null };
}

async function readHistory(): Promise<ChargerSample[]> {
  const rows = await getStorage().listRange(K_HISTORY, 0, -1);
  const parsed: ChargerSample[] = [];
  for (const item of rows) {
    try {
      parsed.push(JSON.parse(item) as ChargerSample);
    } catch {
    }
  }
  return parsed;
}

export async function readChargerState(): Promise<ChargerState> {
  const [previous, history] = await Promise.all([readLatest(), readHistory()]);
  return { previous, history };
}

export async function getStored() {
  const [latest, read] = await Promise.all([readLatest(), readHistory()]);
  if (!latest) return null;
  let history = read;
  if (disconnectedHistoryExpired(latest, Date.now()) && history.length) {
    history = [];
  }
  return {
    status: latest.status,
    receivedAt: latest.receivedAt,
    history,
  };
}

export async function lastPushReceivedAt() {
  const raw = await getStorage().get(K_LAST_PUSH);
  return (raw ? Number(raw) : 0) || 0;
}
export { type ChargerLanding, type ChargerState } from "@shared/charger-store";
