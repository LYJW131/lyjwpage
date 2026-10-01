import { codingObservationsKey, cursorObservationsKey } from "@/lib/coding-pulse";
import { PULSE_WINDOW_MS } from "@/lib/limits";
import { pulseAssessmentsKey } from "@/lib/pulse-assessments";
import { toColumns } from "@/lib/pulse-columns";
import {
  pulseActivityKey,
  pulseChargingKey,
  pulseLaneKey,
  pulseLaneOpenKey,
  pulseListeningTracesKey,
  pulseWorkoutsKey,
} from "@/lib/pulse-keys";
import { withStorage } from "@/lib/storage";
import type {
  PulseCodingLane,
  PulsePayload,
  PulsePowerLane,
  PulseStateLane,
  PulseStepsLane,
  PulseTokensLane,
} from "@/lib/types";
import { coveringPart, parseStoredCodingBuckets, type StoredCodingBuckets } from "@shared/coding-buckets";
import { codingBucketsKey } from "@shared/coding-store";
import { CODING_BUCKET_MS } from "@shared/coding-usage";
import { CODING_USAGE_SOURCE_NAMES, type CodingUsageSource } from "@shared/coding-usage-sources";
import { latestPulseAssessments, type PulseAssessment } from "@shared/pulse-assessment";
import { codingBand, parseCodingObservation, type CodingObservation } from "@shared/pulse-coding";
import { parseCursorObservation, type CursorObservation } from "@shared/pulse-cursor";
import { LISTENING_TRACE_BRIDGE_MS, LISTENING_TRACE_MATCH_SLACK_MS, parseListeningTrace, type ListeningTrace } from "@shared/pulse-listening";
import {
  activeState,
  chargingSegments,
  chargingSummary,
  currentChargingPower,
  parseActivityBucket,
  parseChargingSample,
  parseClosedInterval,
  parseOpenInterval,
  parseWorkoutIntervals,
  stateSegments,
  GAMING_STATES,
  LISTENING_STATES,
  WATCHING_STATES,
  type ActivityBucket,
  type ChargingSample,
  type ClosedInterval,
  type OpenInterval,
  type StateLane,
  type StateLaneFacts,
  type WorkoutInterval,
} from "@shared/pulse-timeline";

export type PulseWindow = { from: number; to: number };

export function pulseWindowAt(now: number): PulseWindow {
  return { from: now - PULSE_WINDOW_MS, to: now };
}

const TAIL = {
  listening: 1500,
  watching: 500,
  gaming: 500,
  traces: 1000,
  charging: 3500,
  activity: 400,
  coding: 5000,
  cursor: 2000,
} as const;

function span(window: PulseWindow, from: number, to: number) {
  return { startSec: Math.round((from - window.from) / 1000), endSec: Math.round((to - window.from) / 1000) };
}

function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

const STATE_CODES: { [L in StateLane]: readonly StateLaneFacts[L]["state"][] } = {
  listening: LISTENING_STATES,
  watching: WATCHING_STATES,
  gaming: GAMING_STATES,
};

type StateLaneInput<L extends StateLane> = { closed: ClosedInterval<StateLaneFacts[L]>[]; open: OpenInterval<StateLaneFacts[L]> | null };

function publicTitle(lane: StateLane, row: StateLaneFacts[StateLane]): { title: string | null; subtitle: string | null } {
  if (row.state === "idle" || row.state === "offline" || row.state === "online") return { title: null, subtitle: null };
  if (lane === "listening") {
    const music = row as StateLaneFacts["listening"];
    return { title: music.title, subtitle: music.artist };
  }
  if (lane === "watching") {
    const video = row as StateLaneFacts["watching"];
    return { title: video.title, subtitle: video.subtitle };
  }
  return { title: (row as StateLaneFacts["gaming"]).title, subtitle: null };
}

export function stateLaneView<L extends StateLane>(lane: L, input: StateLaneInput<L>, window: PulseWindow, traces: ListeningTrace[] = []): PulseStateLane {
  const segments = stateSegments(lane, input.closed, input.open, window);
  const codes = STATE_CODES[lane] as readonly string[];
  const rows = segments.flatMap((segment) => {
    const at = span(window, segment.from, segment.to);
    if (at.endSec <= at.startSec) return [];
    return [{ ...at, state: codes.indexOf(segment.state), ...publicTitle(lane, segment) }];
  });
  const active = segments.filter((segment) => segment.state === activeState(lane));
  const view: PulseStateLane = {
    kind: "state",
    segments: toColumns(rows, ["state", "title", "subtitle"] as const),
    summary: {
      activeSeconds: seconds(active.reduce((sum, segment) => sum + segment.to - segment.from, 0)),
      titles: new Set(active.map((segment) => segment.title).filter(Boolean)).size,
    },
  };
  if (lane === "listening") {
    const music = segments as unknown as (StateLaneFacts["listening"] & { from: number; to: number })[];
    // 只接在上一段画出来的推断后面；Mac 已解释的那段是实线，接过去会画进实线里。
    let drawnEnd: number | null = null;
    const uncertain = traces.flatMap((trace) => {
      const named = trace.title?.toLowerCase();
      const explained = (segment: (typeof music)[number]) => segment.state !== "idle" && segment.title?.toLowerCase() === named
        && segment.from < trace.t && segment.to > trace.since - LISTENING_TRACE_MATCH_SLACK_MS;
      if (named && music.some(explained)) {
        drawnEnd = null;
        return [];
      }
      const bridged = drawnEnd !== null && drawnEnd < trace.since && trace.since - drawnEnd <= LISTENING_TRACE_BRIDGE_MS;
      const from = Math.max(window.from, bridged ? drawnEnd! : trace.since), to = Math.min(window.to, trace.t);
      drawnEnd = trace.t;
      if (to <= from) return [];
      const at = span(window, from, to);
      return at.endSec > at.startSec ? [{ ...at, title: trace.title, subtitle: trace.artist }] : [];
    });
    view.uncertain = toColumns(uncertain, ["title", "subtitle"] as const);
  }
  return view;
}

