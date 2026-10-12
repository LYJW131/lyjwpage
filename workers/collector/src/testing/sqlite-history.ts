import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type { HistoryDb } from "@shared/history-ingest";

type Statement = { query: string; values: unknown[] };
type Value = string | number | null;

export function historyDb() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = `${dirname(fileURLToPath(import.meta.url))}/../../../api/migrations/`;
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`${migrations}${file}`, "utf8"));
  }
  let changes = 0;
  const batches: number[] = [];
  const statement = (query: string, values: unknown[]) => ({
    query,
    values,
    bind: (...next: unknown[]) => statement(query, next),
    all: async <T>() => ({ results: sqlite.prepare(query).all(...(values as Value[])).map((row) => ({ ...row })) as T[] }),
  });
  const db = {
    prepare: (query: string) => statement(query, []),
    async batch(statements: unknown[]) {
      batches.push(statements.length);
      sqlite.exec("BEGIN");
      for (const { query, values } of statements as Statement[]) {
        changes += Number(sqlite.prepare(query).run(...(values as Value[])).changes);
      }
      sqlite.exec("COMMIT");
      return [];
    },
  } satisfies HistoryDb;
  return { db, all: (query: string) => sqlite.prepare(query).all().map((row) => ({ ...row })), changes: () => changes, batches };
}
