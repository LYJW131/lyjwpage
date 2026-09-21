import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteStore } from "@shared/sqlite-store";
import { parseCommands } from "@shared/storage-contract";

function database() {
  const db = new DatabaseSync(":memory:");
  let now = 1000;
  const sql = {
    exec(query, ...args) {
      if (!args.length && query.includes(";")) { db.exec(query); return { toArray: () => [], rowsWritten: 0 }; }
      const statement = db.prepare(query);
      if (statement.columns().length) { const rows = statement.all(...args); return { toArray: () => rows, rowsWritten: 0 }; }
      const result = statement.run(...args);
      return { toArray: () => [], rowsWritten: Number(result.changes) };
    },
  };
  const transaction = work => {
    db.exec("BEGIN");
    try { const result = work(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  return { store: new SqliteStore(sql, transaction, () => now), advance: ms => now += ms, db };
}

test("SQLite：TTL 与条件写入原子生效，过期键能再次领取", () => {
  const { store, advance, db } = database();
  const claim = { op: "set", key: "gate", value: "1", options: { ttlMs: 100, ifAbsent: true } };
  assert.deepEqual(store.execute([claim, claim]), [true, false]);
  advance(100);
  assert.deepEqual(store.execute([{ op: "get", key: "gate" }, claim]), [null, true]);
  db.close();
});

test("SQLite：字段更新保留其它模块，批量写失败回滚整批", () => {
  const { store, db } = database();
  store.execute([{ op: "patch", key: "state", fields: { music: '"a"', alive: "true" } }]);
  store.execute([{ op: "patch", key: "state", fields: { alive: "false" } }]);
  assert.deepEqual(store.execute([{ op: "fields", key: "state" }]), [{ music: '"a"', alive: "false" }]);
  assert.throws(() => store.execute([
    { op: "set", key: "other", value: "new" },
    { op: "append", key: "state", values: ["invalid"] },
  ]), /type mismatch/);
  assert.deepEqual(store.execute([{ op: "get", key: "other" }]), [null]);
  db.close();
});

test("SQLite：历史追加、负索引裁剪与列表过期", () => {
  const { store, advance, db } = database();
  store.execute([
    { op: "append", key: "history", values: ["1", "2", "3", "4"] },
    { op: "trim", key: "history", start: -2, stop: -1 },
    { op: "expire", key: "history", ttlMs: 100 },
  ]);
  assert.deepEqual(store.execute([{ op: "listRange", key: "history", start: 0, stop: -1 }]), [["3", "4"]]);
  advance(100);
  assert.equal(store.purgeExpired(), 1);
  assert.deepEqual(store.execute([{ op: "listRange", key: "history", start: 0, stop: -1 }]), [[]]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM samples").get().n, 0);
  db.close();
});

test("SQLite：非负列表范围由 LIMIT 自然截断", () => {
  const { store, db } = database();
  store.execute([{ op: "append", key: "history", values: ["1", "2", "3", "4"] }]);
  assert.deepEqual(store.execute([
    { op: "listRange", key: "history", start: 1, stop: 2 },
    { op: "listRange", key: "history", start: 0, stop: 99 },
    { op: "listRange", key: "history", start: 4, stop: 9 },
    { op: "listRange", key: "history", start: 3, stop: 1 },
  ]), [["2", "3"], ["1", "2", "3", "4"], [], []]);
  db.close();
});

test("SQLite：首尾列表范围按逻辑位置处理断洞与越界", () => {
  const { store, db } = database();
  store.execute([{ op: "append", key: "history", values: ["1", "2", "3", "4", "5", "6"] }]);
  db.exec("DELETE FROM samples WHERE key = 'history' AND seq IN (2, 5)");
  assert.deepEqual(store.execute([
    { op: "listRange", key: "history", start: 0, stop: -1 },
    { op: "listRange", key: "history", start: 2, stop: -1 },
    { op: "listRange", key: "history", start: 9, stop: -1 },
    { op: "listRange", key: "history", start: -1, stop: -1 },
    { op: "listRange", key: "history", start: -3, stop: -1 },
    { op: "listRange", key: "history", start: -9, stop: -2 },
    { op: "listRange", key: "history", start: -3, stop: -2 },
    { op: "listRange", key: "history", start: -1, stop: -3 },
  ]), [
    ["1", "3", "4", "6"], ["4", "6"], [], ["6"],
    ["3", "4", "6"], ["1", "3", "4"], ["3", "4"], [],
  ]);
  db.close();
});

test("SQLite：尾部裁剪保留逻辑末尾并清理空列表条目", () => {
  const { store, db } = database();
  store.execute([{ op: "append", key: "history", values: ["1", "2", "3", "4", "5", "6"] }]);
  db.exec("DELETE FROM samples WHERE key = 'history' AND seq IN (2, 5)");
  store.execute([{ op: "trim", key: "history", start: -2, stop: -1 }]);
  assert.deepEqual(store.execute([{ op: "listRange", key: "history", start: 0, stop: -1 }]), [["4", "6"]]);

  store.execute([{ op: "append", key: "short", values: ["a", "b"] }]);
  store.execute([{ op: "trim", key: "short", start: -5, stop: -1 }]);
  assert.deepEqual(store.execute([{ op: "listRange", key: "short", start: 0, stop: -1 }]), [["a", "b"]]);

  db.exec("INSERT INTO entries(key, kind) VALUES ('empty', 'list')");
  store.execute([{ op: "trim", key: "empty", start: -5, stop: -1 }]);
  assert.equal(db.prepare("SELECT key FROM entries WHERE key = 'empty'").get(), undefined);
  db.close();
});

test("SQLite：尾部裁剪在同批后续失败时回滚", () => {
  const { store, db } = database();
  store.execute([
    { op: "append", key: "history", values: ["1", "2", "3"] },
    { op: "patch", key: "state", fields: { alive: "true" } },
  ]);
  assert.throws(() => store.execute([
    { op: "trim", key: "history", start: -1, stop: -1 },
    { op: "append", key: "state", values: ["invalid"] },
  ]), /type mismatch/);
  assert.deepEqual(store.execute([{ op: "listRange", key: "history", start: 0, stop: -1 }]), [["1", "2", "3"]]);
  db.close();
});

test("SQLite：迁移保留 TTL、历史、凭据且不覆盖新上报", () => {
  const { store, advance, db } = database();
  store.execute([{ op: "set", key: "fresh", value: "live" }]);
  assert.equal(store.importMissing([
    { key: "fresh", kind: "string", value: "old", expiresAt: null },
    { key: "credential", kind: "string", value: "synthetic-token", expiresAt: null },
    { key: "history", kind: "list", value: ["a", "b"], expiresAt: 1100 },
    { key: "dead", kind: "string", value: "expired", expiresAt: 999 },
  ]), 2);
  advance(100);
  assert.deepEqual(store.execute([{ op: "get", key: "fresh" }, { op: "get", key: "credential" }, { op: "listRange", key: "history", start: 0, stop: -1 }]), ["live", "synthetic-token", []]);
  db.close();
});

test("SQLite：索引字符串与成员值在同一事务内更新", () => {
  const { store, advance, db } = database();
  assert.deepEqual(store.updateIndexedString("index", "a", "value:a", '{"ok":true}', 100), ["a"]);
  assert.deepEqual(store.updateIndexedString("index", "b", "value:b", '{"ok":true}', 100), ["a", "b"]);
  assert.deepEqual(store.updateIndexedString("index", "a", "value:a", null, 100), ["b"]);
  assert.deepEqual(store.execute([
    { op: "get", key: "index" },
    { op: "get", key: "value:a" },
    { op: "get", key: "value:b" },
  ]), ['["b"]', null, '{"ok":true}']);
  advance(100);
  assert.deepEqual(store.execute([{ op: "get", key: "index" }, { op: "get", key: "value:b" }]), [null, null]);
  db.close();
});

test("存储协议拒绝 SQL、无效操作、非法 TTL", () => {
  assert.throws(() => parseCommands([{ op: "sql", key: "lyjwpage:a", sql: "DROP TABLE entries" }]));
  assert.throws(() => parseCommands([{ op: "set", key: "x", value: "x", options: { ttlMs: -1 } }]));
});
