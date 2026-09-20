import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { pulseKey } from "@/lib/pulse";
import { PULSE_DOMAINS, type PulseDomain, type PulseSample } from "@/lib/types";
import { StorageClient } from "@shared/storage-client";
import type { StorageCommand } from "@shared/storage-contract";
import { PulseArchive, type ArchiveSql, type PulseArchiveDb } from "./pulse-archive.ts";

/**
 * 归档器守的是「只增不删的备份不能丢样本，也不能把没落地的样本记成已归档」。
 *
 * 水位线放在 StateHub 自己的 `metadata` 表里（真表，node:sqlite）；D1 那侧只有最小
 * 结构接口，用假实现记下每条 bind 过的值和分块边界。
 */

const T0 = 1_760_000_000_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

/** 一条 `INSERT OR IGNORE` 绑定过的五个值。 */
type Row = [string, number, number, string | null, number | null];

function series(count: number, level: 0 | 1 | 2 | 3 = 2): PulseSample[] {
  return Array.from({ length: count }, (_, index) => ({ t: T0 + index * 60_000, level }));
}

function setup(options: {
  lists?: Partial<Record<PulseDomain, PulseSample[]>>;
  /** 绕过 JSON 编码，直接给原始行，用来喂坏数据。 */
  raw?: string[];
  fail?: (domain: string) => boolean;
  hold?: Promise<unknown>;
  chunkSize?: number;
  log?: (domain: string, error: unknown) => void;
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

  // 按真实键回答：域名或前缀拼错就读到空列表，测试会立刻发现。
  const stored = new Map<string, string[]>();
  for (const [domain, samples] of Object.entries(options.lists ?? {})) {
    stored.set(pulseKey(domain as PulseDomain), samples.map((sample) => JSON.stringify(sample)));
  }
  let reads = 0;
  const storage = new StorageClient(async (commands: StorageCommand[]) => commands.map((command) => {
    assert.equal(command.op, "listRange");
    reads++;
    return options.raw ?? stored.get(command.key) ?? [];
  }));

  const batches: Row[][] = [];
  const archiveDb: PulseArchiveDb = {
    prepare(query) {
      assert.match(query, /^INSERT OR IGNORE INTO pulse_samples\b/);
      return { bind: (...values: unknown[]) => values as Row };
    },
    async batch(statements) {
      const rows = statements as Row[];
      if (options.hold) await options.hold;
      if (options.fail?.(rows[0][0])) throw new Error("D1 unavailable");
      batches.push(rows);
      return [];
    },
  };

  const logged: string[] = [];
  const archive = new PulseArchive({
    sql,
    db: archiveDb,
    storage,
    chunkSize: options.chunkSize,
    log: options.log ?? ((domain, error) => logged.push(`${domain}: ${error instanceof Error ? error.message : String(error)}`)),
  });
  return {
    archive, batches, logged,
    reads: () => reads,
    rows: () => batches.flat(),
    /** 模拟上一轮 cron 留下的水位线。 */
    seed(domain: PulseDomain, t: number) {
      db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run(`pulse-archive:${domain}`, String(t));
    },
    watermark(domain: PulseDomain): string | null {
      const row = db.prepare("SELECT value FROM metadata WHERE key = ?").get(`pulse-archive:${domain}`) as { value?: string } | undefined;
      return row?.value ?? null;
    },
  };
}

test("pulse archive: 新样本写进 D1，水位线停在最大的 t", async () => {
  const world = setup({ lists: {
    coding: [{ t: T0, level: 2, hint: "lyjwpage" }, { t: T0 + 60_000, level: 0 }],
  } });
  await world.archive.run();

  // hint 有无都要落库，缺 hint 必须是显式 null：D1 对 undefined 抛 D1_TYPE_ERROR。
  assert.deepEqual(world.rows(), [
    ["coding", T0, 2, "lyjwpage", null],
    ["coding", T0 + 60_000, 0, null, null],
  ]);
  assert.equal(world.batches.length, 1);
  assert.equal(world.watermark("coding"), String(T0 + 60_000));
  assert.deepEqual(world.logged, []);
  // 六域都读了一遍，空的那五域没碰 D1。
  assert.equal(world.reads(), PULSE_DOMAINS.length);
});

test("pulse archive: 空序列是空操作，一次 D1 调用都不发", async () => {
  const world = setup();
  await world.archive.run();
  assert.deepEqual(world.batches, []);
  assert.deepEqual(world.logged, []);
  for (const domain of PULSE_DOMAINS) assert.equal(world.watermark(domain), null);
});

test("pulse archive: 再跑一遍不重复插入，只补水位线之后的那几条", async () => {
  const samples = series(3);
  const world = setup({ lists: { listening: samples } });
  await world.archive.run();
  assert.equal(world.rows().length, 3);

  world.batches.length = 0;
  await world.archive.run();
  assert.deepEqual(world.batches, [], "水位线之后没有新样本就不该再发语句");

  const later: PulseSample = { t: T0 + 3 * 60_000, level: 1, hint: "Helpless" };
  const next = setup({ lists: { listening: [...samples, later] } });
  next.seed("listening", samples[samples.length - 1].t);
  await next.archive.run();
  assert.deepEqual(next.rows(), [["listening", later.t, 1, "Helpless", null]]);
  assert.equal(next.watermark("listening"), String(later.t));
});

test("pulse archive: batch 失败不动水位线，下一轮整段重试", async () => {
  let broken = true;
  const world = setup({ lists: { gaming: series(2, 3) }, fail: () => broken });
  await world.archive.run();

  assert.deepEqual(world.batches, []);
  assert.equal(world.watermark("gaming"), null, "没落地就不能记成已归档");
  assert.deepEqual(world.logged, ["gaming: D1 unavailable"]);

  broken = false;
  await world.archive.run();
  assert.equal(world.rows().length, 2);
  assert.equal(world.watermark("gaming"), String(T0 + 60_000));
});

test("pulse archive: 一域出错不挡别的域", async () => {
  const world = setup({
    lists: { coding: series(1), watching: series(1, 1), charging: series(1, 3) },
    fail: (domain) => domain === "watching",
  });
  await world.archive.run();

  assert.deepEqual(world.rows().map((row) => row[0]), ["coding", "charging"]);
  assert.equal(world.watermark("coding"), String(T0));
  assert.equal(world.watermark("charging"), String(T0));
  assert.equal(world.watermark("watching"), null);
  assert.deepEqual(world.logged, ["watching: D1 unavailable"]);
});

test("pulse archive: 超过 100 条分块发送，水位线按块推进", async () => {
  const world = setup({ lists: { coding: series(250) } });
  await world.archive.run();

  assert.deepEqual(world.batches.map((chunk) => chunk.length), [100, 100, 50]);
  assert.equal(world.rows().length, 250);
  assert.equal(world.watermark("coding"), String(T0 + 249 * 60_000));
});

test("pulse archive: 分块中途失败，水位线停在最后一块成功处", async () => {
  let sent = 0;
  const world = setup({ lists: { coding: series(250) }, fail: () => ++sent > 2 });
  await world.archive.run();

  assert.equal(world.batches.length, 2);
  assert.equal(world.watermark("coding"), String(T0 + 199 * 60_000));
  assert.deepEqual(world.logged, ["coding: D1 unavailable"]);
});

test("pulse archive: 两次 cron 撞上时只跑一趟", async () => {
  const gate = deferred<void>();
  const world = setup({ lists: { coding: series(2) }, hold: gate.promise });
  const first = world.archive.run();
  const second = world.archive.run();
  gate.resolve();
  await Promise.all([first, second]);

  assert.equal(world.batches.length, 1);
  assert.equal(world.rows().length, 2);
});

test("pulse archive: 坏行跳过，不废掉整条序列", async () => {
  const world = setup({
    raw: [
      "not json",
      JSON.stringify({ t: T0, level: 9 }),
      JSON.stringify({ t: "later", level: 1 }),
      JSON.stringify({ t: T0 + 60_000, level: 1 }),
    ],
    log: () => assert.fail("坏行不是错误"),
  });
  await world.archive.run();

  // 六域读的是同一份原始列表，每域各只留下那一条好样本。
  assert.equal(world.rows().length, PULSE_DOMAINS.length);
  assert.ok(world.rows().every((row) => row[1] === T0 + 60_000 && row[2] === 1 && row[3] === null));
});

test("pulse archive: physical activity retains its interval end", async () => {
  const world = setup({ lists: { activity: [{ t: T0, until: T0 + 3_600_000, level: 2 }] } });
  await world.archive.run();
  assert.deepEqual(world.rows(), [["activity", T0, 2, null, T0 + 3_600_000]]);
});
