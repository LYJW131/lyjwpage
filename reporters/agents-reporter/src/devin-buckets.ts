import {
  bucketStart,
  CODING_BUCKET_MS,
  MAX_WINDOW_ROWS,
  OVERFLOW_MODEL,
  type CodingTokenBucketReport,
  type CodingTokenBucketRow,
  type CodingTokenBucketWindow,
} from "./coding-usage.js";


// tokens.ci 只给日累计。两次提交之间的增量按时间均摊进 5 分钟桶，Pulse 泳道才看得到 Devin；
// 桶里的时间分布是推出来的，总量是实的。
export const DEVIN_BUCKET_SPAN_MS = 24 * 3_600_000;
const SNAPSHOT_DAYS = 3;
const DAY_MS = 86_400_000;

export type DevinTokens = { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number };
type Column = keyof DevinTokens;
const COLUMNS: Column[] = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];

// at 是 tokens.ci 收到这份数据的时刻；output 已含 reasoning（站点口径）。
export type DevinSnapshot = { at: number; days: Record<string, Record<string, DevinTokens>> };

// since 之前的桶没有记账，报告范围不能伸到那里，否则会冲掉站点上不归这份账本管的数。
export type DevinBucketLedger = { since: number; snapshot: DevinSnapshot; windows: CodingTokenBucketWindow[] };

const ZERO: DevinTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };

function snapshotCutoff(now: number): string {
  return new Date(now - SNAPSHOT_DAYS * DAY_MS).toISOString().slice(0, 10);
}

export function devinSnapshot(days: Array<{ date: string; models: Record<string, DevinTokens> }>, at: number, now: number): DevinSnapshot {
  const cutoff = snapshotCutoff(now);
  const kept: DevinSnapshot["days"] = {};
  for (const day of days) {
    if (day.date >= cutoff) kept[day.date] = { ...kept[day.date], ...day.models };
  }
  return { at, days: kept };
}

function spread(total: number, from: number, to: number): Array<[number, number]> {
  if (total <= 0) return [];
  const parts: Array<{ start: number; exact: number; amount: number }> = [];
  for (let start = bucketStart(from); start < to; start += CODING_BUCKET_MS) {
    const overlap = Math.min(to, start + CODING_BUCKET_MS) - Math.max(from, start);
    const exact = total * (overlap / (to - from));
    parts.push({ start, exact, amount: Math.floor(exact) });
  }
  let rest = total - parts.reduce((sum, part) => sum + part.amount, 0);
  for (const part of [...parts].sort((left, right) => (right.exact - right.amount) - (left.exact - left.amount))) {
    if (rest <= 0) break;
    part.amount += 1;
    rest -= 1;
  }
  return parts.filter((part) => part.amount > 0).map((part) => [part.start, part.amount]);
}

function emptyRow(id: string, model: string): CodingTokenBucketRow {
  return { id, model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount: null };
}

const FIELD: Record<Column, keyof Pick<CodingTokenBucketRow, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens" | "reasoningTokens">> = {
  input: "inputTokens",
  output: "outputTokens",
  cacheRead: "cacheReadTokens",
  cacheWrite: "cacheCreationTokens",
  reasoning: "reasoningTokens",
};

function rowTokens(row: CodingTokenBucketRow): number {
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheCreationTokens;
}

function capRows(rows: CodingTokenBucketRow[], id: string): CodingTokenBucketRow[] {
  if (rows.length <= MAX_WINDOW_ROWS) return rows;
  const sorted = [...rows].sort((left, right) => rowTokens(right) - rowTokens(left));
  const kept = sorted.slice(0, MAX_WINDOW_ROWS - 1).filter((row) => row.model !== OVERFLOW_MODEL);
  const overflow = emptyRow(id, OVERFLOW_MODEL);
  for (const row of sorted.filter((entry) => !kept.includes(entry))) {
    for (const field of Object.values(FIELD)) overflow[field] += row[field];
  }
  return [...kept, overflow];
}

// 基线按列取历来最高：tokens.ci 的累计偶尔回落（缺行、旧缓存、修正），恢复时不能把同一段再记一次。
function highWater(before: DevinSnapshot, after: DevinSnapshot, now: number): DevinSnapshot {
  const cutoff = snapshotCutoff(now);
  const days: DevinSnapshot["days"] = {};
  for (const source of [before.days, after.days]) {
    for (const [date, models] of Object.entries(source)) {
      if (date < cutoff) continue;
      const into = (days[date] ??= {});
      for (const [model, tokens] of Object.entries(models)) {
        const kept = into[model] ?? ZERO;
        into[model] = Object.fromEntries(COLUMNS.map((column) => [column, Math.max(kept[column], tokens[column])])) as DevinTokens;
      }
    }
  }
  return { at: after.at, days };
}

export function advanceDevinLedger(
  previous: DevinBucketLedger | null,
  snapshot: DevinSnapshot,
  agentId: string,
  now: number,
): DevinBucketLedger {
  const cutoff = bucketStart(now - DEVIN_BUCKET_SPAN_MS);
  if (!previous || snapshot.at - previous.snapshot.at > DEVIN_BUCKET_SPAN_MS) return { since: snapshot.at, snapshot, windows: [] };
  // 没有新提交就没有新的时刻可摊，涨的部分留到下一次提交一起算。
  if (snapshot.at <= previous.snapshot.at) return previous;
  const windows = new Map(previous.windows
    .filter((window) => window.from >= cutoff)
    .map((window) => [window.from, new Map(window.agents.map((row) => [row.model ?? "", { ...row }]))]));
  const from = previous.snapshot.at;
  const to = snapshot.at;
  for (const [date, models] of Object.entries(snapshot.days)) {
    for (const [model, tokens] of Object.entries(models)) {
      const before = previous.snapshot.days[date]?.[model] ?? ZERO;
      for (const column of COLUMNS) {
        for (const [start, amount] of spread(Math.max(0, tokens[column] - before[column]), from, to)) {
          if (start < cutoff) continue;
          const rows = windows.get(start) ?? new Map<string, CodingTokenBucketRow>();
          const row = rows.get(model) ?? emptyRow(agentId, model);
          row[FIELD[column]] += amount;
          rows.set(model, row);
          windows.set(start, rows);
        }
      }
    }
  }
  return {
    since: previous.since,
    snapshot: highWater(previous.snapshot, snapshot, now),
    windows: [...windows]
      .sort(([left], [right]) => left - right)
      .map(([start, rows]) => ({
        from: start,
        agents: capRows([...rows.values()].map((row) => ({ ...row, reasoningTokens: Math.min(row.reasoningTokens, row.outputTokens) })), agentId),
      }))
      .filter((window) => window.agents.some((row) => rowTokens(row) > 0)),
  };
}

// 每轮都整份重发账本覆盖的范围：哪一封丢了，下一封自己补上。
export function devinBucketReport(ledger: DevinBucketLedger, agentId: string, now: number): CodingTokenBucketReport | null {
  const from = Math.max(bucketStart(ledger.since), bucketStart(now - DEVIN_BUCKET_SPAN_MS));
  const to = Math.min(ledger.snapshot.at, now);
  if (to <= from) return null;
  return {
    from,
    to,
    collectedAt: now,
    agents: [{ id: agentId, state: "ok" }],
    windows: ledger.windows.filter((window) => window.from >= from && window.from < to),
  };
}
