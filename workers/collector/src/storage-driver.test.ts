import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

// Node 下 `@/lib/storage-driver` 解析到站点的测试驱动；把 KV 版的 StorageClient 注进去，
// src/lib/cache 就原样跑在采集 Worker 的存储语义上
import { cached, get, put, remove } from "@/lib/cache";
import { installStorageForTests, resetStorageDriverForTests } from "@/lib/storage-driver";

import type { Env } from "./env";
import { bindEnv, unbindEnvForTests } from "./runtime";
import { getStorage, kvStorage, kvTtlSeconds } from "./storage-driver";
import { MemoryKv } from "./testing/memory-kv";

afterEach(() => {
  resetStorageDriverForTests();
  unbindEnvForTests();
});

test("get, set with TTL, ifAbsent and remove map onto KV", async () => {
  let now = 1_000_000;
  const kv = new MemoryKv(() => now);
  const storage = kvStorage(kv);

  assert.equal(await storage.get("a"), null);
  assert.equal(await storage.set("a", "1"), true);
  assert.equal(await storage.get("a"), "1");
  assert.equal(kv.puts.at(-1)?.expirationTtl, undefined);

  // 已有值时 ifAbsent 不写，返回 false；没有时写入
  assert.equal(await storage.set("a", "2", { ifAbsent: true }), false);
  assert.equal(await storage.get("a"), "1");
  assert.equal(await storage.set("b", "x", { ifAbsent: true, ttlMs: 120_500 }), true);
  assert.equal(kv.puts.at(-1)?.expirationTtl, 121);

  now += 121_000;
  assert.equal(await storage.get("b"), null);

  assert.equal(await storage.remove("a"), 1);
  assert.equal(await storage.get("a"), null);
});

test("KV TTLs round up to whole seconds with a 60 second floor", () => {
  assert.equal(kvTtlSeconds(5_000), 60);
  assert.equal(kvTtlSeconds(60_000), 60);
  assert.equal(kvTtlSeconds(60_001), 61);
  assert.equal(kvTtlSeconds(86_400_000), 86_400);
});

test("list and hash operations fail loudly instead of pretending", async () => {
  const storage = kvStorage(new MemoryKv());
  await assert.rejects(storage.listRange("l", 0, -1), /不支持 listRange/);
  await assert.rejects(storage.batch().append("l", "x").execute(), /不支持 append/);
  await assert.rejects(storage.batch().patch("h", { a: "1" }).execute(), /不支持 patch/);
});

test("a batch runs in order so later commands see earlier writes", async () => {
  const storage = kvStorage(new MemoryKv());
  const results = await storage.batch().set("k", "v").get("k").remove("k").get("k").execute();
  assert.deepEqual(results, [true, "v", 1, null]);
});

test("src/lib/cache works unchanged on top of the KV driver", async () => {
  const kv = new MemoryKv();
  installStorageForTests(kvStorage(kv));

  await put("thing", { n: 1 }, 30 * 60_000);
  assert.deepEqual(await get("thing"), { n: 1 });
  assert.ok(kv.raw(`${process.env.STORAGE_PREFIX ?? "lyjwpage"}:cache:thing`));
  assert.equal(kv.puts.at(-1)?.expirationTtl, 1_800);

  let loads = 0;
  const loader = async () => { loads += 1; return "fresh"; };
  assert.equal(await cached("value", 60_000, loader), "fresh");
  assert.equal(await cached("value", 60_000, loader), "fresh");
  assert.equal(loads, 1);

  await remove("thing");
  assert.equal(await get("thing"), undefined);
});

test("the Worker driver reads COLLECTOR_KV from the bound env", async () => {
  const kv = new MemoryKv();
  bindEnv({ COLLECTOR_KV: kv.asKv() } as Env);
  await getStorage().set("x", "y");
  assert.equal(kv.raw("x"), "y");
});
