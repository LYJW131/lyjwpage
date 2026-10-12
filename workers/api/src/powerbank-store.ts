import { getStorage } from "@shared/storage";
import { K_LAST_PUSH, K_LATEST, type Stored } from "@shared/powerbank-store";

async function readLatest(): Promise<Stored | null> {
  const raw = await getStorage().get(K_LATEST);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
}

export function readPowerBankState(): Promise<Stored | null> {
  return readLatest();
}

export async function getStored() {
  const latest = await readLatest();
  return latest ? { status: latest.status, receivedAt: latest.receivedAt } : null;
}

export async function lastPushReceivedAt() {
  const raw = await getStorage().get(K_LAST_PUSH);
  return (raw ? Number(raw) : 0) || 0;
}
