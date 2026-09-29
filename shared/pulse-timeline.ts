import { CHARGING_IDLE_MAX_W } from "@/lib/home-layout";
import { PULSE_REPEAT_AFTER_MS, PULSE_SILENT_AFTER_MS } from "@/lib/limits";

/**
 * Pulse 的事实时间线：只存原始值，档位、颜色、摘要一律在展示时现算 —— 入库前压成档位的话，
 * 被压掉的部分（活动的步数、Coding 的「两者同时」、充电的精确瓦数）再也找不回来，
 * 展示方式一改就得迁移数据。分两种形状：
 *
 * - **状态区间**（listening / watching / gaming）：每条道一个「开着的区间」加一串
 *   已关闭的区间。同一状态只续 `seenAt` 和有效期（每条道最多每分钟写一次）；状态或
 *   标题变了、或者过了上一次观测的有效期才又看见，才关上旧区间开新区间。
 * - **数值样本**（charging 的实测瓦数、activity 的五分钟桶与训练区间）。
 *
 * Coding 不在这里：它的三色带在读时从 `pulse:coding-observations` 现算，见
 * shared/pulse-coding 的 codingBand。
 *
 * 纯函数，不碰存储、不看时钟；`now` 一律由调用方传进来。
 */

/** 标题只防病态长度，不截成摘要 */
export const PULSE_TITLE_MAX = 200;
/** 同一状态续 `seenAt` 的最短间隔：每条道每分钟最多一次写入 */
export const PULSE_SEEN_WRITE_MS = 60_000;
/** Mac 的播放、Emby 的播放 / 暂停的有效期：上报最迟这么久再确认一次。HomePod 按曲目剩余时长另算（见 shared/pulse-listening） */
export const PULSE_STATE_HOLD_MS = PULSE_SILENT_AFTER_MS;
/** PSN 没人看站点时按闲档（collector 的 `IDLE_TICK_INTERVAL_MS`）才查一次在线状态；有效期要盖过它，再留出投递抖动 */
export const GAMING_HOLD_MS = 35 * 60_000;

export const STATE_LANES = ["listening", "watching", "gaming"] as const;
export type StateLane = (typeof STATE_LANES)[number];

export const LISTENING_STATES = ["idle", "paused", "playing"] as const;
export const WATCHING_STATES = ["idle", "paused", "playing"] as const;
export const GAMING_STATES = ["offline", "online", "in-game"] as const;

export type ListeningFacts = {
  state: (typeof LISTENING_STATES)[number];
  /** 在放的那一路；空闲时为 null */
  source: "mac" | "homepod" | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  /** 设备报来的曲目 id（Mac 的 persistent ID 等），不是 Apple 目录 id */
  trackId: string | null;
};
export type WatchingFacts = {
  state: (typeof WATCHING_STATES)[number];
  itemId: string | null;
  title: string | null;
  /** 剧集的「S01E05 · 集标题」；电影为 null */
  subtitle: string | null;
};
export type GamingFacts = {
  state: (typeof GAMING_STATES)[number];
  titleId: string | null;
  title: string | null;
};
export type StateLaneFacts = { listening: ListeningFacts; watching: WatchingFacts; gaming: GamingFacts };

/**
 * 还没关上的区间。
 *
 * - `seenAt`：最近一次写下来的确认时刻。
 * - `holdUntil`：那次观测带宽限的有效期，只用来判断这段还开不开着、在线时画到哪儿；
 *   null 表示一直有效（只有 Emby 明确停播后的空闲是这样）。
 * - `endsBy`：来源自己说得出的结束时刻（HomePod 这首曲子按剩余时长该放完的那一刻）；
 *   null 表示没有这种说法，只认到 `seenAt`。过期关段时认到 `max(seenAt, endsBy)`，
 *   不把宽限算进事实。
 */
export type OpenInterval<F> = F & { from: number; seenAt: number; holdUntil: number | null; endsBy: number | null };

/** 一次观测的有效期：`until` 带宽限、决定还开不开着，`endsBy` 是来源说得出的结束时刻 */
export type ObservationHold = { until: number | null; endsBy?: number | null };
export type ClosedInterval<F> = F & { from: number; to: number };

/**
 * 每条道保留的已关闭区间条数。按七天估：听歌每首一段（一小时十几段）加暂停、
 * 空闲与断流切开的段；看剧、打游戏一段就是几十分钟。TTL 七天才是真正的时间窗，
 * 这里只防病态上报把表撑爆。
 */
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

