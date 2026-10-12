import assert from "node:assert/strict";
import test from "node:test";

import { cached, get, put, remove } from "@shared/cache";
import { key } from "@shared/storage";
import { FakeStorage, installTestStorage } from "@shared/testing/fake-storage";

test.beforeEach(() => {
  installTestStorage(null);
});

test.afterEach(() => {
  installTestStorage(null);
});

test("get：Storage 说没有就是没有", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  await put("k", { n: 1 }, 60_000);
  assert.deepEqual(await get("k"), { n: 1 });

  await storage.remove(key("cache", "k"));
  assert.equal(await get("k"), undefined);
});

test("put：小数 TTL 向上取整后写入", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  await put("k", { n: 2 }, 1_500.5);
  assert.deepEqual(await get("k"), { n: 2 });
});

test("cached：上游失败后 5 秒负缓存挡住上游", async () => {
  installTestStorage(new FakeStorage());
  let calls = 0;
  const loader = async () => {
    calls += 1;
    throw new Error("上游挂了");
  };

  await assert.rejects(cached("c-neg", 60_000, loader), /上游挂了/);
  await assert.rejects(cached("c-neg", 60_000, loader), /上游挂了/);
  assert.equal(calls, 1);
});

test("remove 之后 Storage 读不到", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  await put("k", "v", 60_000);
  await remove("k");
  assert.equal(await get("k"), undefined);
  assert.equal(await storage.get(key("cache", "k")), null);
});

test("cached：Storage 里被删掉后重新走 loader", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  let calls = 0;
  const loader = async () => ({ n: ++calls });

  assert.deepEqual(await cached("c-del", 60_000, loader), { n: 1 });
  assert.deepEqual(await cached("c-del", 60_000, loader), { n: 1 });

  await storage.remove(key("cache", "c-del"));
  assert.deepEqual(await cached("c-del", 60_000, loader), { n: 2 });
});
