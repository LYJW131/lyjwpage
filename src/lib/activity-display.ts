export function activityDayCount(current: boolean, value: number | null | undefined): number | null {
  if (!current || typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

// HealthKit 当天没有爬楼样本时上报 null，与没给读权限分不开；同一份上报里步数读得到，说明权限在，爬楼按 0 算。
export function activityFlights(current: boolean, flights: number | null | undefined, steps: number | null | undefined): number | null {
  const value = activityDayCount(current, flights);
  if (value != null) return value;
  return activityDayCount(current, steps) == null ? null : 0;
}

export function activityDistanceKm(current: boolean, meters: number | null | undefined): string | null {
  const value = activityDayCount(current, meters);
  if (value == null) return null;
  return `${(value / 1000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}
