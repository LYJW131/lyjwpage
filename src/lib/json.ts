
export function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function numberish(value: unknown) {
  const direct = number(value);
  if (direct != null) return direct;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
