import { mergeCoverage, type Coverage } from './pulse-features';

export const CURSOR_OBSERVATION_HOLD_MS = 65 * 60_000;
export const CURSOR_ACTIVITY_HOLD_MS = 5 * 60_000;
export type CursorObservation = { t: number; available: boolean; lastActivityAt: number | null };

export function parseCursorObservation(raw: string): CursorObservation | null {
  try {
    const row = JSON.parse(raw) as CursorObservation;
    if (!row || !Number.isFinite(row.t) || typeof row.available !== 'boolean' ||
      (row.lastActivityAt !== null && !Number.isFinite(row.lastActivityAt))) return null;
    return { t: row.t, available: row.available, lastActivityAt: row.lastActivityAt };
  } catch { return null; }
}

export function cursorWindowFeatures(rows: CursorObservation[], window: Coverage) {
  const coverage: Coverage[] = [], active: Coverage[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.available) continue;
    const from = Math.max(window.from, row.t);
    const to = Math.min(window.to, row.t + CURSOR_OBSERVATION_HOLD_MS, rows[i + 1]?.t ?? Infinity);
    if (to <= from) continue;
    coverage.push({ from, to });
    if (row.lastActivityAt !== null && row.lastActivityAt <= row.t) {
      const end = Math.min(to, row.lastActivityAt + CURSOR_ACTIVITY_HOLD_MS);
      if (end > from) active.push({ from, to: end });
    }
  }
  const merged = mergeCoverage(coverage), runs = mergeCoverage(active);
  return {
    coverage: merged,
    activeCoverage: runs,
    cursorObservedSeconds: merged.reduce((sum, part) => sum + (part.to - part.from) / 1000, 0),
    cursorActiveSeconds: runs.reduce((sum, part) => sum + (part.to - part.from) / 1000, 0),
    longestCursorRunSeconds: Math.max(0, ...runs.map((part) => (part.to - part.from) / 1000)),
  };
}
