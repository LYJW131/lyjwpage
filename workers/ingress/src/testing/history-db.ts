import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type { HistoryDb } from "@shared/history-ingest";

type Statement = { query: string; values: unknown[] };

export function historyDb() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = `${dirname(fileURLToPath(import.meta.url))}/../../../core/migrations/`;
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`${migrations}${file}`, "utf8"));
  }
  let changes = 0;
  const db: HistoryDb = {
    prepare: (query) => {
      const statement: Statement & { bind(...values: unknown[]): typeof statement } = {
        query,
        values: [],
        bind: (...values) => ({ ...statement, values }),
      };
      return statement;
    },
    // 与 D1 的 batch 一样，一条失败整批回滚。
    async batch(statements) {
      sqlite.exec("BEGIN");
      let applied = 0;
      try {
        for (const { query, values } of statements as unknown as Statement[]) {
          applied += Number(sqlite.prepare(query).run(...(values as (string | number | null)[])).changes);
        }
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
      sqlite.exec("COMMIT");
      changes += applied;
      return [];
    },
  };
  return {
    db,
    all: (query: string) => sqlite.prepare(query).all().map((row) => ({ ...row })),
    exec: (query: string) => sqlite.exec(query),
    changes: () => changes,
  };
}
