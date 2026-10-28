import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PRIVATE_HISTORY_TABLES, PRIVATE_HISTORY_TABLE_NAMES } from "@shared/private-history";

import { readPrivateHistory } from "./history-read";

function historyDb() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = `${dirname(fileURLToPath(import.meta.url))}/../migrations/`;
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`${migrations}${file}`, "utf8"));
  }
  const db = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async all<T>() { return { results: sqlite.prepare(query).all(...(values as (string | number)[])) as T[] }; },
      };
      return statement;
    },
  } as unknown as Pick<D1Database, "prepare">;
  return { sqlite, db };
}

const play = (startedAt: number, title: string) =>
  [startedAt, startedAt + 180_000, title];

test("every registered table and time column exists in the migrations", async () => {
  const { sqlite, db } = historyDb();
  for (const table of PRIVATE_HISTORY_TABLE_NAMES) {
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((row) => (row as { name: string }).name);
    assert.ok(columns.includes(PRIVATE_HISTORY_TABLES[table].time), table);
    const result = await readPrivateHistory(db, { table, from: 0, to: Date.now(), limit: 1 });
    assert.equal(result.ok, true, table);
  }
});

test("rows come newest first within [from, to) and report truncation", async () => {
  const { sqlite, db } = historyDb();
  const insert = sqlite.prepare("INSERT INTO listening_plays(source, started_at, ended_at, certain, title) VALUES ('mac', ?, ?, 1, ?)");
  for (const row of [play(1_000, "a"), play(2_000, "b"), play(3_000, "c"), play(4_000, "d")]) insert.run(...row);

  const page = await readPrivateHistory(db, { table: "listening_plays", from: 2_000, to: 4_000, limit: 1 });
  assert.deepEqual(page.ok && page.rows.map((row) => row.title), ["c"]);
  assert.equal(page.ok && page.truncated, true);

  const all = await readPrivateHistory(db, { table: "listening_plays", from: 2_000, to: 4_000, limit: 5 });
  assert.deepEqual(all.ok && all.rows.map((row) => row.title), ["c", "b"]);
  assert.equal(all.ok && all.truncated, false);
});

test("day tables include both end days by site day", async () => {
  const { sqlite, db } = historyDb();
  const insert = sqlite.prepare(`INSERT INTO activity_days(date, seconds_from_gmt, move_kcal, move_goal_kcal, exercise_minutes,
    exercise_goal_minutes, stand_hours, stand_goal_hours, received_at) VALUES (?, 28800, 1, 1, 1, 1, 1, 1, 0)`);
  for (const date of ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]) insert.run(date);
  // 2026-10-27 00:00 到 2026-10-29 00:00（UTC+8），不含 29 号。
  const result = await readPrivateHistory(db, { table: "activity_days", from: Date.parse("2026-10-26T16:00:00Z"), to: Date.parse("2026-10-28T16:00:00Z"), limit: 10 });
  assert.deepEqual(result.ok && result.rows.map((row) => row.date), ["2026-10-28", "2026-10-27"]);
});

test("rejects unregistered tables and bad ranges without querying", async () => {
  const db = { prepare() { throw new Error("must not query"); } } as unknown as Pick<D1Database, "prepare">;
  for (const query of [
    { table: "transcripts", from: 0, to: 1, limit: 1 },
    { table: "workouts; DROP TABLE workouts", from: 0, to: 1, limit: 1 },
    { table: "workouts", from: 2, to: 1, limit: 1 },
    { table: "workouts", from: 0, to: 1, limit: 0 },
    { table: "workouts", from: 0, to: 1, limit: 501 },
    null,
  ]) {
    assert.equal((await readPrivateHistory(db, query)).ok, false);
  }
  assert.deepEqual(await readPrivateHistory(undefined, { table: "workouts", from: 0, to: 1, limit: 1 }), { ok: false, error: "The history archive is not bound here." });
});
