import { object } from './json';

export { CODING_OBSERVATION_HOLD_MS, cloudAgentActivity, CODING_AGENT_MAC, CODING_AGENT_CLOUD, CODING_AGENT_CURSOR, codingBand } from './pulse-coding-features';
export type { CodingBandValue, CodingBandSegment } from './pulse-coding-features';

export type CodingObservation = {
  t: number;
  available: boolean;
  desktop: { application: string; coding: boolean } | null;
  agents: { id: string; model: string | null; active: boolean }[] | null;
};

function observationObject(value: unknown): Record<string, unknown> {
  const row = object(value);
  if (!row) throw new Error("Invalid coding observation object");
  return row;
}
function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Invalid coding observation number");
  return value;
}
export function parseCodingObservation(raw: string): CodingObservation | null {
  try {
    const row = observationObject(JSON.parse(raw));
    const t = finite(row.t, 0, Number.MAX_SAFE_INTEGER);
    if (typeof row.available !== "boolean") return null;
    let desktop: CodingObservation["desktop"] = null;
    if (row.desktop != null) { const d = observationObject(row.desktop); if (typeof d.application !== "string" || typeof d.coding !== "boolean") return null; desktop = { application: d.application.slice(0, 80), coding: d.coding }; }
    let agents: CodingObservation["agents"] = null;
    if (row.agents != null) {
      if (!Array.isArray(row.agents)) return null;
      agents = row.agents.slice(0, 16).map((value) => { const a = observationObject(value); if (typeof a.id !== "string" || typeof a.active !== "boolean" || (a.model !== null && typeof a.model !== "string")) throw new Error("Invalid coding agent"); return { id: a.id.slice(0, 40), model: typeof a.model === "string" ? a.model.slice(0, 80) : null, active: a.active }; });
    }
    return { t, available: row.available, desktop, agents };
  } catch { return null; }
}