export function codingLaneView(observations: CodingObservation[], cursor: CursorObservation[], assessments: PulseAssessment[], window: PulseWindow): PulseCodingLane {
  const band = codingBand(observations, cursor, window);
  const rows = band.flatMap((segment) => {
    const at = span(window, segment.from, segment.to);
    return at.endSec > at.startSec ? [{ ...at, value: segment.value }] : [];
  });
  const total = (value: number) => seconds(band.filter((segment) => segment.value === value).reduce((sum, segment) => sum + segment.to - segment.from, 0));
  const scored = assessments.filter((row) => row.domain === "coding" && row.to > window.from && row.from < window.to)
    .map((row) => ({
      ...span(window, Math.max(window.from, row.from), Math.min(window.to, row.to)),
      intensity: row.intensity.value,
      confidence: Math.round(row.intensity.confidence * 100) / 100,
      mode: row.mode?.value ?? null,
    }))
    .filter((row) => row.endSec > row.startSec);
  return {
    kind: "coding",
    segments: toColumns(rows, ["value"] as const),
    assessments: toColumns(scored, ["intensity", "confidence", "mode"] as const),
    summary: { humanSeconds: total(1), agentSeconds: total(2), bothSeconds: total(3) },
  };
}

// 未积满的短尾桶会把速率放大成尖峰，必须省略。
const TOKEN_MIN_SPAN_MS = 60_000;
const TOKEN_CURRENT_MS = 10 * 60_000;

export type TokenBucketSources = Partial<Record<CodingUsageSource, StoredCodingBuckets | null>>;

function coverageEnd(source: CodingUsageSource, store: StoredCodingBuckets, at: number): number | null {
  if (source === "agents-otlp") return store.receivedAt;
  return coveringPart(store.coverage, at)?.to ?? null;
}

export function tokensLaneView(stores: TokenBucketSources, window: PulseWindow): PulseTokensLane {
  const sums = new Map<number, { fresh: number; output: number; cacheRead: number; end: number }>();
  for (const source of CODING_USAGE_SOURCE_NAMES) {
    const store = stores[source];
    if (!store) continue;
    for (const bucket of store.windows) {
      if (bucket.from < window.from) continue;
      const end = coverageEnd(source, store, bucket.from);
      if (end == null) continue;
      let fresh = 0, output = 0, cacheRead = 0;
      for (const row of bucket.agents) {
        fresh += row.inputTokens + row.outputTokens + row.cacheCreationTokens;
        output += row.outputTokens;
        cacheRead += row.cacheReadTokens;
      }
      if (fresh + cacheRead <= 0) continue;
      const sum = sums.get(bucket.from) ?? { fresh: 0, output: 0, cacheRead: 0, end: bucket.from };
      sum.fresh += fresh;
      sum.output += output;
      sum.cacheRead += cacheRead;
      sum.end = Math.max(sum.end, end);
      sums.set(bucket.from, sum);
    }
  }
  const rows = [...sums]
    .sort(([left], [right]) => left - right)
    .flatMap(([from, sum]) => {
      const to = Math.min(from + CODING_BUCKET_MS, sum.end, window.to);
      if (to - from < TOKEN_MIN_SPAN_MS) return [];
      return [{ ...span(window, from, to), to, perMinute: sum.fresh / ((to - from) / 60_000), fresh: sum.fresh, output: sum.output, cacheRead: sum.cacheRead }];
    });
  const last = rows.at(-1);
  const seen = CODING_USAGE_SOURCE_NAMES.some((source) => {
    const store = stores[source];
    if (!store) return false;
    const end = source === "agents-otlp" ? store.receivedAt : Math.max(0, ...store.coverage.map((part) => part.to));
    return end >= window.to - TOKEN_CURRENT_MS;
  });
  return {
    kind: "tokens",
    buckets: toColumns(rows, ["fresh", "output", "cacheRead"] as const),
    summary: {
      peakPerMinute: rows.length ? Math.round(Math.max(...rows.map((row) => row.perMinute))) : null,
      currentPerMinute: last && last.to >= window.to - TOKEN_CURRENT_MS ? Math.round(last.perMinute) : seen ? 0 : null,
      freshTokens: rows.reduce((sum, row) => sum + row.fresh, 0),
    },
  };
}

