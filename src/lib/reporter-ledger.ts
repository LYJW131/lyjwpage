
export const REPORTER_BY_SOURCE = {
  server: "server-reporter",
  agents: "agents-reporter",
} as const;

export type ReporterName = (typeof REPORTER_BY_SOURCE)[keyof typeof REPORTER_BY_SOURCE];

export type ReporterBlock = {
  commit: string | null;
  pushes: number;
  rttMs: number | null;
  start: number;
  end: number;
};

export type ReporterStat = ReporterBlock & { lastPushAt: number };

export type ReportersPayload = {
  reporters: Record<ReporterName, ReporterStat | null>;
};

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function reporterBlockOf(raw: unknown): ReporterBlock | null {
  const block = raw && typeof raw === "object" ? (raw as Record<string, unknown>).reporter : null;
  if (!block || typeof block !== "object") return null;
  const { commit, pushes, rttMs, start, end } = block as Record<string, unknown>;
  if (commit !== null && !(typeof commit === "string" && /^[0-9a-f]{7,40}$/.test(commit))) return null;
  if (rttMs !== null && !nonNegativeInteger(rttMs)) return null;
  if (!nonNegativeInteger(pushes) || !nonNegativeInteger(start) || !nonNegativeInteger(end) || end < start) return null;
  return { commit, pushes, rttMs, start, end };
}
