import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { pulseIntervalRangeKey, pulseKey } from "@/lib/pulse";
import { PULSE_HISTORY_LIMIT } from "@/lib/limits";
import { PULSE_DOMAINS, type PulseDomain, type PulseSample } from "@/lib/types";
import type { StorageCommand } from "@shared/storage-contract";
import {
  PulseArchive,
  PulseArchiveState,
  type ArchiveSql,
  type PulseArchiveDb,
} from "./pulse-archive.ts";

const T0 = 1_760_000_000_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

type Row = [string, number, number, string | null, number | null, number | null];
type Statement = { query: string; values: unknown[] };

function series(count: number, level: 0 | 1 | 2 | 3 = 2): PulseSample[] {
  return Array.from({ length: count }, (_, index) => ({ t: T0 + index * 60_000, level }));
}

function setup(options: {
  lists?: Partial<Record<PulseDomain, PulseSample[]>>;
  raw?: string[];
  failRead?: PulseDomain;
  fail?: (domain: string, attempt: number) => boolean;
  hold?: Promise<unknown> | ((revision: number) => Promise<unknown>);
  activityRange?: { from: number; to: number };
  chunkSize?: number;
  log?: (domain: string, error: unknown) => void;
} = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const sql: ArchiveSql = {
    exec(query, ...bindings) {
      const statement = sqlite.prepare(query);
      if (/^\s*SELECT\b/i.test(query)) return { toArray: () => statement.all(...bindings) as Record<string, unknown>[] };
      statement.run(...bindings);
      return { toArray: () => [] };
    },
  };

  const stored = new Map<string, string[]>();
  for (const [domain, samples] of Object.entries(options.lists ?? {})) {
    stored.set(pulseKey(domain as PulseDomain), samples.map((sample) => JSON.stringify(sample)));
  }
  if (options.activityRange) stored.set(pulseIntervalRangeKey("activity"), [JSON.stringify(options.activityRange)]);
  const readCommands: StorageCommand[] = [];
  const execute = (commands: StorageCommand[]): unknown[] => commands.map((command) => {
    readCommands.push(command);
    if (command.op === "get") return stored.get(command.key)?.[0] ?? null;
    assert.equal(command.op, "listRange");
    if (options.failRead && command.key === pulseKey(options.failRead)) throw new Error("source unavailable");
    const rows = options.raw ?? stored.get(command.key) ?? [];
    return rows.slice(command.start, command.stop + 1);
  });
  const state = new PulseArchiveState({ sql, execute });

  const batches: Row[][] = [];
  const rows = new Map<string, Row>();
  let attempts = 0;
  let activityRevision = 0;
  const archiveDb: PulseArchiveDb = {
    prepare(query) {
      return { bind: (...values: unknown[]) => ({ query, values }) };
    },
    async batch(statements) {
      const prepared = statements as Statement[];
      const attempt = ++attempts;
      const revision = prepared.find((statement) => statement.query.startsWith("INSERT INTO pulse_archive_state"))?.values[0] as number | undefined;
      if (typeof options.hold === "function" && revision != null) await options.hold(revision);
      else if (options.hold) await options.hold;
      const ordinary = prepared.filter((statement) => statement.query.startsWith("INSERT OR IGNORE"))
        .map((statement) => statement.values as Row);
      const domain = ordinary[0]?.[0] ?? "activity";
      if (options.fail?.(domain, attempt)) throw new Error("D1 unavailable");
      if (ordinary.length) {
        batches.push(ordinary);
        for (const row of ordinary) rows.set(`${row[0]}:${row[1]}`, row);
      }
      for (const statement of prepared) {
        if (statement.query.startsWith("INSERT INTO pulse_archive_state")) {
          activityRevision = Math.max(activityRevision, statement.values[0] as number);
        } else if (statement.query.startsWith("DELETE FROM pulse_samples")) {
          const [to, from, revision] = statement.values as number[];
          if (revision === activityRevision) for (const [key, row] of rows) {
            if (row[0] === "activity" && row[1] < to && (row[4] ?? row[1] + 1) > from) rows.delete(key);
          }
        } else if (statement.query.startsWith("INSERT INTO pulse_samples(domain, t")) {
          const [json, revision] = statement.values as [string, number];
          if (revision === activityRevision) for (const sample of JSON.parse(json) as PulseSample[]) {
            rows.set(`activity:${sample.t}`, ["activity", sample.t, sample.level, null, sample.until ?? null, null]);
          }
        }
      }
      return [];
    },
  };

  const logged: string[] = [];
  const makeArchive = () => new PulseArchive({
    coordinator: state,
    db: archiveDb,
    chunkSize: options.chunkSize,
    log: options.log ?? ((domain, error) => logged.push(`${domain}: ${error instanceof Error ? error.message : String(error)}`)),
  });
  return {
    state,
    archive: makeArchive(),
    makeArchive,
    batches,
    logged,
    readCommands,
    rows: () => [...rows.values()].sort((a, b) => a[1] - b[1]),
    setActivity(samples: PulseSample[], range: { from: number; to: number }) {
      stored.set(pulseKey("activity"), samples.map((sample) => JSON.stringify(sample)));
      stored.set(pulseIntervalRangeKey("activity"), [JSON.stringify(range)]);
    },
    seed(domain: PulseDomain, t: number) {
      sqlite.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run(`pulse-archive:${domain}`, String(t));
    },
    watermark(domain: PulseDomain): string | null {
      const row = sqlite.prepare("SELECT value FROM metadata WHERE key = ?").get(`pulse-archive:${domain}`) as { value?: string } | undefined;
      return row?.value ?? null;
    },
  };
}

