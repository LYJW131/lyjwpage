import assert from "node:assert/strict";
import test from "node:test";

import { RECOVERY_DELAYS_MS, RECOVERY_FORGET_MS, createFaultLedger, describeFault, primeCardCache } from "./card-recovery.ts";

test("反复崩：自动重试的间隔逐步放长，用完之后不再自动试", () => {
  const ledger = createFaultLedger();
  const seen = [0, 1, 2, 3, 4].map((step) => ledger.record("Pulse", "boom", step * 1_000).retryInMs);
  assert.deepEqual(seen, [...RECOVERY_DELAYS_MS, null, null]);
  assert.equal(ledger.record("Pulse", "boom", 6_000).attempt, RECOVERY_DELAYS_MS.length, "attempt 是崩溃之前已经自动试过几次");
});

test("同一张卡同样的错在一轮里只报一次，换了错误或换了卡照报", () => {
  const ledger = createFaultLedger();
  assert.equal(ledger.record("Pulse", "boom", 0).report, true);
  assert.equal(ledger.record("Pulse", "boom", 20_000).report, false);
  assert.equal(ledger.record("Pulse", "another failure", 40_000).report, true);
  assert.equal(ledger.record("Activity", "boom", 40_000).report, true);
});

test("各张卡各算各的，一张卡用完重试不影响别的卡", () => {
  const ledger = createFaultLedger();
  for (let step = 0; step < 6; step += 1) ledger.record("Pulse", "boom", step);
  assert.equal(ledger.record("Pulse", "boom", 10).retryInMs, null);
  assert.equal(ledger.record("Activity", "boom", 10).retryInMs, RECOVERY_DELAYS_MS[0]);
});

test("隔了足够久没再崩，上一轮就算结束：重试次数和上报去重都从头算", () => {
  const ledger = createFaultLedger();
  for (let step = 0; step < 5; step += 1) ledger.record("Pulse", "boom", step * 1_000);
  const later = ledger.record("Pulse", "boom", 4_000 + RECOVERY_FORGET_MS + 1);
  assert.equal(later.retryInMs, RECOVERY_DELAYS_MS[0]);
  assert.equal(later.report, true);
  assert.equal(later.attempt, 0);
});

test("一轮里只要还在崩，就一直算同一轮（遗忘的钟是从最近一次崩溃起算）", () => {
  const ledger = createFaultLedger();
  ledger.record("Pulse", "boom", 0);
  ledger.record("Pulse", "boom", RECOVERY_FORGET_MS - 1);
  const third = ledger.record("Pulse", "boom", RECOVERY_FORGET_MS * 2 - 2);
  assert.equal(third.report, false);
  assert.equal(third.attempt, 2);
});

test("describeFault：Error 取 message，字符串照用，别的转成字符串，并截断", () => {
  assert.equal(describeFault(new TypeError("x is not a function")), "x is not a function");
  assert.equal(describeFault("plain"), "plain");
  assert.equal(describeFault({ code: 1 }), "[object Object]");
  assert.equal(describeFault(undefined), "undefined");
  assert.equal(describeFault(new Error("a".repeat(500))).length, 200);
});

type Envelope = { ok: boolean; data?: string };

/** 一份假的 SWR 缓存：Retry 之后重新挂载时，卡片读缓存、没有才用首屏那份 */
function fakeCache(initial: Record<string, Envelope | undefined>) {
  const cache = new Map(Object.entries(initial));
  return {
    cache,
    write: (path: string, value: Envelope | undefined) => {
      if (value === undefined) cache.delete(path);
      else cache.set(path, value);
    },
  };
}

test("重试前先取一份此刻的数据写进缓存：让卡崩的就是首屏那份时，只清缓存救不回来", async () => {
  const poisoned: Envelope = { ok: true, data: "poisoned first screen" };
  const world = fakeCache({ "/api/status/pulse": poisoned, "/api/status/coding": poisoned });
  const fetched: string[] = [];
  await primeCardCache(["/api/status/pulse", "/api/status/coding"], {
    isStatusPath: (path) => path.startsWith("/api/status/"),
    read: async (path) => {
      fetched.push(path);
      return { ok: true, data: `fresh ${path}` };
    },
    write: world.write,
  });
  assert.deepEqual([...fetched].sort(), ["/api/status/coding", "/api/status/pulse"]);
  // 重新挂载读到的是缓存里的新数据，不是首屏那份
  assert.deepEqual(world.cache.get("/api/status/pulse"), { ok: true, data: "fresh /api/status/pulse" });
  assert.deepEqual(world.cache.get("/api/status/coding"), { ok: true, data: "fresh /api/status/coding" });
});

test("不是状态端点的键（版本接口）不去取，只清掉缓存", async () => {
  const world = fakeCache({ "/api/version": { ok: true, data: "old" } });
  let reads = 0;
  await primeCardCache(["/api/version"], {
    isStatusPath: () => false,
    read: async () => {
      reads += 1;
      return { ok: true };
    },
    write: world.write,
  });
  assert.equal(reads, 0);
  assert.equal(world.cache.has("/api/version"), false);
});

test("取不到就退回清缓存：抛错、降级信封、超时都一样，别的键不受影响，而且不会一直等", async () => {
  const world = fakeCache({
    "/api/status/throws": { ok: true, data: "stale" },
    "/api/status/degraded": { ok: true, data: "stale" },
    "/api/status/hangs": { ok: true, data: "stale" },
    "/api/status/fine": { ok: true, data: "stale" },
  });
  const started = Date.now();
  await primeCardCache(["/api/status/throws", "/api/status/degraded", "/api/status/hangs", "/api/status/fine"], {
    isStatusPath: () => true,
    read: (path) => {
      if (path.endsWith("throws")) return Promise.reject(new Error("Request failed: 502"));
      if (path.endsWith("degraded")) return Promise.resolve({ ok: false });
      if (path.endsWith("hangs")) return new Promise<Envelope>(() => {});
      return Promise.resolve({ ok: true, data: "fresh" });
    },
    write: world.write,
    timeoutMs: 30,
  });
  assert.ok(Date.now() - started < 1_000, "卡住的那个键按超时算，不拖住整个重试");
  assert.deepEqual([...world.cache.keys()], ["/api/status/fine"]);
  assert.deepEqual(world.cache.get("/api/status/fine"), { ok: true, data: "fresh" });
});

test("没有要读的键（Timezone 这类卡）什么都不做", async () => {
  const world = fakeCache({});
  await primeCardCache([], {
    isStatusPath: () => true,
    read: async () => {
      throw new Error("should not be called");
    },
    write: world.write,
  });
  assert.equal(world.cache.size, 0);
});
