export const AWAKE_TICK_INTERVAL_MS = 55_000;

export const IDLE_TICK_INTERVAL_MS = 29.5 * 60_000;

export const PROBE_INTERVAL_MS = 15_000;

export const OFF_STREAK_TO_REST = 3;

export type ConsolePower = "awake" | "standby" | "off";

export type PowerClass = "awake" | "resting";

export function powerClass(power: ConsolePower): PowerClass {
  return power === "awake" ? "awake" : "resting";
}

export function settleProbe(
  previous: ConsolePower,
  reading: ConsolePower,
  offStreak: number,
): { power: ConsolePower; offStreak: number } {
  if (reading === "awake") return { power: "awake", offStreak: 0 };
  if (reading === "standby") return { power: "standby", offStreak: 0 };
  const streak = offStreak + 1;
  if (previous === "awake" && streak < OFF_STREAK_TO_REST) {
    return { power: "awake", offStreak: streak };
  }
  return { power: "off", offStreak: streak };
}

export function shouldRunTick(args: {
  sinceMs: number;
  power: ConsolePower;
  powerAtLastTick: PowerClass | null;
}): boolean {
  if (args.sinceMs >= IDLE_TICK_INTERVAL_MS) return true;
  const now = powerClass(args.power);
  if (args.powerAtLastTick && args.powerAtLastTick !== now) return true;
  if (now === "awake") return args.sinceMs >= AWAKE_TICK_INTERVAL_MS;
  return false;
}
