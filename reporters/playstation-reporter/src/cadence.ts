/**
 * 主机醒着（发现包 `HTTP/1.1 200`）时的完整 tick 间隔。
 *
 * 醒着时在玩什么会变，按这一档打 PSN。留 5 秒是为了和一分钟量级对齐，
 * 不把间隔卡在整数分钟上。
 */
export const AWAKE_TICK_INTERVAL_MS = 55_000;

/**
 * 休息模式或探测不到时的完整 tick 间隔。
 *
 * 站点 `src/lib/freshness.ts` 的 `PLAYSTATION_STALE_MS`（三轮加余量）锚的就是这个数。
 * 要动它，先去改那边。
 */
export const IDLE_TICK_INTERVAL_MS = 29.5 * 60_000;

/**
 * 发现包多久发一次。只决定多久能看见开关机，不决定打 PSN 的频率。
 */
export const PROBE_INTERVAL_MS = 15_000;

/**
 * 连续这么多次没人应答，才把「醒着」降成关机。
 * 一次丢包不该把正在玩的主机打进三十分钟那一档。
 */
export const OFF_STREAK_TO_REST = 3;

/** 发现包给出的三种主机状态。`off` 是超时或认不出的回复。 */
export type ConsolePower = "awake" | "standby" | "off";

/** 调频只用两档：醒着，或者没醒（休息和关机同一档）。 */
export type PowerClass = "awake" | "resting";

export function powerClass(power: ConsolePower): PowerClass {
  return power === "awake" ? "awake" : "resting";
}

/**
 * 把一次发现结果并进当前判断。
 *
 * `200` 立刻当醒着，`620` 立刻当休息。超时只在连续 `OFF_STREAK_TO_REST` 次之后
 * 才从醒着掉到关机；本来就没醒时，一次超时就是关机。
 */
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

/**
 * 这一探要不要打一轮 PSN。
 *
 * 从没跑过（`sinceMs` 无限）必跑。醒着和没醒对调时立刻跑，好接上或撤掉「正在游玩」。
 * 其余时间醒着按 `AWAKE_TICK_INTERVAL_MS`，没醒按 `IDLE_TICK_INTERVAL_MS`。
 * 间隔算的是上一轮**开始**的时刻。
 */
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
