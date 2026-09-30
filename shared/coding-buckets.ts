import {
  CODING_BUCKET_MS,
  type CodingTokenBucketReport,
  type CodingTokenBucketRow,
  type CodingTokenBucketState,
} from "./coding-usage";
import { mergeCoverage, type Coverage } from "./pulse-features";

export type StoredCodingBuckets = {
  coverage: Coverage[];
  agents: Array<{ id: string; state: CodingTokenBucketState }>;
  windows: Array<{ from: number; agents: CodingTokenBucketRow[] }>;
  collectedAt: number;
  receivedAt: number;
  revision?: number;
};

export type CodingBucketDelta = Omit<CodingTokenBucketRow, "reasoningTokens" | "eventCount"> & { at: number };

export const CODING_BUCKET_KEEP_MS = 26 * 3_600_000;
export const CODING_BUCKET_TTL_MS = 2 * 24 * 3_600_000;

type Row = CodingTokenBucketRow;

function rowKey(row: Pick<Row, "id" | "model">): string {
  return JSON.stringify([row.id, row.model]);
}

function tokens(row: Row): number {
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheCreationTokens;
}

function sortRows(rows: Row[]): Row[] {
  return rows.sort((left, right) => (left.id === right.id
    ? (left.model ?? "").localeCompare(right.model ?? "")
    : left.id.localeCompare(right.id)));
}

function retained(windows: Map<number, Row[]>, coverage: Coverage[], receivedAt: number) {
  const cutoff = receivedAt - CODING_BUCKET_KEEP_MS;
  return {
    windows: [...windows]
      .filter(([from, rows]) => from + CODING_BUCKET_MS > cutoff && rows.length > 0)
      .sort(([left], [right]) => left - right)
      .map(([from, rows]) => ({ from, agents: sortRows(rows) })),
    coverage: coverage.filter((part) => part.to > cutoff),
  };
}

// 报告首桶可能只覆盖后半截，不能用这份局部计数覆盖已有的完整桶。
export function mergeBucketReport(
  previous: StoredCodingBuckets | null,
  report: CodingTokenBucketReport,
  receivedAt: number,
): StoredCodingBuckets | null {
  if (previous && report.collectedAt < previous.collectedAt) return null;
  const windows = new Map((previous?.windows ?? []).map((window) => [window.from, window.agents.map((row) => ({ ...row }))]));
  for (const from of [...windows.keys()]) {
    if (from >= report.from && from < report.to) windows.delete(from);
  }
  for (const window of report.windows) {
    if (window.from >= report.from) {
      windows.set(window.from, window.agents.map((row) => ({ ...row })));
      continue;
    }
    const kept = new Map((windows.get(window.from) ?? []).map((row) => [rowKey(row), row]));
    for (const row of window.agents) {
      const old = kept.get(rowKey(row));
      if (!old || tokens(row) > tokens(old)) kept.set(rowKey(row), { ...row });
    }
    windows.set(window.from, [...kept.values()]);
  }
  const coverage = mergeCoverage([...(previous?.coverage ?? []), { from: report.from, to: report.to }]);
  return {
    ...retained(windows, coverage, receivedAt),
    agents: report.agents.map((agent) => ({ ...agent })),
    collectedAt: report.collectedAt,
    receivedAt,
  };
}

// 入口接收顺序可能与提交顺序相反，覆盖终点不能随晚提交的旧时刻回退。
export function addBucketDeltas(
  previous: StoredCodingBuckets | null,
  deltas: readonly CodingBucketDelta[],
  committedAt: number,
): StoredCodingBuckets {
  const receivedAt = Math.max(committedAt, previous?.receivedAt ?? 0);
  const windows = new Map((previous?.windows ?? []).map((window) => [window.from, window.agents.map((row) => ({ ...row }))]));
  const ids = new Set((previous?.agents ?? []).map((agent) => agent.id));
  for (const delta of deltas) {
    const from = Math.floor(delta.at / CODING_BUCKET_MS) * CODING_BUCKET_MS;
    const rows = windows.get(from) ?? [];
    let row = rows.find((entry) => entry.id === delta.id && entry.model === delta.model);
    if (!row) {
      row = { id: delta.id, model: delta.model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount: null };
      rows.push(row);
    }
    row.inputTokens += delta.inputTokens;
    row.outputTokens += delta.outputTokens;
    row.cacheReadTokens += delta.cacheReadTokens;
    row.cacheCreationTokens += delta.cacheCreationTokens;
    windows.set(from, rows);
    ids.add(delta.id);
  }
  return {
    ...retained(windows, [], receivedAt),
    agents: [...ids].sort().map((id) => ({ id, state: "partial" as const })),
    collectedAt: receivedAt,
    receivedAt,
  };
}

export function parseStoredCodingBuckets(raw: unknown): StoredCodingBuckets | null {
  if (typeof raw !== "string") return null;
  try {
    const row = JSON.parse(raw) as StoredCodingBuckets;
    if (!row || !Array.isArray(row.coverage) || !Array.isArray(row.windows) || !Array.isArray(row.agents)
      || typeof row.collectedAt !== "number" || typeof row.receivedAt !== "number") return null;
    return row;
  } catch {
    return null;
  }
}

export function coveringPart(coverage: readonly Coverage[], at: number): Coverage | null {
  return coverage.find((part) => part.from <= at && at < part.to) ?? null;
}
