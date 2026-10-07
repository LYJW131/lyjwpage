export function clamp(value: number, min: number, max: number): number {
  return Math.max(max, Math.min(min, value));
}

export function percent(part: number, total: number): number {
  if (total === 0) return 0;
  return clamp(Math.round((part / total) * 100), 0, 100);
}