test("pulse archive: archives fields and reads every source through one bounded snapshot", async () => {
  const world = setup({ lists: {
    coding: [{ t: T0, level: 2, hint: "lyjwpage" }, { t: T0 + 60_000, level: 0 }],
    activity: [{ t: T0, until: T0 + 3_600_000, level: 2 }],
    charging: [{ t: T0, level: 2, powerW: 42.75 }],
  } });
  await world.archive.run();

  assert.deepEqual(world.rows(), [
    ["coding", T0, 2, "lyjwpage", null, null],
    ["charging", T0, 2, null, null, 42.75],
    ["activity", T0, 2, null, T0 + 3_600_000, null],
    ["coding", T0 + 60_000, 0, null, null, null],
  ]);
  assert.equal(world.readCommands.length, PULSE_DOMAINS.length + 1);
  for (const command of world.readCommands) {
    if (command.op === "get") continue;
    assert.equal(command.op, "listRange");
    assert.equal(command.start, 0);
    assert.equal(command.stop, command.key === pulseKey("charging") ? 5999 : PULSE_HISTORY_LIMIT - 1);
  }
  assert.equal(world.watermark("coding"), String(T0 + 60_000));
  assert.deepEqual(world.logged, []);
});

test("pulse archive: empty and malformed sources do not touch D1 or watermarks", async () => {
  const empty = setup();
  await empty.archive.run();
  assert.deepEqual(empty.batches, []);
  for (const domain of PULSE_DOMAINS) assert.equal(empty.watermark(domain), null);

  const malformed = setup({ raw: [
    "not json",
    JSON.stringify({ t: T0, level: 9 }),
    JSON.stringify({ t: "later", level: 1 }),
    JSON.stringify({ t: T0 + 60_000, level: 1 }),
  ] });
  await malformed.archive.run();
  assert.equal(malformed.rows().length, PULSE_DOMAINS.length);
  assert.ok(malformed.rows().every((row) => row[1] === T0 + 60_000));
});

test("pulse archive: repeats only rows beyond the durable watermark", async () => {
  const samples = series(3);
  const first = setup({ lists: { listening: samples } });
  await first.archive.run();
  await first.archive.run();
  assert.equal(first.batches.length, 1);

  const later: PulseSample = { t: T0 + 3 * 60_000, level: 1, hint: "Helpless" };
  const restarted = setup({ lists: { listening: [...samples, later] } });
  restarted.seed("listening", samples[2].t);
  await restarted.archive.run();
  assert.deepEqual(restarted.rows(), [["listening", later.t, 1, "Helpless", null, null]]);
});

