export const READING_FAILED = "Couldn't load this right now.";
export const READING_AWAITING = "Nothing reported yet";
export const READING_LOADING = "Loading…";
export const READING_UNAVAILABLE = "Unavailable";

export type AbsenceKind = "loading" | "awaiting" | "failed" | "unavailable" | "known";

export function absenceKind(input: {
  loading?: boolean;
  awaiting?: boolean;
  error?: string | undefined;
  unavailable?: boolean;
}): AbsenceKind {
  if (input.loading && !input.error && !input.awaiting) return "loading";
  if (input.awaiting) return "awaiting";
  if (input.error) return "failed";
  if (input.unavailable) return "unavailable";
  return "known";
}

export function absenceCopy(kind: Exclude<AbsenceKind, "known">): string {
  switch (kind) {
    case "loading":
      return READING_LOADING;
    case "awaiting":
      return READING_AWAITING;
    case "failed":
      return READING_FAILED;
    case "unavailable":
      return READING_UNAVAILABLE;
  }
}

export function gapCopy(
  input: {
    loading?: boolean;
    awaiting?: boolean;
    error?: string | undefined;
    unavailable?: boolean;
  },
  empty = READING_LOADING,
): string {
  const kind = absenceKind(input);
  return kind === "known" ? empty : absenceCopy(kind);
}

export function combinedAbsence(
  parts: readonly { loading?: boolean; awaiting?: boolean; error?: string; hasData?: boolean }[],
): "failed" | "awaiting" | null {
  if (parts.some((part) => part.hasData)) return null;
  if (parts.some((part) => part.error && !part.awaiting)) return "failed";
  if (parts.some((part) => part.awaiting)) return "awaiting";
  if (parts.some((part) => part.loading)) return null;
  return "failed";
}

export function chargingReadingLost(
  raw: { connected: boolean } | undefined,
  live: { connected: boolean } | undefined,
): boolean {
  return Boolean(raw?.connected && live && !live.connected);
}

export function questSurface(
  now: { available: boolean; observedAt: number; playing: unknown } | undefined,
  failed: boolean,
): "playing" | "unavailable" | "failed" | "hidden" {
  if (now?.playing) return "playing";
  if (failed) return "failed";
  if (now && !now.available && now.observedAt > 0) return "unavailable";
  return "hidden";
}