export function chargingLaneView(samples: ChargingSample[], window: PulseWindow): PulsePowerLane {
  const segments = chargingSegments(samples, window);
  const rows = segments.flatMap((segment) => {
    const at = span(window, segment.from, segment.to);
    return at.endSec > at.startSec ? [{ ...at, watts: segment.watts }] : [];
  });
  return {
    kind: "power",
    segments: toColumns(rows, ["watts"] as const),
    currentPowerW: currentChargingPower(samples, window.to),
    summary: chargingSummary(segments),
  };
}

export function activityLaneView(buckets: ActivityBucket[], workouts: WorkoutInterval[], window: PulseWindow): PulseStepsLane {
  let steps = 0;
  const rows = buckets.flatMap((bucket) => {
    const from = Math.max(window.from, bucket.from), to = Math.min(window.to, bucket.to);
    if (to <= from || bucket.steps == null) return [];
    steps += bucket.steps * (to - from) / (bucket.to - bucket.from);
    const at = span(window, from, to);
    return at.endSec > at.startSec ? [{ ...at, steps: bucket.steps }] : [];
  });
  const sessions = workouts.flatMap((workout) => {
    const from = Math.max(window.from, workout.startedAt), to = Math.min(window.to, workout.endedAt);
    if (to <= from) return [];
    const at = span(window, from, to);
    return at.endSec > at.startSec ? [{ ...at, activityType: workout.activityType }] : [];
  });
  return {
    kind: "steps",
    buckets: toColumns(rows, ["steps"] as const),
    workouts: toColumns(sessions, ["activityType"] as const),
    summary: { steps: Math.round(steps) },
  };
}

function parsed<T>(rows: unknown, parse: (raw: string) => T | null): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((raw) => {
    if (typeof raw !== "string") return [];
    const row = parse(raw);
    return row ? [row] : [];
  });
}

export async function getPulseStatus(now: number = Date.now()): Promise<PulsePayload> {
  const window = pulseWindowAt(now);
  const empty: unknown[] = [];
  const rows = await withStorage(async (storage) => storage.batch()
    .listRange(pulseLaneKey("listening"), -TAIL.listening, -1)
    .get(pulseLaneOpenKey("listening"))
    .listRange(pulseLaneKey("watching"), -TAIL.watching, -1)
    .get(pulseLaneOpenKey("watching"))
    .listRange(pulseLaneKey("gaming"), -TAIL.gaming, -1)
    .get(pulseLaneOpenKey("gaming"))
    .listRange(pulseListeningTracesKey(), -TAIL.traces, -1)
    .listRange(pulseChargingKey(), -TAIL.charging, -1)
    .listRange(pulseActivityKey(), -TAIL.activity, -1)
    .get(pulseWorkoutsKey())
    .listRange(codingObservationsKey(), -TAIL.coding, -1)
    .listRange(cursorObservationsKey(), -TAIL.cursor, -1)
    .listRange(pulseAssessmentsKey(), 0, -1)
    .get(codingBucketsKey("mac"))
    .get(codingBucketsKey("agents"))
    .get(codingBucketsKey("agents-otlp"))
    .execute(), empty);
  const text = (index: number) => (typeof rows[index] === "string" ? rows[index] as string : null);
  const lane = <L extends StateLane>(name: L, index: number): StateLaneInput<L> => ({
    closed: parsed(rows[index], (raw) => parseClosedInterval(name, raw)),
    open: parseOpenInterval(name, text(index + 1)),
  });
  const assessments = latestPulseAssessments(Array.isArray(rows[12]) ? rows[12] as string[] : []);
  const tokenBuckets: TokenBucketSources = {
    mac: parseStoredCodingBuckets(rows[13]),
    agents: parseStoredCodingBuckets(rows[14]),
    "agents-otlp": parseStoredCodingBuckets(rows[15]),
  };
  return {
    generatedAt: now,
    window,
    lanes: {
      coding: codingLaneView(parsed(rows[10], parseCodingObservation), parsed(rows[11], parseCursorObservation), assessments, window),
      tokens: tokensLaneView(tokenBuckets, window),
      listening: stateLaneView("listening", lane("listening", 0), window, parsed(rows[6], parseListeningTrace)),
      watching: stateLaneView("watching", lane("watching", 2), window),
      gaming: stateLaneView("gaming", lane("gaming", 4), window),
      charging: chargingLaneView(parsed(rows[7], parseChargingSample), window),
      activity: activityLaneView(parsed(rows[8], parseActivityBucket), parseWorkoutIntervals(text(9)), window),
    },
  };
}
