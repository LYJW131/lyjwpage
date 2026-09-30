import { askStorage, withStorage, type StorageAnswer } from "@/lib/storage";
import type { ChargerSample } from "@/lib/types";
import { type ChargerState, disconnectedHistoryExpired, fallback, K_HISTORY, K_LAST_PUSH, K_LATEST, type Stored } from "@shared/charger-store";

function fromMemory(): Stored | null {
  return fallback.latest
    ? {
      status: fallback.latest,
      receivedAt: fallback.receivedAt,
      disconnectedAt: fallback.disconnectedAt || null,
    }
    : null;
}

async function readLatest(): Promise<Stored | null> {
  const answered = await askStorage((storage) => storage.get(K_LATEST));
  if (!answered.reachable) return fromMemory();

  if (answered.value) {
    let stored: Stored;
    try {
      stored = JSON.parse(answered.value) as Stored;
    } catch {
      // 脏数据按「答不上来」算，不按「没有」—— 否则会连累好好的内存副本
      return fromMemory();
    }
    // 写失败过时内存这份更新，别被存储里故障前的旧值盖回去
    if (!fallback.persisted && fallback.latest && fallback.receivedAt > stored.receivedAt) {
      return fromMemory();
    }
    const disconnectedAt = stored.status.connected
      ? 0
      : stored.disconnectedAt ?? stored.receivedAt;
    fallback.latest = stored.status;
    fallback.receivedAt = stored.receivedAt;
    fallback.disconnectedAt = disconnectedAt;
    fallback.persisted = true;
    return { ...stored, disconnectedAt: disconnectedAt || null };
  }

  if (fallback.persisted) {
    fallback.latest = null;
    fallback.receivedAt = 0;
    fallback.disconnectedAt = 0;
    fallback.history.length = 0;
    return null;
  }
  return fromMemory();
}

function acceptHistory(answered: StorageAnswer<string[]>): ChargerSample[] {
  if (!answered.reachable) return [...fallback.history];

  if (answered.value.length) {
    const parsed: ChargerSample[] = [];
    for (const item of answered.value) {
      try {
        parsed.push(JSON.parse(item) as ChargerSample);
      } catch {
      }
    }
    fallback.history = [...parsed];
    return parsed;
  }

  if (fallback.persisted) {
    fallback.history.length = 0;
    return [];
  }
  return [...fallback.history];
}

function askHistory() {
  return askStorage((storage) => storage.listRange(K_HISTORY, 0, -1));
}

async function readHistory(): Promise<ChargerSample[]> {
  return acceptHistory(await askHistory());
}

export async function readChargerState(): Promise<ChargerState> {
  const [previous, history] = await Promise.all([readLatest(), askHistory()]);
  return { previous, history: acceptHistory(history) };
}

export async function getStored() {
  const latest = await readLatest();
  if (!latest) return null;
  let history = await readHistory();
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
  const raw = await withStorage(async (storage) => storage.get(K_LAST_PUSH), null);
  const fromStorage = raw ? Number(raw) : 0;
  return Math.max(fromStorage || 0, fallback.lastPushAt);
}
export { type ChargerLanding, type ChargerState } from "@shared/charger-store";
