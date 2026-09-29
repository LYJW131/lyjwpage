import {
  CODING_BUCKET_MS,
  type CodingTokenBucketReport,
  type CodingTokenBucketRow,
  type CodingTokenBucketState,
} from "./coding-usage";
import { mergeCoverage, type Coverage } from "./pulse-features";

/**
 * 5 分钟 token 桶在状态核心里的形状（`pulse:token-buckets:<来源>`）与合并规则。同构纯函数：
 * 状态核心写，Pulse 的 Tokens 道、Jev 的 token 证据、D1 归档读。
 *
 * 两种来源两种合并：
 * - Mac、agents 报的是一段范围 `[from, to)` 内的全部桶（缺席的桶 = 0）：范围内以新报告为准，
 *   范围外不动；报告范围并进 `coverage`。覆盖之内没有行 = 0，覆盖之外 = 未知。
 * - 云端 OTLP 只有累计值的差：每个正差值加进它所在的桶，`coverage` 永远是空的 —— 只作正证据，
 *   没有行不代表 0。
 */
export type StoredCodingBuckets = {
  coverage: Coverage[];
  /** 最近一封报告声明的 agent 与完整度；OTLP 是见过的 agent，一律 partial（只有正证据） */
  agents: Array<{ id: string; state: CodingTokenBucketState }>;
  /** 按 from 升序；没有行的桶不存 */
  windows: Array<{ from: number; agents: CodingTokenBucketRow[] }>;
  /** 最近一封被采纳的报告的采集时刻；OTLP 是收到时刻 */
  collectedAt: number;
  receivedAt: number;
  /** 这一份最近一次写入时的 `pulse:token-buckets:revision`（状态核心写入时打上）。D1 归档按它取增量，没有按 0 */
  revision?: number;
};

/** OTLP 一个正差值落进的桶：差值实际覆盖上一次导出到这次之间（约一分钟），桶边界上最多错一分钟 */
export type CodingBucketDelta = Omit<CodingTokenBucketRow, "reasoningTokens" | "eventCount"> & { at: number };

/** Pulse 与 Jev 只看最近 24 小时；多留两小时，报告范围的起点落在窗口外时首桶还在 */
export const CODING_BUCKET_KEEP_MS = 26 * 3_600_000;
/** 来源停报两天整个键清掉 */
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

/**
 * Mac / agents 的一封报告并进已存的桶。
 *
 * 起点在报告范围内的桶整桶换成这封的（包括末尾还在累积的那个：新报告总比旧的数得全）；
 * 报告起点通常不在 5 分钟边界上，跨着起点的那个桶这封只数了后半截，拿它盖掉旧报告里
 * 数全了的同一个桶会少算 —— 那一桶按 (agent, 模型) 取四列合计大的那行。
 *
 * 采集时刻比已存的旧（重发、乱序）就不收，返回 null。
 */
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

/**
 * 云端 OTLP 的正差值加进各自的桶。没有覆盖区间，事件数数不出来（null）。
 * 收到时刻取和存着的较大者：状态核心按提交顺序做差，入口先收到的那封可能后提交，
 * Pulse 拿这个时刻当云端覆盖的终点，不能往回走。
 */
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

/** 读回存着的桶；坏值当没有 */
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

/** `at` 落在哪一段覆盖里；不在任何一段里是 null */
export function coveringPart(coverage: readonly Coverage[], at: number): Coverage | null {
  return coverage.find((part) => part.from <= at && at < part.to) ?? null;
}
