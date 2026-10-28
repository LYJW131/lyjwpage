import { siteDay } from "@shared/history-ingest";
import {
  PRIVATE_HISTORY_MAX_ROWS,
  PRIVATE_HISTORY_TABLES,
  isPrivateHistoryTable,
  type PrivateHistoryQuery,
  type PrivateHistoryResult,
} from "@shared/private-history";
import { object } from "@shared/json";

type HistoryReader = Pick<D1Database, "prepare">;

function parseQuery(raw: unknown): PrivateHistoryQuery | string {
  const query = object(raw);
  if (!query || !isPrivateHistoryTable(query.table)) return "Unknown table.";
  const { from, to, limit } = query;
  if (typeof from !== "number" || typeof to !== "number" || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return "from and to must be epoch milliseconds with from < to.";
  }
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > PRIVATE_HISTORY_MAX_ROWS) {
    return `limit must be an integer from 1 to ${PRIVATE_HISTORY_MAX_ROWS}.`;
  }
  return { table: query.table, from, to, limit: limit as number };
}

export async function readPrivateHistory(db: HistoryReader | undefined, raw: unknown): Promise<PrivateHistoryResult> {
  const query = parseQuery(raw);
  if (typeof query === "string") return { ok: false, error: query };
  if (!db) return { ok: false, error: "The history archive is not bound here." };
  const { time, unit } = PRIVATE_HISTORY_TABLES[query.table];
  // 表名与列名只来自登记表，值全部绑定。
  const range = unit === "day" ? `${time} >= ?1 AND ${time} <= ?2` : `${time} >= ?1 AND ${time} < ?2`;
  const bounds = unit === "day" ? [siteDay(query.from), siteDay(query.to - 1)] : [query.from, query.to];
  const { results } = await db
    .prepare(`SELECT * FROM ${query.table} WHERE ${range} ORDER BY ${time} DESC LIMIT ?3`)
    .bind(...bounds, query.limit + 1)
    .all<Record<string, unknown>>();
  return { ok: true, rows: results.slice(0, query.limit), truncated: results.length > query.limit };
}
