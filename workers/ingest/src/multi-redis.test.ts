import assert from "node:assert/strict";
import test from "node:test";

import type { RedisClient, RedisPipeline } from "../../../src/lib/redis-driver.ts";
import { MultiWorkerRedis, parseRedisUrls } from "./multi-redis.ts";

function createMockRedis(options: {
  getReturn?: string | null;
  setThrow?: boolean;
  delThrow?: boolean;
  pipeThrow?: boolean;
} = {}): {
  client: RedisClient;
  calls: {
    get: string[];
    set: Array<[string, string, ...(string | number)[]]>;
    del: string[];
    lrange: Array<[string, number, number]>;
    disconnected: boolean;
    pipeCommands: Array<[string, ...unknown[]]>;
  };
} {
  const calls = {
    get: [] as string[],
    set: [] as Array<[string, string, ...(string | number)[]]>,
    del: [] as string[],
    lrange: [] as Array<[string, number, number]>,
    disconnected: false,
    pipeCommands: [] as Array<[string, ...unknown[]]>,
  };

  const pipe: RedisPipeline = {
    set: (k, v, ...args) => {
      calls.pipeCommands.push(["SET", k, v, ...args]);
      return pipe;
    },
    del: (k) => {
      calls.pipeCommands.push(["DEL", k]);
      return pipe;
    },
    rpush: (k, ...vals) => {
      calls.pipeCommands.push(["RPUSH", k, ...vals]);
      return pipe;
    },
    ltrim: (k, s, e) => {
      calls.pipeCommands.push(["LTRIM", k, s, e]);
      return pipe;
    },
    pexpire: (k, ms) => {
      calls.pipeCommands.push(["PEXPIRE", k, ms]);
      return pipe;
    },
    hset: (k, obj) => {
      calls.pipeCommands.push(["HSET", k, obj]);
      return pipe;
    },
    hgetall: (k) => {
      calls.pipeCommands.push(["HGETALL", k]);
      return pipe;
    },
    get: (k) => {
      calls.pipeCommands.push(["GET", k]);
      return pipe;
    },
    exec: async () => {
      if (options.pipeThrow) throw new Error("pipe error");
      return [[null, "OK"]];
    },
  };

  const client: RedisClient = {
    get: async (k) => {
      calls.get.push(k);
      return options.getReturn ?? "primary-val";
    },
    set: async (k, v, ...args) => {
      calls.set.push([k, v, ...args]);
      if (options.setThrow) throw new Error("set error");
      return "OK";
    },
    del: async (k) => {
      calls.del.push(k);
      if (options.delThrow) throw new Error("del error");
      return 1;
    },
    lrange: async (k, s, e) => {
      calls.lrange.push([k, s, e]);
      return ["val1", "val2"];
    },
    pipeline: () => pipe,
    disconnect: () => {
      calls.disconnected = true;
    },
  };

  return { client, calls };
}

test("parseRedisUrls 解析单值、多值与空白容错", () => {
  assert.deepEqual(parseRedisUrls(undefined), []);
  assert.deepEqual(parseRedisUrls(""), []);
  assert.deepEqual(parseRedisUrls("redis://single:6379"), ["redis://single:6379"]);
  assert.deepEqual(
    parseRedisUrls("redis://a:6379, rediss://b:6380 , ,redis://c:6379"),
    ["redis://a:6379", "rediss://b:6380", "redis://c:6379"],
  );
});

test("MultiWorkerRedis 读操作只查询 Primary 主库", async () => {
  const primary = createMockRedis({ getReturn: "primary-secret" });
  const mirror = createMockRedis({ getReturn: "mirror-secret" });

  const multi = new MultiWorkerRedis([primary.client, mirror.client]);

  const getResult = await multi.get("key1");
  assert.equal(getResult, "primary-secret");
  assert.deepEqual(primary.calls.get, ["key1"]);
  assert.deepEqual(mirror.calls.get, []);

  const lrangeResult = await multi.lrange("list", 0, -1);
  assert.deepEqual(lrangeResult, ["val1", "val2"]);
  assert.equal(primary.calls.lrange.length, 1);
  assert.equal(mirror.calls.lrange.length, 0);
});

test("MultiWorkerRedis 写操作并发双写主库与镜像库", async () => {
  const primary = createMockRedis();
  const mirror = createMockRedis();

  const multi = new MultiWorkerRedis([primary.client, mirror.client]);

  const setResult = await multi.set("myKey", "myVal", "PX", 1000);
  assert.equal(setResult, "OK");
  assert.deepEqual(primary.calls.set, [["myKey", "myVal", "PX", 1000]]);
  assert.deepEqual(mirror.calls.set, [["myKey", "myVal", "PX", 1000]]);

  const delResult = await multi.del("myKey");
  assert.equal(delResult, 1);
  assert.deepEqual(primary.calls.del, ["myKey"]);
  assert.deepEqual(mirror.calls.del, ["myKey"]);
});

test("MultiWorkerRedis 镜像库写入异常时不阻断主库返回", async () => {
  const primary = createMockRedis();
  const failingMirror = createMockRedis({ setThrow: true, delThrow: true, pipeThrow: true });

  const multi = new MultiWorkerRedis([primary.client, failingMirror.client]);

  // set 不应抛错
  const setResult = await multi.set("myKey", "myVal");
  assert.equal(setResult, "OK");
  assert.equal(primary.calls.set.length, 1);

  // del 不应抛错
  const delResult = await multi.del("myKey");
  assert.equal(delResult, 1);
  assert.equal(primary.calls.del.length, 1);

  // pipeline exec 不应抛错
  const pipe = multi.pipeline();
  pipe.set("k", "v");
  const execResult = await pipe.exec();
  assert.deepEqual(execResult, [[null, "OK"]]);
});

test("MultiWorkerRedis pipeline 广播全部指令且同步 disconnect", async () => {
  const primary = createMockRedis();
  const mirror = createMockRedis();

  const multi = new MultiWorkerRedis([primary.client, mirror.client]);

  const pipe = multi.pipeline();
  pipe
    .set("k1", "v1")
    .del("k2")
    .rpush("list", "item")
    .ltrim("list", 0, 10)
    .pexpire("list", 5000)
    .hset("hash", { f1: "v1" })
    .hgetall("hash")
    .get("k1");

  await pipe.exec();

  assert.equal(primary.calls.pipeCommands.length, 8);
  assert.equal(mirror.calls.pipeCommands.length, 8);

  multi.disconnect();
  assert.equal(primary.calls.disconnected, true);
  assert.equal(mirror.calls.disconnected, true);
});
