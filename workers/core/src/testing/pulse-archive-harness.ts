import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { installTestStorage } from "@shared/testing/fake-storage";
import type { HistoryDb } from "@shared/history-ingest";
import { SqliteStore, type SqlDatabase } from "@shared/sqlite-store";
import { StorageClient } from "@shared/storage-client";
import { PulseArchive, PulseArchiveState, type ArchiveStream } from "../pulse-archive.ts";

export const T0 = Date.UTC(2026, 8, 28, 2, 0, 0);
export const M = 60_000;

type Statement = { query: string; values: unknown[] };

export function setup(options: { failStream?: ArchiveStream } = {}) {
  let now = T0;
  const hub = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...args: (string | number | null)[]) {
      if (!args.length && query.includes(";")) { hub.exec(query); return { toArray: () => [], rowsWritten: 0 }; }
      const statement = hub.prepare(query);
      if (statement.columns().length) return { toArray: () => statement.all(...args) as Record<string, unknown>[], rowsWritten: 0 };
      const result = statement.run(...args);
      return { toArray: () => [], rowsWritten: Number(result.changes) };
    },
  } as unknown as SqlDatabase;
  const transaction = <T>(work: () => T): T => {
    hub.exec("BEGIN");
    try { const result = work(); hub.exec("COMMIT"); return result; } catch (error) { hub.exec("ROLLBACK"); throw error; }
  };
  const store = new SqliteStore(sql, transaction, () => now);
  hub.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const storage = new StorageClient(async (commands) => store.execute(commands));
  const state = new PulseArchiveState({ sql: sql as never, execute: (commands) => store.execute(commands), now: () => now });

  const d1 = new DatabaseSync(":memory:");
  const migrations = `${dirname(fileURLToPath(import.meta.url))}/../../migrations/`;
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) d1.exec(readFileSync(`${migrations}${file}`, "utf8"));
  let changes = 0;
  const db: HistoryDb = {
    prepare: (query) => {
      const statement: Statement & { bind(...values: unknown[]): typeof statement } = { query, values: [], bind: (...values) => ({ ...statement, values }) };
      return statement;
    },
    async batch(statements) {
      const list = statements as unknown as Statement[];
      if (options.failStream === "gaming" && list.some((row) => row.query.includes("game_sessions"))) throw new Error("D1 unavailable");
      d1.exec("BEGIN");
      try {
        for (const { query, values } of list) changes += Number(d1.prepare(query).run(...(values as (string | number | null)[])).changes);
        d1.exec("COMMIT");
      } catch (error) { d1.exec("ROLLBACK"); throw error; }
      return [];
    },
  };
  const logged: string[] = [];
  const archive = () => {
    const runner = new PulseArchive({ coordinator: state, db, log: (stream, error) => logged.push(`${stream}: ${error instanceof Error ? error.message : String(error)}`) });
    return { run: async () => runner.run(await state.readPulseArchive()) };
  };
  return {
    storage, state, archive, logged, db,
    at: (t: number) => { now = t; },
    all: (query: string) => d1.prepare(query).all().map((row) => ({ ...row })) as Record<string, unknown>[],
    exec: (query: string) => d1.exec(query),
    changes: () => changes,
    watermark: (stream: ArchiveStream) => (hub.prepare("SELECT value FROM metadata WHERE key = ?").get(`pulse-archive:v2:${stream}`) as { value?: string } | undefined)?.value ?? null,
    async write(run: () => Promise<unknown>) {
      installTestStorage(storage);
      try { await run(); } finally { installTestStorage(null); }
    },
  };
}
