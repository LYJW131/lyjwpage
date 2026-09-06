import assert from "node:assert/strict";
import test from "node:test";

import type { RedisClient, RedisPipeline } from "../../../src/lib/redis-driver.ts";
import { MultiWorkerRedis, parseRedisUrls } from "./multi-redis.ts";

function createMockRedis(options: {
  getReturn?: string | null;
  setThrow?: boolean;
  delThrow?: boolean;
  pipeThrow?: boolean;
  pipeExecResult?: [Error | null, unknown][];
} = {}): {
  client: RedisClient;
  calls: {
    get: string[];
    set: Array<[string, string, ...(string | number)[]]>;
    del: string[];
    lrange: Array<[string, number, number]>;
    disconnected: boolean;
    pipeCommands: Array<[string, ...unknown[]]>;
    pipeExecs: number;
  };
} {
  const calls = {
    get: [] as string[],
    set: [] as Array<[string, string, ...(string | number)[]]>,
    del: [] as string[],
    lrange: [] as Array<[string, number, number]>,
    disconnected: false,
    pipeCommands: [] as Array<[string, ...unknown[]]>,
    pipeExecs: 0,
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
      calls.pipeExecs += 1;
      if (options.pipeThrow) throw new Error("pipe error");
      return options.pipeExecResult ?? [[null, "OK"]];
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

test("MultiWorkerRedis 只读 pipeline 不碰镜像库", async () => {
  const primary = createMockRedis();
  const mirror = createMockRedis({ pipeThrow: true });

  const multi = new MultiWorkerRedis([primary.client, mirror.client]);
  const pipe = multi.pipeline();
  pipe.hgetall("hash").get("blob");
  const execResult = await pipe.exec();

  assert.deepEqual(execResult, [[null, "OK"]]);
  assert.deepEqual(primary.calls.pipeCommands, [
    ["HGETALL", "hash"],
    ["GET", "blob"],
  ]);
  assert.equal(primary.calls.pipeExecs, 1);
  assert.deepEqual(mirror.calls.pipeCommands, []);
  assert.equal(mirror.calls.pipeExecs, 0);
});

test("MultiWorkerRedis pipeline 只把写复制到镜像且同步 disconnect", async () => {
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

  assert.deepEqual(primary.calls.pipeCommands, [
    ["SET", "k1", "v1"],
    ["DEL", "k2"],
    ["RPUSH", "list", "item"],
    ["LTRIM", "list", 0, 10],
    ["PEXPIRE", "list", 5000],
    ["HSET", "hash", { f1: "v1" }],
    ["HGETALL", "hash"],
    ["GET", "k1"],
  ]);
  assert.deepEqual(mirror.calls.pipeCommands, [
    ["SET", "k1", "v1"],
    ["DEL", "k2"],
    ["RPUSH", "list", "item"],
    ["LTRIM", "list", 0, 10],
    ["PEXPIRE", "list", 5000],
    ["HSET", "hash", { f1: "v1" }],
  ]);

  multi.disconnect();
  assert.equal(primary.calls.disconnected, true);
  assert.equal(mirror.calls.disconnected, true);
});

test("MultiWorkerRedis pipeline 镜像单条命令失败会被记录，不影响主库结果", async () => {
  const primary = createMockRedis();
  // ioredis 形状：exec() 正常 resolve，失败的命令表示为 [error, null]，不会 reject
  const mirror = createMockRedis({ pipeExecResult: [[new Error("READONLY"), null]] });

  const logs: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };

  try {
    const multi = new MultiWorkerRedis([primary.client, mirror.client]);
    const pipe = multi.pipeline();
    pipe.set("k", "v");
    const execResult = await pipe.exec();

    assert.deepEqual(execResult, [[null, "OK"]]);
    assert.equal(mirror.calls.pipeExecs, 1);
  } finally {
    console.error = originalConsoleError;
  }

  assert.ok(
    logs.some((args) => args.some((arg) => typeof arg === "string" && arg.includes("READONLY"))),
    "镜像 pipeline 单条命令失败应被记录到日志",
  );
});

/** 站点 overlay：blob 打底，每个 hash 域盖上去。 */
function overlayHashBlob(
  hash: Record<string, string>,
  blob: string | null,
): Record<string, unknown> {
  const base = blob ? (JSON.parse(blob) as Record<string, unknown>) : {};
  const next = { ...base };
  for (const [field, value] of Object.entries(hash)) {
    next[field] = JSON.parse(value);
  }
  return next;
}

function createStoreRedis(label: string, options: { failNextExec?: boolean } = {}): {
  client: RedisClient;
  hashes: Map<string, Map<string, string>>;
  strings: Map<string, string>;
} {
  const hashes = new Map<string, Map<string, string>>();
  const strings = new Map<string, string>();
  let failNextExec = options.failNextExec ?? false;

  const applyDel = (key: string) => {
    hashes.delete(key);
    strings.delete(key);
  };
  const applyHset = (key: string, object: Record<string, string>) => {
    let hash = hashes.get(key);
    if (!hash) {
      hash = new Map();
      hashes.set(key, hash);
    }
    for (const [field, value] of Object.entries(object)) hash.set(field, value);
  };

  const client: RedisClient = {
    get: async (key) => strings.get(key) ?? null,
    set: async (key, value) => {
      strings.set(key, value);
      return "OK";
    },
    del: async (key) => {
      const had = hashes.has(key) || strings.has(key);
      applyDel(key);
      return had ? 1 : 0;
    },
    lrange: async () => [],
    pipeline: () => {
      const commands: Array<() => unknown> = [];
      const pipe: RedisPipeline = {
        set: (key, value) => {
          commands.push(() => strings.set(key, value));
          return pipe;
        },
        del: (key) => {
          commands.push(() => applyDel(key));
          return pipe;
        },
        rpush: () => pipe,
        ltrim: () => pipe,
        pexpire: () => pipe,
        hset: (key, object) => {
          commands.push(() => applyHset(key, object));
          return pipe;
        },
        hgetall: (key) => {
          commands.push(() => Object.fromEntries(hashes.get(key) ?? []));
          return pipe;
        },
        get: (key) => {
          commands.push(() => strings.get(key) ?? null);
          return pipe;
        },
        exec: async () => {
          if (failNextExec) {
            failNextExec = false;
            throw new Error(`${label} pipeline failed`);
          }
          return commands.map((command): [Error | null, unknown] => [null, command()]);
        },
      };
      return pipe;
    },
    disconnect: () => undefined,
  };

  return { client, hashes, strings };
}

test("镜像换歌成功后再到只带时间戳的心跳，不能抹掉 music", async () => {
  const hashK = "telemetry:fields";
  const blobK = "telemetry:state";
  const oldSong = { music: "old", at: 1 };
  const staleHeartbeat = { music: "old", at: 3 };

  const primary = createStoreRedis("primary");
  const mirror = createStoreRedis("mirror");
  primary.hashes.set(hashK, new Map([["music", JSON.stringify("old")], ["at", "1"]]));
  mirror.hashes.set(hashK, new Map([["music", JSON.stringify("old")], ["at", "1"]]));
  await primary.client.set(blobK, JSON.stringify(oldSong));
  await mirror.client.set(blobK, JSON.stringify(oldSong));

  const multi = new MultiWorkerRedis([primary.client, mirror.client]);

  const songPipe = multi.pipeline();
  songPipe.hset(hashK, { music: JSON.stringify("new"), at: "2" }).hgetall(hashK).get(blobK);
  await songPipe.exec();
  const beatPipe = multi.pipeline();
  beatPipe.hset(hashK, { at: "3" }).hgetall(hashK).get(blobK);
  await beatPipe.exec();
  await multi.set(blobK, JSON.stringify(staleHeartbeat));

  const mirrorHash = Object.fromEntries(mirror.hashes.get(hashK) ?? []);
  assert.deepEqual(overlayHashBlob(mirrorHash, mirror.strings.get(blobK) ?? null), {
    music: "new",
    at: 3,
  });
});
