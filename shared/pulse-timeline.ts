import { CHARGING_IDLE_MAX_W } from "@/lib/home-layout";
import { PULSE_REPEAT_AFTER_MS, PULSE_SILENT_AFTER_MS } from "@/lib/limits";


export const PULSE_TITLE_MAX = 200;
export const PULSE_SEEN_WRITE_MS = 60_000;
export const PULSE_STATE_HOLD_MS = PULSE_SILENT_AFTER_MS;
export const GAMING_HOLD_MS = 35 * 60_000;
// 听歌道上暂停画满这么久就当空闲：开着音乐 App 不放歌会一直停在暂停。只在读取时截断，存的区间不变。
export const LISTENING_PAUSE_MAX_MS = 10 * 60_000;

export const STATE_LANES = ["listening", "watching", "gaming"] as const;
export type StateLane = (typeof STATE_LANES)[number];

export const LISTENING_STATES = ["idle", "paused", "playing"] as const;
export const WATCHING_STATES = ["idle", "paused", "playing"] as const;
export const GAMING_STATES = ["offline", "online", "in-game"] as const;

export type ListeningFacts = {
  state: (typeof LISTENING_STATES)[number];
  source: "mac" | "homepod" | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  trackId: string | null;
};
export type WatchingFacts = {
  state: (typeof WATCHING_STATES)[number];
  itemId: string | null;
  title: string | null;
  subtitle: string | null;
};
export type GamingFacts = {
  state: (typeof GAMING_STATES)[number];
  titleId: string | null;
  title: string | null;
};
export type StateLaneFacts = { listening: ListeningFacts; watching: WatchingFacts; gaming: GamingFacts };

export type OpenInterval<F> = F & { from: number; seenAt: number; holdUntil: number | null; endsBy: number | null };

export type ObservationHold = { until: number | null; endsBy?: number | null };
export type ClosedInterval<F> = F & { from: number; to: number };

export const STATE_LANE_CAPS: Record<StateLane, number> = { listening: 3000, watching: 1000, gaming: 1000 };

const FACT_KEYS: { [L in StateLane]: readonly (keyof StateLaneFacts[L])[] } = {
  listening: ["state", "source", "title", "artist", "album", "trackId"],
  watching: ["state", "itemId", "title", "subtitle"],
  gaming: ["state", "titleId", "title"],
};

export function pulseText(value: unknown, max = PULSE_TITLE_MAX): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function stateHoldMs<L extends StateLane>(lane: L, facts: StateLaneFacts[L]): number {
  if (lane === "gaming") return GAMING_HOLD_MS;
  if (lane === "watching" && facts.state === "idle") return Infinity;
  return PULSE_STATE_HOLD_MS;
}

export function defaultHoldUntil<L extends StateLane>(lane: L, facts: StateLaneFacts[L], t: number): number | null {
  const hold = stateHoldMs(lane, facts);
  return Number.isFinite(hold) ? t + hold : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? pulseText(value) : undefined;
}

export function laneFacts<L extends StateLane>(lane: L, value: unknown): StateLaneFacts[L] | null {
  const row = record(value);
  if (!row) return null;
  const states: readonly string[] = lane === "gaming" ? GAMING_STATES : lane === "watching" ? WATCHING_STATES : LISTENING_STATES;
  if (typeof row.state !== "string" || !states.includes(row.state)) return null;
  const facts: Record<string, unknown> = { state: row.state };
  for (const key of FACT_KEYS[lane]) {
    if (key === "state") continue;
    const raw = row[key as string];
    if (key === "source") {
      if (raw !== null && raw !== "mac" && raw !== "homepod") return null;
      facts.source = raw;
      continue;
    }
    const text = nullableText(raw ?? null);
    if (text === undefined) return null;
    facts[key as string] = text;
  }
  return facts as StateLaneFacts[L];
}

export function sameFacts<L extends StateLane>(lane: L, a: StateLaneFacts[L], b: StateLaneFacts[L]): boolean {
  return FACT_KEYS[lane].every((key) => a[key] === b[key]);
}

function pick<L extends StateLane>(lane: L, row: StateLaneFacts[L]): StateLaneFacts[L] {
  return Object.fromEntries(FACT_KEYS[lane].map((key) => [key, row[key]])) as unknown as StateLaneFacts[L];
}

