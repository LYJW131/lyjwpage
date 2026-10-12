import assert from "node:assert/strict";
import test from "node:test";

import { fieldMirror, getStorage, key, mirrorKey } from "@shared/storage";
import { FakeStorage, installTestStorage } from "@/lib/testing/fake-storage";

test.afterEach(() => {
  installTestStorage(null);
});

test("没装存储时 getStorage 直接抛错", () => {
  installTestStorage(null);
  assert.throws(() => getStorage(), /installStorage/);
});

test("mirrorKey 读写走 Storage", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const k = key("test", "mirror", "rw");
  const mirror = mirrorKey<{ n: number }>(["test", "mirror", "rw"]);

  await mirror.put({ n: 1 });
  assert.equal(await storage.get(k), JSON.stringify({ n: 1 }));
  assert.deepEqual(await mirror.get(), { n: 1 });

  await mirror.drop();
  assert.equal(await storage.get(k), null);
  assert.equal(await mirror.get(), null);
});

test("mirrorKey 读到坏 JSON 时当作没有", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  await storage.set(key("test", "mirror", "bad"), "{");
  assert.equal(await mirrorKey(["test", "mirror", "bad"]).get(), null);
});

test("mirrorKey 写失败时把错误抛给调用方", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  storage.failWhen(() => true);
  await assert.rejects(mirrorKey<{ n: number }>(["test", "mirror", "fail"]).put({ n: 1 }), /injected failure/);
});

test("fieldMirror 按字段合并进 Storage", async () => {
  installTestStorage(new FakeStorage());
  type Sample = { song: string | null; alive: boolean; at: number };
  const overlay = fieldMirror<Sample>(["test", "hash"]);

  assert.equal(await overlay.get(), null);
  await overlay.merge({ song: "a", alive: true, at: 1 }, ["song", "at"]);
  await overlay.merge({ song: "a", alive: false, at: 2 }, ["alive", "at"]);

  assert.deepEqual(await overlay.get(), { song: "a", alive: false, at: 2 });
});
