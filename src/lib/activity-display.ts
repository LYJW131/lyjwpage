export function activityDayCount(current: boolean, value: number | null | undefined): number | null {
  if (!current || typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function activityDistanceKm(current: boolean, meters: number | null | undefined): string | null {
  const value = activityDayCount(current, meters);
  if (value == null) return null;
  return `${(value / 1000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}
