import {
  bucketStart,
  type CodingActivityReport,
  type CodingTokenBucketReport,
  type CodingTokenBucketRow,
  type CodingTokenBucketWindow,
  type CodingUsageDay,
  MAX_DAY_MODELS,
  MAX_WINDOW_ROWS,
  OVERFLOW_MODEL,
} from "./coding-usage.js";
import { add, type UsageEvent } from "./cursor-history.js";
import { estimateCursorCost, modelName } from "./cursor-pricing.js";

export const CURSOR_AGENT_ID = "cursor";

export type CursorUsageDay = Omit<CodingUsageDay, "reasoningTokens">;

export function shanghaiDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(ms);
}

function foldOverflow<T extends { model: string | null }>(
  rows: T[],
  max: number,
  strongestFirst: (left: T, right: T) => number,
  blank: (model: string) => T,
  absorb: (into: T, row: T) => void,
): T[] {
  if (rows.length <= max) return rows;
  const ordered = [...rows].sort(strongestFirst);
  const kept = ordered.slice(0, max - 1);
  let overflow = kept.find((row) => row.model === OVERFLOW_MODEL);
  if (!overflow) {
    overflow = blank(OVERFLOW_MODEL);
    kept.push(overflow);
  }
  for (const row of ordered.slice(max - 1)) absorb(overflow, row);
  return kept;
}

export function emptyDay(date: string): CursorUsageDay {
  return {
    date,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    apiEquivalentCostUSD: 0,
    costComplete: true,
    models: [],
  };
}

type DayModel = CursorUsageDay["models"][number];

function byTokens(left: DayModel, right: DayModel): number {
  return right.tokens - left.tokens || (left.model < right.model ? -1 : 1);
}

export function aggregateEvents(events: UsageEvent[], collectedAtMs: number): {
  days: CursorUsageDay[];
  unmeasured: number;
} {
  const days = new Map<string, CursorUsageDay>();
  const modelTokens = new Map<string, Map<string, number>>();
  let unmeasured = 0;
  for (const event of events) {
    const date = shanghaiDay(event.timestampMs);
    const row = days.get(date) ?? emptyDay(date);
    row.inputTokens = add(row.inputTokens, event.inputTokens);
    row.outputTokens = add(row.outputTokens, event.outputTokens);
    row.cacheReadTokens = add(row.cacheReadTokens, event.cacheReadTokens);
    row.cacheCreationTokens = add(row.cacheCreationTokens, event.cacheCreationTokens);
    const total = event.inputTokens + event.outputTokens + event.cacheReadTokens + event.cacheCreationTokens;
    row.totalTokens = add(row.totalTokens, total);
    if (!event.measured) {
      unmeasured += 1;
      row.costComplete = false;
    } else {
      const cost = estimateCursorCost(
        event.model,
        event.inputTokens,
        event.outputTokens,
        event.cacheReadTokens,
        event.cacheCreationTokens,
        event.timestampMs,
      );
      if (cost == null) {
        row.costComplete = false;
      } else {
        row.apiEquivalentCostUSD += cost;
      }
    }
    if (total > 0) {
      const name = modelName(event.model);
      const models = modelTokens.get(date) ?? new Map<string, number>();
      models.set(name, add(models.get(name) ?? 0, total));
      modelTokens.set(date, models);
    }
    days.set(date, row);
  }
  const today = shanghaiDay(collectedAtMs);
  if (!days.has(today)) days.set(today, emptyDay(today));
  for (const [date, row] of days) {
    const models = [...(modelTokens.get(date) ?? new Map<string, number>())]
      .filter(([, tokens]) => tokens > 0)
      .map(([model, tokens]): DayModel => ({ model, tokens }));
    row.models = foldOverflow(
      models,
      MAX_DAY_MODELS,
      byTokens,
      (model) => ({ model, tokens: 0 }),
      (into, from) => {
        into.tokens = add(into.tokens, from.tokens);
      },
    ).sort(byTokens);
  }
  return {
    days: [...days.values()].sort((left, right) => (left.date < right.date ? -1 : 1)),
    unmeasured,
  };
}

export type LatestEvent = { at: number; model: string | null };

export function latestOf(rows: Iterable<{ at: number | null; model: string | null }>): LatestEvent | null {
  let latest: LatestEvent | null = null;
  for (const row of rows) {
    if (row.at != null && (!latest || row.at > latest.at)) latest = { at: row.at, model: row.model };
  }
  return latest;
}

export function cursorActivityReport(collectedAt: number, latest: LatestEvent | null): CodingActivityReport {
  return {
    collectedAt,
    agents: [
      {
        id: CURSOR_AGENT_ID,
        lastActivityAt: latest ? Math.min(latest.at, collectedAt) : null,
        model: latest?.model ?? null,
      },
    ],
  };
}

type BucketRow = CodingTokenBucketRow & { eventCount: number };

function blankBucketRow(model: string): BucketRow {
  return {
    id: CURSOR_AGENT_ID,
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    eventCount: 0,
  };
}

function absorbBucketRow(into: BucketRow, row: BucketRow): void {
  into.inputTokens = add(into.inputTokens, row.inputTokens);
  into.outputTokens = add(into.outputTokens, row.outputTokens);
  into.cacheReadTokens = add(into.cacheReadTokens, row.cacheReadTokens);
  into.cacheCreationTokens = add(into.cacheCreationTokens, row.cacheCreationTokens);
  into.reasoningTokens = add(into.reasoningTokens, row.reasoningTokens);
  into.eventCount = add(into.eventCount, row.eventCount);
}

function bucketTokens(row: BucketRow): number {
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheCreationTokens;
}

function heaviestBucketRow(left: BucketRow, right: BucketRow): number {
  return bucketTokens(right) - bucketTokens(left) || right.eventCount - left.eventCount || byModelName(left, right);
}

function byModelName(left: BucketRow, right: BucketRow): number {
  return (left.model ?? "") < (right.model ?? "") ? -1 : 1;
}

export function aggregateBuckets(events: UsageEvent[], from: number, to: number): CodingTokenBucketWindow[] {
  const windows = new Map<number, Map<string, BucketRow>>();
  for (const event of events) {
    if (event.timestampMs < from || event.timestampMs >= to) continue;
    const start = bucketStart(event.timestampMs);
    const model = modelName(event.model);
    const rows = windows.get(start) ?? new Map<string, BucketRow>();
    const row = rows.get(model) ?? blankBucketRow(model);
    row.inputTokens = add(row.inputTokens, event.inputTokens);
    row.outputTokens = add(row.outputTokens, event.outputTokens);
    row.cacheReadTokens = add(row.cacheReadTokens, event.cacheReadTokens);
    row.cacheCreationTokens = add(row.cacheCreationTokens, event.cacheCreationTokens);
    row.eventCount += 1;
    rows.set(model, row);
    windows.set(start, rows);
  }
  return [...windows]
    .sort(([left], [right]) => left - right)
    .map(([start, rows]) => ({
      from: start,
      agents: foldOverflow([...rows.values()], MAX_WINDOW_ROWS, heaviestBucketRow, blankBucketRow, absorbBucketRow).sort(byModelName),
    }));
}

export function cursorBucketReport(
  events: UsageEvent[],
  range: { from: number; to: number },
  collectedAt: number,
  partial = false,
): CodingTokenBucketReport {
  return {
    from: range.from,
    to: range.to,
    collectedAt,
    agents: [{ id: CURSOR_AGENT_ID, state: partial ? "partial" : "ok" }],
    windows: aggregateBuckets(events, range.from, range.to),
  };
}
