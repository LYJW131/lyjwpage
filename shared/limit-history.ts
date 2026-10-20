// 每个点是一次读数：at 毫秒、usedPercent 0–100、resetsAt Unix 秒（同 VibeCodingLimit）。
// 最近 LIMIT_HISTORY_HOURLY_DAYS 天每小时一点（该小时最后一次读数），更早的每个站点日一点（当天最后一次读数）。
export type LimitHistoryPoint = [at: number, usedPercent: number, resetsAt: number | null];

export type LimitHistorySeries = {
  agent: string;
  key: string;
  windowMinutes: number | null;
  points: LimitHistoryPoint[];
};

export type LimitHistoryPayload = {
  days: number;
  hourlyDays: number;
  series: LimitHistorySeries[];
};

export const LIMIT_HISTORY_DAYS = 21;
export const LIMIT_HISTORY_HOURLY_DAYS = 8;

// 只出页面要预测的窗口；全部窗口按小时出会让首屏载荷涨一个数量级。
export const LIMIT_HISTORY_SERIES: ReadonlyArray<{ agent: string; key: string }> = [
  { agent: "claude", key: "weekly_all" },
];

export type LimitHistoryRow = {
  agent: string;
  limit_key: string;
  window_minutes: number | null;
  used_percent: number;
  resets_at: number | null;
  received_at: number;
};

export function limitHistoryFromRows(daily: LimitHistoryRow[], hourly: LimitHistoryRow[]): LimitHistoryPayload {
  const byKey = new Map<string, LimitHistorySeries>();
  const hourlyFrom = new Map<string, number>();
  const id = (row: LimitHistoryRow) => `${row.agent}\u0000${row.limit_key}`;
  for (const row of hourly) hourlyFrom.set(id(row), Math.min(hourlyFrom.get(id(row)) ?? Infinity, row.received_at));
  const rows = [
    ...daily.filter((row) => row.received_at < (hourlyFrom.get(id(row)) ?? Infinity)),
    ...hourly,
  ].sort((left, right) => left.received_at - right.received_at);
  for (const row of rows) {
    let series = byKey.get(id(row));
    if (!series) {
      series = { agent: row.agent, key: row.limit_key, windowMinutes: row.window_minutes, points: [] };
      byKey.set(id(row), series);
    }
    series.windowMinutes = row.window_minutes;
    series.points.push([row.received_at, row.used_percent, row.resets_at]);
  }
  return { days: LIMIT_HISTORY_DAYS, hourlyDays: LIMIT_HISTORY_HOURLY_DAYS, series: [...byKey.values()] };
}
