import type { PulseSpanColumns } from "@/lib/types";


type Row = { startSec: number; endSec: number };
export type ColumnRow<C> = { [P in keyof C]: C[P] extends readonly (infer V)[] ? V : never };

export function toColumns<R extends Row, K extends keyof R>(rows: R[], keys: readonly K[]): PulseSpanColumns & { [P in K]: R[P][] } {
  const columns = { startSec: rows.map((row) => row.startSec), endSec: rows.map((row) => row.endSec) } as PulseSpanColumns & { [P in K]: R[P][] };
  for (const key of keys) (columns as Record<K, unknown[]>)[key] = rows.map((row) => row[key]);
  return columns;
}

// 站点与 Worker 独立部署时可能短暂收到另一版形状；不兼容列返回 null，避免整页崩溃。
export function columnRows<C extends PulseSpanColumns>(columns: C | null | undefined, keys: readonly Exclude<keyof C, keyof PulseSpanColumns>[]): ColumnRow<C>[] | null {
  if (!columns || typeof columns !== "object") return null;
  const source = columns as Record<string, unknown>;
  const start = source.startSec;
  if (!Array.isArray(start)) return null;
  const all = ["startSec", "endSec", ...keys] as string[];
  if (!all.every((key) => Array.isArray(source[key]) && (source[key] as unknown[]).length === start.length)) return null;
  return start.map((_, index) => Object.fromEntries(all.map((key) => [key, (source[key] as unknown[])[index]])) as ColumnRow<C>);
}