test("pulse archive: activity keeps its watermark until the first authoritative history arrives", async () => {
  const world = setup({ lists: { activity: [
    { t: T0, until: T0 + 300_000, level: 1 },
  ] } });
  await world.archive.run();
  await world.archive.run();
  assert.equal(world.batches.length, 1);
  assert.equal(world.watermark("activity"), String(T0));
});

test("pulse archive: confirms each successful chunk and stops at a failed chunk", async () => {
  const world = setup({ lists: { coding: series(250) }, fail: (_domain, attempt) => attempt === 3 });
  await world.archive.run();
  assert.deepEqual(world.batches.map((batch) => batch.length), [100, 100]);
  assert.equal(world.watermark("coding"), String(T0 + 199 * 60_000));
  assert.deepEqual(world.logged, ["coding: D1 unavailable"]);

  await world.archive.run();
  assert.deepEqual(world.batches.map((batch) => batch.length), [100, 100, 50]);
  assert.equal(world.rows().length, 250);
  assert.equal(world.watermark("coding"), String(T0 + 249 * 60_000));
});

test("pulse archive: one domain failure does not block another domain", async () => {
  const world = setup({
    lists: { coding: series(1), watching: series(1, 1), charging: series(1, 3) },
    fail: (domain) => domain === "watching",
  });
  await world.archive.run();
  assert.deepEqual(world.rows().map((row) => row[0]), ["coding", "charging"]);
  assert.equal(world.watermark("watching"), null);
  assert.deepEqual(world.logged, ["watching: D1 unavailable"]);
});

test("pulse archive: one source read failure does not block another domain", async () => {
  const world = setup({
    lists: { coding: series(1), watching: series(1, 1) },
    failRead: "coding",
  });
  await world.archive.run();
  assert.deepEqual(world.rows().map((row) => row[0]), ["watching"]);
  assert.equal(world.watermark("coding"), null);
  assert.equal(world.watermark("watching"), String(T0));
  assert.deepEqual(world.logged, ["coding: source unavailable"]);
});

test("pulse archive: concurrent Worker instances may replay safely and converge", async () => {
  const gate = deferred<void>();
  const world = setup({ lists: { gaming: series(2, 3) }, hold: gate.promise });
  const first = world.archive.run();
  const second = world.makeArchive().run();
  await new Promise((resolve) => setTimeout(resolve, 1));
  gate.resolve();
  await Promise.all([first, second]);

  assert.equal(world.batches.length, 2, "both snapshots may write the same idempotent D1 batch");
  assert.equal(world.rows().length, 2, "(domain,t) uniqueness collapses the replay");
  assert.equal(world.watermark("gaming"), String(T0 + 60_000));
});

test("pulse archive: newer authoritative activity deletion wins when an older snapshot finishes late", async () => {
  const oldGate = deferred<void>();
  const range = { from: T0, to: T0 + 3_600_000 };
  const world = setup({
    lists: { activity: [
      { t: T0 - 3_600_000, until: T0 + 300_000, level: 2 },
      { t: T0 + 600_000, until: T0 + 900_000, level: 3 },
    ] },
    activityRange: range,
    hold: (revision) => revision === 1 ? oldGate.promise : Promise.resolve(),
  });
  const oldRun = world.archive.run();
  await new Promise((resolve) => setTimeout(resolve, 1));
  world.setActivity([], range);
  await world.makeArchive().run();
  oldGate.resolve();
  await oldRun;

  assert.deepEqual(world.rows().filter((row) => row[0] === "activity"), []);
});

test("pulse archive: late confirmations advance by max and never move backward", async () => {
  const world = setup();
  assert.equal(await world.state.confirmPulseArchive("coding", T0 + 120_000), T0 + 120_000);
  assert.equal(await world.state.confirmPulseArchive("coding", T0 + 60_000), T0 + 120_000);
  assert.equal(await world.state.confirmPulseArchive("coding", T0 + 180_000), T0 + 180_000);
  assert.equal(world.watermark("coding"), String(T0 + 180_000));
});
