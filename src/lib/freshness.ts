import type { NowListeningPayload } from "@/lib/types";

// 降频前先扩大并部署心跳窗口，避免旧页面把仍存活的上报器判离线。
export const HEARTBEAT_WINDOW_MS = 300_000;

export function heartbeatWindowMs() {
  const configured = Number(process.env.HEARTBEAT_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : HEARTBEAT_WINDOW_MS;
}

// 窗口覆盖 agents-reporter 最慢闲档（IDLE_INTERVAL_MS）的三轮及缓存余量；调长 IDLE_INTERVAL_MS 前，先放宽并部署此窗口。
export const AGENT_LIMITS_STALE_MS = 185 * 60_000;

// 判活窗口锚定 playstation-reporter 的 IDLE_TICK_INTERVAL_MS，覆盖多轮闲档，并留出兜底轮询余量（心跳只落库不广播，浏览器要等下一次轮询才看到新 observedAt）；闲档降频前先放宽并部署此窗口。
export const PLAYSTATION_STALE_MS = 95 * 60_000;

// 覆盖 server-reporter 多轮上报及 KV 可见延迟，避免漏报即闪断；调长其 INTERVAL_MS 前先放宽并部署此窗口。
export const SERVER_STALE_MS = 10 * 60_000;

// 下列采集窗口须覆盖对应 collector Job 的多轮 everyMinutes 及 KV 可见延迟；采集降频前先核对并部署窗口，同时调整 STATUS_VIEWS 的 cadenceMs。
export const AGENT_STATUS_STALE_MS = 10 * 60_000;
export const GITHUB_CHART_STALE_MS = 6 * 3_600_000;
// GitHub 统计生成中会返回 202，可能跨越多轮采集，不能按一轮未更新即判故障。
export const GITHUB_REPO_STALE_MS = 3 * 3_600_000;
export const VERCEL_DEPLOYMENTS_STALE_MS = 10 * 60_000;
export const VERCEL_METRICS_STALE_MS = 3_600_000;
export const PAGESPEED_STALE_MS = 3 * 3_600_000;
export const CLOUDFLARE_DEPLOYMENTS_STALE_MS = 15 * 60_000;
export const CLOUDFLARE_METRICS_STALE_MS = 3_600_000;
export const SENTRY_STALE_MS = 30 * 60_000;

// HealthKit 后台投递按小时节流；没有新样本时整夜不更新不等于上报器故障。
export const ACTIVITY_STALE_MS = 12 * 3_600_000;

export function localDate(at: number, secondsFromGMT: number): string {
  return new Date(at + secondsFromGMT * 1000).toISOString().slice(0, 10);
}

export const CHARGER_STALE_MS = 90_000;

// 断流窗口不得短于心跳窗口；安静时只有空心跳续期，否则正常设备会反复闪断。
export function chargingStaleAfterMs(intervalMs = Number(process.env.CHARGER_PUSH_INTERVAL_MS) || 30_000) {
  return Math.max(CHARGER_STALE_MS, intervalMs * 3, heartbeatWindowMs());
}

export type FreshnessInput = {
  now: number;
  at: number | null | undefined;
  windowMs: number;
  declaredOffline?: boolean;
};

// now=0 是水合哨兵，不按时间判过期，避免服务端与首帧结论不一致。
export function isStale({ now, at, windowMs, declaredOffline = false }: FreshnessInput) {
  if (declaredOffline) return true;
  if (!now) return false;
  if (at == null) return false;
  if (at <= 0) return true;
  return now - at > windowMs;
}

export function clockReading(ticked: number, mountedAt: number, servedAt: number | undefined): number {
  return Math.max(ticked, mountedAt, servedAt ?? 0);
}

export type ClockAdvance =
  | { kind: "idle" }
  | { kind: "now"; to: number }
  | { kind: "later"; delayMs: number; to: number };

export function hasPendingDeadline(clock: number, deadlines: readonly (number | null)[]): boolean {
  return deadlines.some((at) => at != null && at > clock);
}

// 晚于逻辑钟但早于真实时刻的 deadline 也必须处理，不能只安排未来定时器。
export function clockAdvance(
  clock: number,
  deadlines: readonly (number | null)[],
  realNow: number,
): ClockAdvance {
  const pending = deadlines.filter((at): at is number => at != null && at > clock);
  if (!pending.length) return { kind: "idle" };
  const to = Math.min(...pending);
  if (to <= realNow) return { kind: "now", to };
  return { kind: "later", delayMs: to - realNow + 250, to };
}

// 切回前台后 SWR 回源晚一拍；回源前的旧快照不能立即触发离线闪烁。
export type ResumeState = {
  active: boolean;
  resuming: boolean;
  sawValidating: boolean;
};

export function resumeStep(
  state: ResumeState,
  { active, validating }: { active: boolean; validating: boolean },
): ResumeState {
  if (!active) {
    return state.active || state.resuming || state.sawValidating
      ? { active: false, resuming: false, sawValidating: false }
      : state;
  }
  if (!state.active) return { active: true, resuming: true, sawValidating: validating };
  if (!state.resuming) return state;
  if (validating) return state.sawValidating ? state : { ...state, sawValidating: true };
  return state.sawValidating ? { active: true, resuming: false, sawValidating: false } : state;
}

// SWR 对前台回源节流，重复切换可能不发请求，等待必须有上限。
export const RESUME_REFETCH_GRACE_MS = 1_000;

export function resumeTimedOut(state: ResumeState): ResumeState {
  return state.resuming && !state.sawValidating ? { ...state, resuming: false } : state;
}

export type StaleHoldInput = {
  stale: boolean;
  active: boolean;
  validating: boolean;
  settled?: boolean;
};

// 已确认的过期状态不能因切到后台而解除；新数据且时钟校准后才可恢复。
export function confirmStale(
  held: boolean,
  { stale, active, validating, settled = true }: StaleHoldInput,
): { held: boolean; stale: boolean } {
  if (!stale) return held && !settled ? { held: true, stale: true } : { held: false, stale: false };
  const next = held || (active && !validating);
  return { held: next, stale: next };
}

export type ChargingFeed = {
  connected: boolean;
  pushedAt: number;
  staleAfterMs: number;
  lastSeenAt: number;
  declaredOffline: boolean;
  heartbeatWindowMs: number;
};

export function chargingFeedClockStale(feed: ChargingFeed, now: number): boolean {
  return (
    isStale({ now, at: feed.lastSeenAt, windowMs: feed.heartbeatWindowMs }) ||
    isStale({ now, at: feed.pushedAt, windowMs: feed.staleAfterMs })
  );
}

export function liveChargingFeed<T extends ChargingFeed>(feed: T, clockStale: boolean): T {
  const connected = feed.connected && !feed.declaredOffline && !clockStale;
  return connected === feed.connected ? feed : { ...feed, connected };
}

export function liveNowListening(payload: NowListeningPayload, macOffline: boolean): NowListeningPayload {
  if (!macOffline || payload.music?.source !== "apple-music") return payload;
  const next = payload.alternate;
  return {
    ...payload,
    music: next?.music ?? null,
    idle: !next,
    id: next?.id ?? null,
    link: next?.link ?? null,
    songId: next?.songId ?? null,
    upcomingSongIds: next?.upcomingSongIds ?? [],
    hasLyrics: next?.hasLyrics ?? false,
    motion: next?.motion ?? null,
    expiresInMs: null,
    alternate: null,
  };
}
