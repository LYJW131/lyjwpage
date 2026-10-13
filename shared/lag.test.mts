import assert from "node:assert/strict";
import test from "node:test";

import { installLagReader, isLagEntry, LAG_KEYS, readLag, readLagEntry, writeLag, type LagKey, type LagStore } from "./lag.ts";

function fakeKv(initial: Record<string, string> = {}): LagStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    async get(k: string) {
      return map.get(k) ?? null;
    },
    async put(k: string, v: string) {
      map.set(k, v);
    },
  };
}

test("isLagEntry：updatedAt 有限数且 data 键在才认", () => {
  assert.equal(isLagEntry({ updatedAt: 1, data: null }), true);
  assert.equal(isLagEntry({ updatedAt: 1, data: { a: 1 } }), true);
  assert.equal(isLagEntry({ updatedAt: 1 }), false);
  assert.equal(isLagEntry({ data: 1 }), false);
  assert.equal(isLagEntry({ updatedAt: Number.NaN, data: 1 }), false);
  assert.equal(isLagEntry({ updatedAt: "1", data: 1 }), false);
  assert.equal(isLagEntry(null), false);
  assert.equal(isLagEntry([1, 2]), false);
  assert.equal(isLagEntry("x"), false);
});

test("readLag：拿到带形状的条目，坏 JSON 或缺字段当作没有", async () => {
  const kv = fakeKv({
    good: JSON.stringify({ updatedAt: 5, data: { a: 1 } }),
    broken: "{",
    shapeless: JSON.stringify({ updatedAt: 5 }),
    plain: JSON.stringify("str"),
  });
  assert.deepEqual(await readLag(kv, "good" as LagKey), { updatedAt: 5, data: { a: 1 } });
  assert.equal(await readLag(kv, "broken" as LagKey), null);
  assert.equal(await readLag(kv, "shapeless" as LagKey), null);
  assert.equal(await readLag(kv, "plain" as LagKey), null);
  assert.equal(await readLag(kv, "absent" as LagKey), null);
});

test("writeLag 写回 { updatedAt, data } 的 JSON 文本", async () => {
  const kv = fakeKv();
  await writeLag(kv, LAG_KEYS.server, { items: [1, 2] }, 99);
  assert.deepEqual(JSON.parse(kv.map.get(LAG_KEYS.server) ?? ""), { updatedAt: 99, data: { items: [1, 2] } });
});

test("readLagEntry：没装读取器直接抛错，装上后按安装的实现读", async () => {
  installLagReader(null);
  await assert.rejects(readLagEntry(LAG_KEYS.server), /installLagReader/);

  installLagReader(async (key) => (key === LAG_KEYS.server ? { updatedAt: 7, data: "hit" } : null));
  assert.deepEqual(await readLagEntry(LAG_KEYS.server), { updatedAt: 7, data: "hit" });
  assert.equal(await readLagEntry(LAG_KEYS.timezone), null);

  installLagReader(null);
  await assert.rejects(readLagEntry(LAG_KEYS.server), /installLagReader/);
});
