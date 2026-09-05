import assert from "node:assert/strict";
import test from "node:test";

import {
  askRedis,
  installRedisForTests,
  key,
  mirrorKey,
  overlayHashKey,
  resetRedisForTests,
  tellRedis,
} from "@/lib/redis";
import { FakeRedis } from "@/lib/testing/fake-redis";

test.beforeEach(() => {
  resetRedisForTests();
});

test.afterEach(() => {
  resetRedisForTests();
});

test("askRedis 在 Redis 可达时带回值", async () => {
  const redis = new FakeRedis();
  installRedisForTests(redis);
  await redis.set("k", "v");

  const answered = await askRedis((client) => client.get("k"));
  assert.deepEqual(answered, { reachable: true, value: "v" });
});

test("askRedis 在命令抛错时答不可达", async () => {
  const redis = new FakeRedis();
  installRedisForTests(redis);
  redis.setUnreachable();

  const answered = await askRedis((client) => client.get("k"));
  assert.deepEqual(answered, { reachable: false });
});

test("askRedis 在没注入客户端时答不可达", async () => {
  installRedisForTests(null);
  const answered = await askRedis((client) => client.get("k"));
  assert.deepEqual(answered, { reachable: false });
});

test("tellRedis 可达时返回 true，命令抛错时返回 false", async () => {
  const redis = new FakeRedis();
  installRedisForTests(redis);

  assert.equal(await tellRedis((client) => client.set("k", "v")), true);
  assert.equal(await redis.get("k"), "v");

  redis.setUnreachable();
  assert.equal(await tellRedis((client) => client.set("k", "z")), false);
});

test("mirrorKey 可达时读写走 Redis", async () => {
  const redis = new FakeRedis();
  installRedisForTests(redis);
  const k = key("test", "mirror", "rw");
  const mirror = mirrorKey<{ n: number; at: number }>(["test", "mirror", "rw"], (value) => value.at);

  await mirror.put({ n: 1, at: 10 });
  assert.equal(await redis.get(k), JSON.stringify({ n: 1, at: 10 }));
  assert.deepEqual(await mirror.get(), { n: 1, at: 10 });

  await mirror.drop();
  assert.equal(await redis.get(k), null);
  assert.equal(await mirror.get(), null);
});

test("mirrorKey 不可达时退回内存镜像", async () => {
  const redis = new FakeRedis();
  installRedisForTests(redis);
  const mirror = mirrorKey<{ n: number; at: number }>(
    ["test", "mirror", "memory"],
    (value) => value.at,
  );

  await mirror.put({ n: 1, at: 10 });
  redis.setUnreachable();
  await mirror.put({ n: 2, at: 20 });

  assert.deepEqual(await mirror.get(), { n: 2, at: 20 });
  redis.setUnreachable(false);
  assert.equal(await redis.get(key("test", "mirror", "memory")), JSON.stringify({ n: 1, at: 10 }));
});

test("mirrorKey 写没落进去时挡住 Redis 里的旧值", async () => {
  const redis = new FakeRedis();
  installRedisForTests(redis);
  const mirror = mirrorKey<{ n: number; at: number }>(
    ["test", "mirror", "stale"],
    (value) => value.at,
  );

  await mirror.put({ n: 1, at: 10 });
  redis.setUnreachable();
  await mirror.put({ n: 2, at: 20 });
  redis.setUnreachable(false);

  assert.deepEqual(await mirror.get(), { n: 2, at: 20 });
});

test("overlayHashKey 可达时按字段合并进 Redis", async () => {
  const redis = new FakeRedis();
  installRedisForTests(redis);
  type Sample = { song: string | null; alive: boolean; at: number };
  const overlay = overlayHashKey<Sample>(["test", "hash"], ["test", "blob"], (value) => value.at);

  await overlay.merge({ song: "a", alive: true, at: 1 }, ["song", "at"]);
  await overlay.merge({ song: "a", alive: false, at: 2 }, ["alive", "at"]);

  assert.deepEqual(await overlay.get(), { song: "a", alive: false, at: 2 });
  assert.deepEqual(JSON.parse((await redis.get(key("test", "blob"))) ?? "null"), {
    song: "a",
    alive: false,
    at: 2,
  });
});

test("overlayHashKey 不可达时退回内存镜像", async () => {
  const redis = new FakeRedis();
  installRedisForTests(redis);
  type Sample = { song: string | null; at: number };
  const overlay = overlayHashKey<Sample>(
    ["test", "hash-mem"],
    ["test", "blob-mem"],
    (value) => value.at,
  );

  await overlay.merge({ song: "a", at: 1 }, ["song", "at"]);
  redis.setUnreachable();
  await overlay.merge({ song: "b", at: 2 }, ["song", "at"]);

  assert.deepEqual(await overlay.get(), { song: "b", at: 2 });
});
