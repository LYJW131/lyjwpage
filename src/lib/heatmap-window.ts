// 当天数值仍会增加，日历增量游标必须包含当天，而非采用曲线的开区间。

import { addDays } from "./github-chart-compact.ts";

export const HEATMAP_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isHeatmapDate(value: string): boolean {
  return HEATMAP_DATE.test(value);
}

export function diffDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function lastHeatmapDate(origin: string, length: number): string | null {
  if (!origin || length <= 0) return null;
  return addDays(origin, length - 1);
}

export function utcToday(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

// 日合计与切窗必须用同一时区，否则当地午夜后的数据会被误切成未来。
export function zonedDay(now: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

export function nextZonedDayStart(now: number, timezone: string): number {
  const today = zonedDay(now, timezone);
  let hi = now + 3_600_000;
  while (zonedDay(hi, timezone) === today) hi += 3_600_000;
  let lo = hi - 3_600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (zonedDay(mid, timezone) === today) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function isHeatmapFuture(date: string, today = utcToday()): boolean {
  return date > today;
}

export function heatmapRefreshFrom(
  origin: string,
  length: number,
  today = utcToday(),
): string | null {
  const last = lastHeatmapDate(origin, length);
  if (!last) return null;
  if (today < origin) return origin;
  return today < last ? today : last;
}

export type HeatmapSlice = {
  partial: boolean;
  fromIndex: number;
};

export function sliceHeatmapWindow(
  origin: string,
  length: number,
  since?: string,
): HeatmapSlice {
  if (!since || !isHeatmapDate(since) || !origin || length <= 0) {
    return { partial: false, fromIndex: 0 };
  }
  const index = diffDays(origin, since);
  if (index < 0 || index >= length) return { partial: false, fromIndex: 0 };
  return { partial: true, fromIndex: index };
}

export function heatmapSliceFrom(origin: string, fromIndex: number): string {
  return addDays(origin, fromIndex);
}

export function mergeHeatmapSeries(
  local: readonly number[] | undefined,
  localOrigin: string | undefined,
  incoming: {
    origin: string;
    from?: string;
    values: readonly number[];
    partial?: boolean;
  },
): { origin: string; values: number[] } {
  if (!incoming.partial || !local?.length || !localOrigin) {
    return { origin: incoming.origin, values: incoming.values.slice() };
  }

  const shift = diffDays(localOrigin, incoming.origin);
  const aligned =
    shift === 0 ? local.slice() : shift > 0 ? local.slice(shift) : padLeft(local, -shift);
  const from = incoming.from ?? incoming.origin;
  const fromIndex = Math.max(0, diffDays(incoming.origin, from));
  const length = fromIndex + incoming.values.length;
  const merged = Array.from({ length }, (_, index) => aligned[index] ?? 0);
  for (let index = 0; index < incoming.values.length; index += 1) {
    merged[fromIndex + index] = incoming.values[index] ?? 0;
  }
  return { origin: incoming.origin, values: merged };
}

function padLeft(values: readonly number[], count: number): number[] {
  return Array.from({ length: count }, () => 0).concat(values);
}
