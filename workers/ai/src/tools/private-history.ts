import {
  PRIVATE_HISTORY_MAX_ROWS,
  PRIVATE_HISTORY_TABLES,
  PRIVATE_HISTORY_TABLE_NAMES,
  isPrivateHistoryTable,
  type PrivateHistoryQuery,
  type PrivateHistoryResult,
} from "@shared/private-history";
import { site } from "@shared/site";

import { clockLine, localTime, localTimes, STATUS_TIME_ZONE } from "./local-time";
import type { SiteTool } from "./registry";

export type ReadHistory = (query: PrivateHistoryQuery) => Promise<PrivateHistoryResult>;

const DEFAULT_DAYS = 7;
const DEFAULT_ROWS = 100;
const DAY_MS = 86_400_000;

const WITH_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;

// 不带时区的时间按站点时区读：模型给的「10 月 1 日」指的是 lyjw 那边的日子。
function zoneOffsetMs(at: number): number {
  return Date.parse(`${localTime(at).replace(" ", "T")}:00Z`) - Math.floor(at / 60_000) * 60_000;
}

export function parseHistoryTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (WITH_OFFSET.test(text)) {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : null;
  }
  if (!LOCAL_TIME.test(text)) return null;
  const asUtc = Date.parse(text.length === 10 ? `${text}T00:00:00Z` : `${text}Z`);
  return Number.isFinite(asUtc) ? asUtc - zoneOffsetMs(asUtc) : null;
}

export function parseHistoryInput(input: unknown, now: number): PrivateHistoryQuery | string {
  const { table, from, to, limit } = (input ?? {}) as Record<string, unknown>;
  if (!isPrivateHistoryTable(table)) return "Unknown table; the valid tables are listed in the tool description.";
  const toMs = to === undefined ? now : parseHistoryTime(to);
  const fromMs = from === undefined ? (toMs ?? now) - DEFAULT_DAYS * DAY_MS : parseHistoryTime(from);
  if (fromMs === null || toMs === null) return "from and to must be ISO dates or times, like 2026-10-01 or 2026-10-01T08:00.";
  if (fromMs >= toMs) return "from must be earlier than to.";
  const rows = limit === undefined ? DEFAULT_ROWS : limit;
  if (!Number.isInteger(rows) || (rows as number) < 1 || (rows as number) > PRIVATE_HISTORY_MAX_ROWS) {
    return `limit must be a whole number from 1 to ${PRIVATE_HISTORY_MAX_ROWS}.`;
  }
  return { table, from: fromMs, to: toMs, limit: rows as number };
}

// 列名 snake_case 转 camelCase，好让 localTimes 认出 …At 时间列；charging_samples 和 coding_observations 的时间列只叫 t，改叫 observedAt。
const fieldName = (column: string) => (column === "t" ? "observedAt" : column.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()));

export function historyText(query: PrivateHistoryQuery, result: PrivateHistoryResult, now: number): string {
  if (!result.ok) return `${clockLine(now)}\n\n${result.error}`;
  const rows = result.rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([column, value]) => {
      const key = fieldName(column);
      return [key, localTimes(key, value, now)];
    })),
  );
  const range = `${localTime(query.from)} to ${localTime(query.to)} (${STATUS_TIME_ZONE}, to excluded)`;
  const notes = [
    `${rows.length} rows from ${query.table}, ${range}, newest first.`,
    result.truncated && `More rows exist in this range: narrow it, or call again with to set to the oldest row's time.`,
  ].filter(Boolean);
  return [clockLine(now), notes.join(" "), JSON.stringify(rows)].join("\n\n");
}

export const PRIVATE_HISTORY_TOOL: SiteTool = {
  name: "read_private_history",
  title: `Read ${site.shortName}'s private history`,
  description: [
    `Read ${site.shortName}'s long-term history archive, which the public site does not show. Only ${site.shortName}'s own GitHub account can sign in to use it; without that sign-in every call fails.`,
    `from and to are ISO dates or times; without an offset they are ${STATUS_TIME_ZONE} local time. from is included, to is excluded. Defaults: the last ${DEFAULT_DAYS} days, ${DEFAULT_ROWS} rows, newest first.`,
    "Tables:",
    ...PRIVATE_HISTORY_TABLE_NAMES.map((name) => `- ${name}: ${PRIVATE_HISTORY_TABLES[name].about}`),
  ].join("\n"),
  requiresSignIn: true,
  inputSchema: {
    type: "object",
    properties: {
      table: { type: "string", enum: PRIVATE_HISTORY_TABLE_NAMES, description: "Which history table to read" },
      from: { type: "string", description: "Start of the range, included (ISO date or time)" },
      to: { type: "string", description: "End of the range, excluded (ISO date or time); defaults to now" },
      limit: { type: "integer", minimum: 1, maximum: PRIVATE_HISTORY_MAX_ROWS, description: `Most rows to return, default ${DEFAULT_ROWS}` },
    },
    required: ["table"],
    additionalProperties: false,
  },
  async run(input, { readHistory }) {
    if (!readHistory) return { text: `Sign in with ${site.shortName}'s GitHub account to read the private history.`, isError: true };
    const now = Date.now();
    const query = parseHistoryInput(input, now);
    if (typeof query === "string") return { text: query, isError: true };
    const result = await readHistory(query);
    return { text: historyText(query, result, now), isError: !result.ok };
  },
};
