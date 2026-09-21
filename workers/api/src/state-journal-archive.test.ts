import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { StorageClient } from "@shared/storage-client";
import type { StorageCommand } from "@shared/storage-contract";
import { JOURNAL_SUBJECTS, journalKey, type JournalSubject } from "@shared/state-journal";
import type { ArchiveSql, PulseArchiveDb } from "./pulse-archive.ts";

import { StateJournalArchive } from "./state-journal-archive.ts";

/**
 * 状态存档守的是「没落地的变更不能记成已归档」。水位线在真 SQLite 上，
 * D1 只记录每条 bind 过的值。
 */

type Row = [string, number, number, string];

function setup(options: {
  lists?: Partial<Record<JournalSubject, { t: number; at?: number; state: unknown }[]>>;
  rawLists?: Partial<Record<JournalSubject, string[]>>;
  fail?: (subject: string) => boolean;
  chunkSize?: number;
} = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const sql: ArchiveSql = {
    exec(query, ...bindings) {
      const statement = db.prepare(query);
      if (/^\s*SELECT\b/i.test(query)) return { toArray: () => statement.all(...bindings) as Record<string, unknown>[] };
      statement.run(...bindings);
      return { toArray: () => [] };
    },
  };
  const stored = new Map<string, string[]>();
  for (const [subject, entries] of Object.entries(options.lists ?? {})) {
    stored.set(journalKey(subject as JournalSubject), entries.map((entry) => JSON.stringify({
      t: entry.t,
      at: entry.at ?? entry.t,
      state: entry.state,
    })));
  }
  for (const [subject, rows] of Object.entries(options.rawLists ?? {})) {
    stored.set(journalKey(subject as JournalSubject), rows);
  }
  let reads = 0;
  const storage = new StorageClient(async (commands: StorageCommand[]) => commands.map((command) => {
    assert.equal(command.op, "listRange");
    reads += 1;
    return stored.get(command.key) ?? [];
  }));
  const batches: Row[][] = [];
  const archiveDb: PulseArchiveDb = {
    prepare(query) {
      assert.match(query, /^INSERT OR IGNORE INTO state_changes\b/);
      return { bind: (...values: unknown[]) => values as Row };
    },
    async batch(statements) {
      const rows = statements as Row[];
      if (options.fail?.(rows[0][0])) throw new Error("D1 unavailable");
      batches.push(rows);
      return [];
    },
  };
  const logged: string[] = [];
  const archive = new StateJournalArchive({
    sql,
    db: archiveDb,
    storage,
    chunkSize: options.chunkSize,
    log: (subject, error) => logged.push(`${subject}: ${error instanceof Error ? error.message : String(error)}`),
  });
  return {
    archive,
    batches,
    logged,
    reads: () => reads,
    rows: () => batches.flat(),
    watermark(subject: JournalSubject): string | null {
      const row = db.prepare("SELECT value FROM metadata WHERE key = ?").get(`state-journal:${subject}`) as { value?: string } | undefined;
      return row?.value ?? null;
    },
  };
}

test("state journal archive writes the new rows and stops the watermark on the largest t", async () => {
  const world = setup({ lists: { desktop: [
    { t: 10, state: { applicationName: "Cursor" } },
    { t: 20, at: 19, state: { applicationName: "Zed" } },
  ] } });
  await world.archive.run();
  assert.deepEqual(world.rows(), [
    ["desktop", 10, 10, JSON.stringify({ applicationName: "Cursor" })],
    ["desktop", 20, 19, JSON.stringify({ applicationName: "Zed" })],
  ]);
  assert.equal(world.watermark("desktop"), "20");
  assert.deepEqual(world.logged, []);
  assert.equal(world.reads(), JOURNAL_SUBJECTS.length);
});

test("state journal archive does not touch D1 when nothing is pending", async () => {
  const world = setup();
  await world.archive.run();
  assert.deepEqual(world.batches, []);
  assert.equal(world.watermark("listening"), null);
});

test("state journal archive retries a failed batch without moving the watermark", async () => {
  let broken = true;
  const world = setup({
    lists: { server: [{ t: 5, state: { cpuUsagePercent: 1 } }, { t: 6, state: { cpuUsagePercent: 2 } }] },
    fail: () => broken,
  });
  await world.archive.run();
  assert.equal(world.watermark("server"), null);
  assert.deepEqual(world.logged, ["server: D1 unavailable"]);
  broken = false;
  await world.archive.run();
  assert.equal(world.rows().length, 2);
  assert.equal(world.watermark("server"), "6");
});

test("state journal archive keeps going when one subject fails", async () => {
  const world = setup({
    lists: {
      desktop: [{ t: 1, state: { applicationName: "Cursor" } }],
      charger: [{ t: 2, state: { connected: false } }],
    },
    fail: (subject) => subject === "desktop",
  });
  await world.archive.run();
  assert.deepEqual(world.rows().map((row) => row[0]), ["charger"]);
  assert.equal(world.watermark("desktop"), null);
  assert.equal(world.watermark("charger"), "2");
});

test("state journal archive advances the watermark per chunk and skips corrupt rows", async () => {
  const chunked = setup({
    chunkSize: 2,
    lists: { activity: [1, 2, 3, 4, 5].map((t) => ({ t, state: { steps: t } })) },
  });
  await chunked.archive.run();
  assert.deepEqual(chunked.batches.map((chunk) => chunk.length), [2, 2, 1]);
  assert.equal(chunked.watermark("activity"), "5");

  const world = setup({ rawLists: { activity: [
    "{",
    JSON.stringify({ t: 1, at: 1, state: { steps: 1 } }),
    JSON.stringify({ t: 3, at: 3, state: { steps: 3 } }),
  ] } });
  await world.archive.run();
  assert.deepEqual(world.rows().map((row) => row[1]), [1, 3]);
  assert.equal(world.watermark("activity"), "3");
  assert.deepEqual(world.logged, []);
});