/** 这一状态没有新观测时还能认多久。Emby 明确停播之后一直是空闲，直到下一次开播 */
export function stateHoldMs<L extends StateLane>(lane: L, facts: StateLaneFacts[L]): number {
  if (lane === "gaming") return GAMING_HOLD_MS;
  if (lane === "watching" && facts.state === "idle") return Infinity;
  return PULSE_STATE_HOLD_MS;
}

/**
 * 一次观测默认撑到哪一刻：按道和状态的固定有效期。来源自己知道得更准时（HomePod
 * 按曲目剩余时长）由调用方传进 planStateObservation，见 shared/pulse-listening。
 */
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

/** 把一行里属于这条道的事实挑出来并校验；多余字段丢掉，坏行返回 null */
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

export type StateObservationPlan<F> = {
  /** 这次要追加的已关闭区间，按时间先后，0–2 条 */
  closed: ClosedInterval<F>[];
  /** 之后开着的那一段；null 表示此刻看不见（离线 / 没有来源） */
  open: OpenInterval<F> | null;
};

/** 过期还没关上的段认到哪儿：最后一次确认，或来源说得出的结束时刻（取晚），不含宽限 */
function knownEnd(open: { seenAt: number; endsBy: number | null }): number {
  return Math.max(open.seenAt, open.endsBy ?? open.seenAt);
}

/**
 * 一次观测该怎么落。返回 null 表示什么都不用写。
 *
 * - `facts` 为 null：这一刻看不见这条道（Mac 离线又没有 HomePod、上报说自己下线）。
 *   开着的那段到此为止，之后是未知，不是空闲。
 * - 和开着那段相同：只续 `seenAt` 与有效期，每 {@link PULSE_SEEN_WRITE_MS} 最多一次；
 *   有效期或结束时刻挪动超过这么多（HomePod 换了一份快照）也写。
 * - 过了开着那段的有效期（`holdUntil`）才又看见：来源断了。旧段只认到我们确实知道的
 *   那一刻 —— 定期确认的来源（Mac、Emby、PSN）认到最后一次确认；HomePod 只在换曲时推，
 *   认到这首按剩余时长该放完的那一刻。宽限只管「还开不开着」，不算进事实。中间是未知。
 * - 状态或标题变了：旧段关在这一刻，新段从这一刻开始。
 * - `t` 不前进：重复或乱序，丢掉。
 *
 * `hold` 缺省按道和状态的固定有效期（defaultHoldUntil），没有结束时刻。
 */
export function planStateObservation<L extends StateLane>(
  lane: L,
  open: OpenInterval<StateLaneFacts[L]> | null,
  t: number,
  facts: StateLaneFacts[L] | null,
  hold: ObservationHold = { until: facts ? defaultHoldUntil(lane, facts, t) : null },
): StateObservationPlan<StateLaneFacts[L]> | null {
  const next = facts ? pick(lane, facts) : null;
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

/**
 * 窗口内的状态段。开着的那段还在有效期内就画到此刻；过了有效期只画到它将来被关上的
 * 那一刻（最后一次确认或来源说得出的结束时刻，见 planStateObservation），关上之后
 * 画法不变。
 */
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
    const from = Math.max(row.from, cursor, window.from);
    const to = Math.min(row.to, window.to);
    if (to <= from) continue;
    segments.push({ ...row, from, to });
    cursor = to;
  }
  return segments;
}

/**
 * Emby 推来的一次播放状态。`state` 为 null 是代理确认停播（明确的停止），之后一直是
 * 空闲直到下一次开播；详情按 itemId 对上才用，对不上只留 id，不借别的片名。
 */
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

/** PSN 在线状态：在游戏里、在线没进游戏、离线 */
export function gamingFacts(presence: { online: boolean; playing: { titleId: string; title: string } | null }): GamingFacts {
  if (presence.playing) {
    return { state: "in-game", titleId: pulseText(presence.playing.titleId, 80), title: pulseText(presence.playing.title) };
  }
  return { state: presence.online ? "online" : "offline", titleId: null, title: null };
}

/** 每条道「在做这件事」的那一档：在放、在看、在游戏里 */
export function activeState(lane: StateLane): string {
  return lane === "gaming" ? "in-game" : "playing";
}

