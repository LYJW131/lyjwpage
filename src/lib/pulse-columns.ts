import type { PulseSpanColumns } from "@/lib/types";

/**
 * Pulse 行对象 ⇄ 线上的列。格式与取舍见 types 里的 PulseSpanColumns。
 * 服务端出口用 toColumns，卡片用 columnRows 还原；两边都在这里，改一处就够。
 */

type Row = { startSec: number; endSec: number };
/** 列对象对应的一行：每一列取一个值 */
export type ColumnRow<C> = { [P in keyof C]: C[P] extends readonly (infer V)[] ? V : never };

/** 行 → 列。`keys` 定下列的顺序和范围，行里多出来的字段不出门 */
export function toColumns<R extends Row, K extends keyof R>(rows: R[], keys: readonly K[]): PulseSpanColumns & { [P in K]: R[P][] } {
  const columns = { startSec: rows.map((row) => row.startSec), endSec: rows.map((row) => row.endSec) } as PulseSpanColumns & { [P in K]: R[P][] };
  for (const key of keys) (columns as Record<K, unknown[]>)[key] = rows.map((row) => row[key]);
  return columns;
}

/**
 * 列 → 行。认不出的形状（列缺了、长度对不上）返回 null：站点和 Worker 各自部署，
 * 契约一改中间总有一段拿到另一版载荷，卡片把 null 当没数据，不抛错。
 */
export function columnRows<C extends PulseSpanColumns>(columns: C | null | undefined, keys: readonly Exclude<keyof C, keyof PulseSpanColumns>[]): ColumnRow<C>[] | null {
  if (!columns || typeof columns !== "object") return null;
  const source = columns as Record<string, unknown>;
  const start = source.startSec;
  if (!Array.isArray(start)) return null;
  const all = ["startSec", "endSec", ...keys] as string[];
  if (!all.every((key) => Array.isArray(source[key]) && (source[key] as unknown[]).length === start.length)) return null;
  return start.map((_, index) => Object.fromEntries(all.map((key) => [key, (source[key] as unknown[])[index]])) as ColumnRow<C>);
}
