export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function percent(part: number, total: number) {
  if (total === 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}