// ---------------------------------------------------------------- charging

/** 一笔实测瓦数。`device` 是当时在充的设备名，只进内部与归档，不公开 */
export type ChargingSample = { t: number; watts: number; device?: string };
export const CHARGING_SAMPLE_CAP = 6000;
/** 充电头插着就每 30 秒左右报一次；超过这么久没有下一笔就是断流，那段是未知 */
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

/**
 * 这一笔瓦数该不该写：
 *
 * - 跨过待机门槛（{@link CHARGING_IDLE_MAX_W}）立刻写；门槛以下的抖动不写。
 * - 都在通电时，隔够久、变得够明显才写。
 * - 换了设备立刻写。
 * - 其余最多隔 {@link PULSE_REPEAT_AFTER_MS} 再确认一次，带上此刻的读数：断流才会在图上露出缺口。
 */
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

/** 每笔撑到下一笔或有效期满（取早），相邻同瓦数并成一段；断流的缺口留着 */
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

/** 此刻的瓦数；最后一笔已过有效期就是 null（不知道），不是 0 */
export function currentChargingPower(samples: ChargingSample[], now: number): number | null {
  const last = samples.reduce<ChargingSample | null>((latest, sample) => (sample.t <= now && (!latest || sample.t > latest.t) ? sample : latest), null);
  return last && now - last.t < CHARGING_HOLD_MS ? last.watts : null;
}

export function chargingSummary(segments: ChargingSegment[]): { peakW: number | null; energyWh: number } {
  if (!segments.length) return { peakW: null, energyWh: 0 };
  const energy = segments.reduce((sum, part) => sum + part.watts * (part.to - part.from) / 3_600_000, 0);
  return { peakW: Math.max(...segments.map((part) => part.watts)), energyWh: Math.round(energy * 10) / 10 };
}

/**
 * 一次充电：连续通电（高于待机门槛）的一串样本，中间不断流。给 D1 归档用。
 * 能量按每笔的有效期积分；设备取这一次里第一个报出来的名字。
 */
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
    // 断流：这一笔撑满有效期还没有下一笔，这次充电到此为止
    if (!next ? now - sample.t >= CHARGING_HOLD_MS : next.t > sample.t + CHARGING_HOLD_MS) { current.closed = true; current = null; }
  }
  return sessions.map((session) => ({ ...session, energyWh: Math.round(session.energyWh * 1000) / 1000 }));
}

// ---------------------------------------------------------------- activity

/** HealthKit 闭合的五分钟桶，原样保留三项计数；缺了哪项就是 null（未授权或没有数据） */
export type ActivityBucket = { from: number; to: number; steps: number | null; moveKcal: number | null; exerciseMinutes: number | null };
/** 七天的五分钟桶再留一点余量 */
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

/**
 * 用一次权威查询替换范围内的桶。范围外的原样保留；和范围有交叠的旧桶（哪怕只穿进
 * 一截）一并丢掉，不能盖住权威查询里的未知空缺。
 *
 * 返回替换后的整串，以及第一处不同的下标：写入侧只需从那里往后重写，
 * 通常每次推送只动最后一两个桶，不用整串 remove + append。
 */
export function replaceActivityBuckets(
  previous: ActivityBucket[],
  range: { from: number; to: number },
  replacements: ActivityBucket[],
): { next: ActivityBucket[]; firstChanged: number; changed: boolean } {
  const kept = previous.filter((bucket) => bucket.to <= range.from || bucket.from >= range.to);
  // 字段顺序固定下来：下面按序列化比较，上报里的键序不能让没变的桶看起来变了
  const canonical = ({ from, to, steps, moveKcal, exerciseMinutes }: ActivityBucket): ActivityBucket => ({ from, to, steps, moveKcal, exerciseMinutes });
  const next = [...kept, ...replacements].map(canonical).sort((a, b) => a.from - b.from);
  let firstChanged = 0;
  while (firstChanged < previous.length && firstChanged < next.length &&
    JSON.stringify(canonical(previous[firstChanged])) === JSON.stringify(next[firstChanged])) firstChanged += 1;
  const changed = firstChanged !== previous.length || previous.length !== next.length;
  return { next, firstChanged, changed };
}

/** 已完成训练的区间。只留时间与项目名；心率、距离这些归训练卡片自己的存储 */
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