function time(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseOpenInterval<L extends StateLane>(lane: L, raw: string | null): OpenInterval<StateLaneFacts[L]> | null {
  if (!raw) return null;
  try {
    const row = record(JSON.parse(raw));
    const facts = laneFacts(lane, row);
    const from = time(row?.from), seenAt = time(row?.seenAt);
    if (!facts || from == null || seenAt == null || seenAt < from) return null;
    const holdUntil = row?.holdUntil === null ? null : time(row?.holdUntil) ?? defaultHoldUntil(lane, facts, seenAt);
    return { ...facts, from, seenAt, holdUntil, endsBy: time(row?.endsBy) };
  } catch {
    return null;
  }
}

export function parseClosedInterval<L extends StateLane>(lane: L, raw: string): ClosedInterval<StateLaneFacts[L]> | null {
  try {
    const row = record(JSON.parse(raw));
    const facts = laneFacts(lane, row);
    const from = time(row?.from), to = time(row?.to);
    if (!facts || from == null || to == null || to <= from) return null;
    return { ...facts, from, to };
  } catch {
    return null;
  }
}

// 暂停只在接着一段没过期的播放或暂停时才成立；离线后上线、观测空窗之后看到的暂停，没有播放可接，记成空闲。
function orphanPauseAsIdle<L extends StateLane>(lane: L, open: OpenInterval<StateLaneFacts[L]> | null, t: number, facts: StateLaneFacts[L]): StateLaneFacts[L] {
  if (lane !== "listening" || facts.state !== "paused") return facts;
  if (open && open.state !== "idle" && (open.holdUntil === null || t <= open.holdUntil)) return facts;
  return { state: "idle", source: null, title: null, artist: null, album: null, trackId: null } as StateLaneFacts[L];
}

export type StateObservationPlan<F> = {
  closed: ClosedInterval<F>[];
  open: OpenInterval<F> | null;
};

// 宽限只延长等待观测的窗口，不能计入已知播放事实。
function knownEnd(open: { seenAt: number; endsBy: number | null }): number {
  return Math.max(open.seenAt, open.endsBy ?? open.seenAt);
}

export function planStateObservation<L extends StateLane>(
  lane: L,
  open: OpenInterval<StateLaneFacts[L]> | null,
  t: number,
  facts: StateLaneFacts[L] | null,
  hold: ObservationHold = { until: facts ? defaultHoldUntil(lane, facts, t) : null },
): StateObservationPlan<StateLaneFacts[L]> | null {
  const next = facts ? pick(lane, orphanPauseAsIdle(lane, open, t, facts)) : null;
  const holdUntil = hold.until === null ? null : Math.max(t, hold.until);
  const endsBy = hold.endsBy ?? null;
  if (!open) return next ? { closed: [], open: { ...next, from: t, seenAt: t, holdUntil, endsBy } } : null;
  if (t <= open.seenAt) return null;
  const expired = open.holdUntil !== null && t > open.holdUntil;
  const end = expired ? Math.min(t, knownEnd(open)) : t;
  const current = pick(lane, open);
  const closed = end > open.from ? [{ ...current, from: open.from, to: end }] : [];
  if (!next) return { closed, open: null };
  if (!expired && sameFacts(lane, current, next)) {
    const shifted = (a: number | null, b: number | null) => (a === null || b === null ? a !== b : Math.abs(a - b) >= PULSE_SEEN_WRITE_MS);
    return t - open.seenAt >= PULSE_SEEN_WRITE_MS || shifted(holdUntil, open.holdUntil) || shifted(endsBy, open.endsBy)
      ? { closed: [], open: { ...open, seenAt: t, holdUntil, endsBy } }
      : null;
  }
  return { closed, open: { ...next, from: t, seenAt: t, holdUntil, endsBy } };
}

export type StateSegment<F> = F & { from: number; to: number };

export function stateSegments<L extends StateLane>(
  lane: L,
  closed: ClosedInterval<StateLaneFacts[L]>[],
  open: OpenInterval<StateLaneFacts[L]> | null,
  window: { from: number; to: number },
): StateSegment<StateLaneFacts[L]>[] {
  const rows: StateSegment<StateLaneFacts[L]>[] = [...closed].sort((a, b) => a.from - b.from);
  if (open && open.from < window.to) {
    const live = open.holdUntil === null || window.to <= open.holdUntil;
    const to = live ? window.to : Math.min(window.to, knownEnd(open));
    if (to > open.from) rows.push({ ...pick(lane, open), from: open.from, to });
  }
  const segments: StateSegment<StateLaneFacts[L]>[] = [];
  let cursor = window.from;
  for (const row of rows) {
    const cap = lane === "listening" && row.state === "paused" ? row.from + LISTENING_PAUSE_MAX_MS : Infinity;
    const from = Math.max(row.from, cursor, window.from);
    const to = Math.min(row.to, window.to, cap);
    if (to <= from) continue;
    segments.push({ ...row, from, to });
    cursor = to;
  }
  return segments;
}

export function watchingFacts(
  state: { itemId: string; paused: boolean } | null,
  item: { id: string; title: string; subtitle: string } | null,
): WatchingFacts {
  if (!state) return { state: "idle", itemId: null, title: null, subtitle: null };
  const detail = item?.id === state.itemId ? item : null;
  return {
    state: state.paused ? "paused" : "playing",
    itemId: pulseText(state.itemId, 80),
    title: pulseText(detail?.title),
    subtitle: pulseText(detail?.subtitle),
  };
}

export function gamingFacts(presence: { online: boolean; playing: { titleId: string; title: string } | null }): GamingFacts {
  if (presence.playing) {
    return { state: "in-game", titleId: pulseText(presence.playing.titleId, 80), title: pulseText(presence.playing.title) };
  }
  return { state: presence.online ? "online" : "offline", titleId: null, title: null };
}

// Quest 的游戏没有 PlayStation 那样的 titleId，用 Discord 的应用 ID（没有就用游戏名）加前缀，免得和 PS 的 ID 撞上。
export function questGamingFacts(playing: { name: string; applicationId: string | null }): GamingFacts {
  return { state: "in-game", titleId: pulseText(`quest:${playing.applicationId ?? playing.name}`, 80), title: pulseText(playing.name) };
}

export function activeState(lane: StateLane): string {
  return lane === "gaming" ? "in-game" : "playing";
}


export type ChargingSample = { t: number; watts: number; device?: string };
export const CHARGING_SAMPLE_CAP = 6000;
export const CHARGING_HOLD_MS = PULSE_SILENT_AFTER_MS;

function roundWatts(watts: number): number {
  return Math.round(Math.max(0, watts) * 10) / 10;
}

export function parseChargingSample(raw: string): ChargingSample | null {
  try {
    const row = record(JSON.parse(raw));
    const t = time(row?.t);
    const watts = row?.watts;
    if (t == null || typeof watts !== "number" || !Number.isFinite(watts) || watts < 0) return null;
    const device = pulseText(row?.device, 80);
    return { t, watts, ...(device ? { device } : {}) };
  } catch {
    return null;
  }
}

export function planChargingSample(last: ChargingSample | null, next: { t: number; watts: number; device?: string | null }): ChargingSample | null {
  const device = pulseText(next.device, 80);
  const sample: ChargingSample = { t: next.t, watts: roundWatts(next.watts), ...(device ? { device } : {}) };
  if (!last) return sample;
  if (sample.t <= last.t) return null;
  const idleBefore = last.watts <= CHARGING_IDLE_MAX_W;
  const idleAfter = sample.watts <= CHARGING_IDLE_MAX_W;
  if (idleBefore !== idleAfter) return sample;
  if ((sample.device ?? null) !== (last.device ?? null)) return sample;
  if (!idleAfter && sample.watts !== last.watts && sample.t - last.t >= 30_000 &&
      Math.abs(sample.watts - last.watts) >= Math.max(2, 0.1 * Math.max(sample.watts, last.watts))) return sample;
  if (sample.t - last.t >= PULSE_REPEAT_AFTER_MS) return sample;
  return null;
}

export type ChargingSegment = { from: number; to: number; watts: number };

export function chargingSegments(samples: ChargingSample[], window: { from: number; to: number }): ChargingSegment[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const segments: ChargingSegment[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const sample = sorted[index];
    const from = Math.max(window.from, sample.t);
    const to = Math.min(window.to, sorted[index + 1]?.t ?? Infinity, sample.t + CHARGING_HOLD_MS);
    if (to <= from) continue;
    const previous = segments.at(-1);
    if (previous && previous.to === from && previous.watts === sample.watts) previous.to = to;
    else segments.push({ from, to, watts: sample.watts });
  }
  return segments;
}

export function currentChargingPower(samples: ChargingSample[], now: number): number | null {
  const last = samples.reduce<ChargingSample | null>((latest, sample) => (sample.t <= now && (!latest || sample.t > latest.t) ? sample : latest), null);
  return last && now - last.t < CHARGING_HOLD_MS ? last.watts : null;
}

export function chargingSummary(segments: ChargingSegment[]): { peakW: number | null; energyWh: number } {
  if (!segments.length) return { peakW: null, energyWh: 0 };
  const energy = segments.reduce((sum, part) => sum + part.watts * (part.to - part.from) / 3_600_000, 0);
  return { peakW: Math.max(...segments.map((part) => part.watts)), energyWh: Math.round(energy * 10) / 10 };
}

export type ChargingSession = { startedAt: number; endedAt: number; peakW: number; energyWh: number; device: string | null; closed: boolean };
export function chargingSessions(samples: ChargingSample[], now: number): ChargingSession[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const sessions: ChargingSession[] = [];
  let current: ChargingSession | null = null;
  for (let index = 0; index < sorted.length; index += 1) {
    const sample = sorted[index];
    const next = sorted[index + 1];
    const end = Math.min(next?.t ?? now, sample.t + CHARGING_HOLD_MS);
    if (sample.watts <= CHARGING_IDLE_MAX_W) {
      if (current) { current.closed = true; current = null; }
      continue;
    }
    if (!current || current.endedAt < sample.t) {
      if (current) current.closed = true;
      current = { startedAt: sample.t, endedAt: sample.t, peakW: 0, energyWh: 0, device: sample.device ?? null, closed: false };
      sessions.push(current);
    }
    current.device ??= sample.device ?? null;
    current.peakW = Math.max(current.peakW, sample.watts);
    current.energyWh += sample.watts * Math.max(0, end - sample.t) / 3_600_000;
    current.endedAt = Math.max(current.endedAt, end);
    if (!next ? now - sample.t >= CHARGING_HOLD_MS : next.t > sample.t + CHARGING_HOLD_MS) { current.closed = true; current = null; }
  }
  return sessions.map((session) => ({ ...session, energyWh: Math.round(session.energyWh * 1000) / 1000 }));
}


export type ActivityBucket = { from: number; to: number; steps: number | null; moveKcal: number | null; exerciseMinutes: number | null };
export const ACTIVITY_BUCKET_CAP = 2100;

function count(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function parseActivityBucket(raw: string): ActivityBucket | null {
  try {
    const row = record(JSON.parse(raw));
    const from = time(row?.from), to = time(row?.to);
    const steps = count(row?.steps ?? null), moveKcal = count(row?.moveKcal ?? null), exerciseMinutes = count(row?.exerciseMinutes ?? null);
    if (from == null || to == null || to <= from || steps === undefined || moveKcal === undefined || exerciseMinutes === undefined) return null;
    return { from, to, steps, moveKcal, exerciseMinutes };
  } catch {
    return null;
  }
}

export function replaceActivityBuckets(
  previous: ActivityBucket[],
  range: { from: number; to: number },
  replacements: ActivityBucket[],
): { next: ActivityBucket[]; firstChanged: number; changed: boolean } {
  const kept = previous.filter((bucket) => bucket.to <= range.from || bucket.from >= range.to);
  // 字段顺序影响序列化比较，必须规范化以免键顺序变化触发重写。
  const canonical = ({ from, to, steps, moveKcal, exerciseMinutes }: ActivityBucket): ActivityBucket => ({ from, to, steps, moveKcal, exerciseMinutes });
  const next = [...kept, ...replacements].map(canonical).sort((a, b) => a.from - b.from);
  let firstChanged = 0;
  while (firstChanged < previous.length && firstChanged < next.length &&
    JSON.stringify(canonical(previous[firstChanged])) === JSON.stringify(next[firstChanged])) firstChanged += 1;
  const changed = firstChanged !== previous.length || previous.length !== next.length;
  return { next, firstChanged, changed };
}

export type WorkoutInterval = { startedAt: number; endedAt: number; activityType: string };

export function parseWorkoutIntervals(raw: string | null): WorkoutInterval[] {
  if (!raw) return [];
  try {
    const items = record(JSON.parse(raw))?.items;
    if (!Array.isArray(items)) return [];
    return items.flatMap((value) => {
      const row = record(value);
      const startedAt = time(row?.startedAt), endedAt = time(row?.endedAt);
      const activityType = pulseText(row?.activityType, 64);
      return startedAt != null && endedAt != null && endedAt >= startedAt && activityType ? [{ startedAt, endedAt, activityType }] : [];
    }).sort((a, b) => a.startedAt - b.startedAt);
  } catch {
    return [];
  }
}
