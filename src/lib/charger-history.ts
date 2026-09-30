import { CHARGER_HISTORY_LIMIT } from "@/lib/limits";
import type { ChargerPayload, ChargerSample } from "@/lib/types";


let history: ChargerSample[] = [];

export function historyCursor(): number | null {
  return history.length ? history[history.length - 1].t : null;
}

export function seedChargerHistory(payload: ChargerPayload): void {
  if (history.length || payload.historyPartial) return;
  history = payload.history.slice(-CHARGER_HISTORY_LIMIT);
}

export function mergeChargerHistory(payload: ChargerPayload): ChargerPayload {
  const merged = payload.historyPartial ? [...history, ...payload.history] : payload.history;
  history = merged.slice(-CHARGER_HISTORY_LIMIT);
  return { ...payload, history };
}
