// 每个点是那个站点日（Asia/Shanghai）最后一次读数：at 毫秒、usedPercent 0–100、resetsAt Unix 秒（同 VibeCodingLimit）。
export type LimitHistoryPoint = [at: number, usedPercent: number, resetsAt: number | null];

export type LimitHistorySeries = {
  agent: string;
  key: string;
  windowMinutes: number | null;
  points: LimitHistoryPoint[];
};

export type LimitHistoryPayload = {
  days: number;
  series: LimitHistorySeries[];
};

export const LIMIT_HISTORY_DAYS = 21;

export type LimitSnapshotRow = {
  agent: string;
  limit_key: string;
  window_minutes: number | null;
  used_percent: number;
  resets_at: number | null;
  received_at: number;
};

export function limitHistoryFromRows(rows: LimitSnapshotRow[], days = LIMIT_HISTORY_DAYS): LimitHistoryPayload {
  const byKey = new Map<string, LimitHistorySeries>();
  for (const row of [...rows].sort((left, right) => left.received_at - right.received_at)) {
    const id = `${row.agent}\u0000${row.limit_key}`;
    let series = byKey.get(id);
    if (!series) {
      series = { agent: row.agent, key: row.limit_key, windowMinutes: row.window_minutes, points: [] };
      byKey.set(id, series);
    }
    series.windowMinutes = row.window_minutes;
    series.points.push([row.received_at, row.used_percent, row.resets_at]);
  }
  return { days, series: [...byKey.values()] };
}
