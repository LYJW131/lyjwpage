import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EsaCooldown } from "@api/esa-cooldown";
import type { SqlDatabase } from "@shared/sqlite-store";

function fixture() {
  const db = new DatabaseSync(":memory:");
  const sql: SqlDatabase = { exec(query, ...bindings) {
    const stmt = db.prepare(query);
    const args = bindings.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
    if (stmt.columns().length) return { toArray: () => stmt.all(...args) as Record<string, string | number | null>[], rowsWritten: 0 };
    const result = stmt.run(...args);
    return { toArray: () => [], rowsWritten: Number(result.changes) };
  } };
  let now = 1_000;
  const sent: number[] = [], scheduled: number[] = [];
  const create = (purge = async () => { sent.push(now); }) => new EsaCooldown(sql, async (at) => { scheduled.push(at); }, purge, () => now);
  return { db, sent, scheduled, create, at: (value: number) => { now = value; } };
}

test("ESA 全局 30 秒冷却，突发合并并在没有新上报时补发", async () => {
  const f = fixture();
  try {
    const gate = f.create();
    await Promise.all(Array.from({ length: 20 }, () => gate.request()));
    assert.deepEqual(f.sent, [1000]);
    assert.ok(f.scheduled.every(at => at === 31000));
    f.at(30999); await gate.flush(); assert.equal(f.sent.length, 1);
    f.at(31000); await gate.flush(); assert.deepEqual(f.sent, [1000, 31000]);
    f.at(61000); await gate.flush(); assert.equal(f.sent.length, 2);
  } finally { f.db.close(); }
});

test("冷却与待刷新状态跨对象重建保留，重复 alarm 不会重复发送", async () => {
  const f = fixture();
  try {
    await f.create().request();
    f.at(2000); await f.create().request();
    const restarted = f.create();
    f.at(31000); await Promise.all([restarted.flush(), restarted.flush()]);
    assert.deepEqual(f.sent, [1000, 31000]);
    f.at(40000); await restarted.request();
    assert.equal(f.scheduled.at(-1), 61000);
  } finally { f.db.close(); }
});

test("发送未完成及失败时仍遵守间隔，期间的新变化保留待发", async () => {
  const f = fixture();
  try {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const gate = f.create(async () => { f.sent.push(1000); await waiting; throw new Error("network"); });
    const first = gate.request();
    await gate.request(); assert.equal(f.sent.length, 1);
    release(); await assert.rejects(first, /network/);
    f.at(31000); await f.create().flush();
    assert.deepEqual(f.sent, [1000, 31000]);
  } finally { f.db.close(); }
});
