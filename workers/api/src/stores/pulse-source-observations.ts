import { cursorObservationsKey } from '@/lib/coding-pulse';
import { PULSE_TTL_MS } from '@/lib/limits';
import { getStorage } from '@shared/storage';
import type { CursorObservation } from '@shared/pulse-cursor';

async function appendObservation(key: string, observation: { t: number }) {
  const storage = getStorage();
  const rows = await storage.listRange(key, -1, -1);
  if (rows.length && JSON.parse(rows[0]).t >= observation.t) return;
  await storage.batch().append(key, JSON.stringify(observation)).trim(key, -10_000, -1)
    .expire(key, PULSE_TTL_MS).execute();
}
export function recordCursorObservation(observation: CursorObservation) {
  return appendObservation(cursorObservationsKey(), observation);
}
