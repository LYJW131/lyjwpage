import { codingObservationsKey } from "@/lib/coding-pulse";
import { PULSE_TTL_MS } from "@/lib/limits";
import { askStorage, tellStorage } from "@/lib/storage";
import { parseCodingObservation, type CodingObservation } from "@shared/pulse-coding";

export async function recordCodingObservation(next: CodingObservation): Promise<void> {
  try {
    const k = codingObservationsKey();
    const answer = await askStorage((storage) => storage.listRange(k, -1, -1));
    if (!answer.reachable) return;
    const last = answer.value[0] ? parseCodingObservation(answer.value[0]) : null;
    if (last && (next.t <= last.t || (next.t - last.t < 60_000 &&
        JSON.stringify({ ...last, t: 0 }) === JSON.stringify({ ...next, t: 0 })))) return;
    await tellStorage((storage) => storage.batch().append(k, JSON.stringify(next)).trim(k, -10_000, -1).expire(k, PULSE_TTL_MS).execute());
  } catch (error) { console.error("[pulse-coding-observation]", error instanceof Error ? error.message : String(error)); }
}
