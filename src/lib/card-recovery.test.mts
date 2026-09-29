import assert from "node:assert/strict";
import test from "node:test";

import { RECOVERY_DELAYS_MS, RECOVERY_FORGET_MS, createFaultLedger, describeFault, primeCardCache } from "./card-recovery.ts";
import { acceptPush, guardPolled, writeGeneration } from "./status-reads.ts";
import { STATUS_VIEWS, viewKeyByPath } from "./status-views.ts";
import type { StatusResponse } from "./types.ts";

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

/** 和 lib/status-reads 的 writeGeneration 同一个约定：推送、取回的响应落进缓存时推进这个键的代次 */
function fakeGenerations() {
  const counts = new Map<string, number>();
  return {
    of: (path: string) => counts.get(path) ?? 0,
    bump: (path: string) => counts.set(path, (counts.get(path) ?? 0) + 1),
  };
}

/** 没有任何更新、卡片一直挂着：不受这两项影响的用例用它 */
const untouched = { generation: () => 0, cancelled: () => false };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    ...untouched,
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
    ...untouched,
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
    ...untouched,
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
    ...untouched,
  });
  assert.equal(world.cache.size, 0);
});

test("清缓存后的回源失败不打断其他键，也不会让 Retry 的异步任务拒绝", async () => {
  const writes: string[] = [];
  await primeCardCache(["/api/status/fails", "/api/status/fine"], {
    isStatusPath: () => false,
    read: async () => { throw new Error("should not read"); },
    write: async (path) => {
      writes.push(path);
      if (path.endsWith("fails")) throw new Error("revalidation failed");
    },
    ...untouched,
  });
  assert.deepEqual(writes, ["/api/status/fails", "/api/status/fine"]);
});

test("清缓存后的回源一直挂起时，本轮 Retry 仍及时结束", async () => {
  const pending = new Promise<void>(() => {});
  await Promise.race([
    primeCardCache(["/api/status/hangs"], {
      isStatusPath: () => false,
      read: async () => { throw new Error("should not read"); },
      write: () => pending,
      ...untouched,
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Retry stayed busy")), 100)),
  ]);
});

test("取数途中这个键已经收到更新（推送、别的卡的轮询）：慢响应不再盖上去，别的键照常写", async () => {
  const busy = "/api/status/watching/now";
  const calm = "/api/status/server";
  const poisoned: Envelope = { ok: true, data: "poisoned first screen" };
  const world = fakeCache({ [busy]: poisoned, [calm]: poisoned });
  const generations = fakeGenerations();
  const responses = { [busy]: deferred<Envelope>(), [calm]: deferred<Envelope>() };
  const running = primeCardCache([busy, calm], {
    isStatusPath: () => true,
    read: (path) => responses[path as typeof busy].promise,
    write: world.write,
    generation: generations.of,
    cancelled: () => false,
  });
  // 取数途中，busy 这个键被推送写进了更新的值（推送路径同时推进它的代次）
  const pushed: Envelope = { ok: true, data: "pushed, newer" };
  world.write(busy, pushed);
  generations.bump(busy);
  responses[busy].resolve({ ok: true, data: "slow stale response" });
  responses[calm].resolve({ ok: true, data: "fresh server" });
  await running;
  assert.deepEqual(world.cache.get(busy), pushed);
  assert.deepEqual(world.cache.get(calm), { ok: true, data: "fresh server" });
});

test("取不到、要退回清缓存的键：取数途中已被写过更新的值，就不清，别把刚落地的新值清掉", async () => {
  const path = "/api/status/watching/now";
  const world = fakeCache({ [path]: { ok: true, data: "poisoned first screen" } });
  const generations = fakeGenerations();
  const response = deferred<Envelope>();
  const running = primeCardCache([path], {
    isStatusPath: () => true,
    read: () => response.promise,
    write: world.write,
    generation: generations.of,
    cancelled: () => false,
  });
  const pushed: Envelope = { ok: true, data: "pushed, newer" };
  world.write(path, pushed);
  generations.bump(path);
  response.reject(new Error("Request failed: 502"));
  await running;
  assert.deepEqual(world.cache.get(path), pushed);
});

test("代次按发起那一刻算：发起之前的更新不挡这次写入", async () => {
  const path = "/api/status/server";
  const world = fakeCache({ [path]: { ok: true, data: "poisoned first screen" } });
  const generations = fakeGenerations();
  generations.bump(path);
  generations.bump(path);
  await primeCardCache([path], {
    isStatusPath: () => true,
    read: async () => ({ ok: true, data: "fresh" }),
    write: world.write,
    generation: generations.of,
    cancelled: () => false,
  });
  assert.deepEqual(world.cache.get(path), { ok: true, data: "fresh" });
});

test("发起重试的卡片卸载之后什么都不写：回来的响应不写，取不到退回的清缓存也不做，超时也一样", async () => {
  const stale: Envelope = { ok: true, data: "poisoned first screen" };
  const paths = ["/api/status/arrives", "/api/status/fails", "/api/status/hangs"];
  const world = fakeCache(Object.fromEntries(paths.map((path) => [path, stale])));
  const arrives = deferred<Envelope>();
  const fails = deferred<Envelope>();
  let mounted = true;
  const running = primeCardCache(paths, {
    isStatusPath: () => true,
    read: (path) => (path.endsWith("arrives") ? arrives.promise : path.endsWith("fails") ? fails.promise : new Promise<Envelope>(() => {})),
    write: world.write,
    generation: () => 0,
    cancelled: () => !mounted,
    timeoutMs: 30,
  });
  mounted = false;
  arrives.resolve({ ok: true, data: "arrives after unmount" });
  fails.reject(new Error("Request failed: 502"));
  await running;
  for (const path of paths) assert.deepEqual(world.cache.get(path), stale, path);
});

test("两趟重试碰上同一个键：先落地的那份写了并推进代次，后到的不再盖", async () => {
  const path = "/api/status/server";
  const world = fakeCache({ [path]: { ok: true, data: "poisoned first screen" } });
  const generations = fakeGenerations();
  const first = deferred<Envelope>();
  const second = deferred<Envelope>();
  const start = (response: Promise<Envelope>) =>
    primeCardCache([path], {
      isStatusPath: () => true,
      read: () => response,
      // 真实的写入（lib/status-reads 的 guardPolled）会推进代次
      write: (key, value) => {
        world.write(key, value);
        if (value) generations.bump(key);
      },
      generation: generations.of,
      cancelled: () => false,
    });
  const runs = [start(first.promise), start(second.promise)];
  first.resolve({ ok: true, data: "first response" });
  await runs[0];
  second.resolve({ ok: true, data: "second response, arrived later" });
  await runs[1];
  assert.deepEqual(world.cache.get(path), { ok: true, data: "first response" });
});

/** 组件里的接线：读原始响应，写之前过 guardPolled，代次取 status-reads 那本账 */
function wired(world: Map<string, StatusResponse<unknown>>, read: () => Promise<StatusResponse<unknown>>, cancelled = () => false) {
  return {
    isStatusPath: (path: string) => viewKeyByPath(path) !== undefined,
    read,
    write: (path: string, value: StatusResponse<unknown> | undefined) => {
      if (value === undefined) world.delete(path);
      else world.set(path, guardPolled(path, value));
    },
    generation: writeGeneration,
    cancelled,
  };
}

test("接线（真实的 status-reads）：没有时间戳的 watching/now，Retry 途中推来的值不被慢响应盖掉", async () => {
  const path = STATUS_VIEWS.nowWatching.path;
  const world = new Map<string, StatusResponse<unknown>>([[path, { ok: true, data: "poisoned first screen" }]]);
  const slow = deferred<StatusResponse<unknown>>();
  const running = primeCardCache([path], wired(world, () => slow.promise));
  // 和 hooks/use-live-events 的 dispatch 一样：acceptPush 放行才写缓存
  const pushed: StatusResponse<unknown> = { ok: true, data: "pushed, newer" };
  if (acceptPush(path, pushed)) world.set(path, pushed);
  slow.resolve({ ok: true, data: "slow stale response" });
  await running;
  assert.deepEqual(world.get(path), pushed);
});

test("接线（真实的 status-reads）：同一个键上别的卡的轮询先落地，Retry 的响应不再覆盖", async () => {
  const path = STATUS_VIEWS.server.path;
  const world = new Map<string, StatusResponse<unknown>>([[path, { ok: true, data: "poisoned first screen" }]]);
  const slow = deferred<StatusResponse<unknown>>();
  const running = primeCardCache([path], wired(world, () => slow.promise));
  // hooks/use-status 的取数壳子：响应回来先过 guardPolled，再由 SWR 写进缓存
  const polled: StatusResponse<unknown> = { ok: true, data: "polled by the other card" };
  world.set(path, guardPolled(path, polled));
  slow.resolve({ ok: true, data: "slow response" });
  await running;
  assert.deepEqual(world.get(path), polled);
});

test("接线（真实的 status-reads）：期间没有别人写过，Retry 的响应照常落地，之后的推送才是最新", async () => {
  const path = STATUS_VIEWS.nowListening.path;
  const world = new Map<string, StatusResponse<unknown>>([[path, { ok: true, data: "poisoned first screen" }]]);
  await primeCardCache([path], wired(world, async () => ({ ok: true, data: { receivedAt: 7_000 } })));
  assert.deepEqual(world.get(path), { ok: true, data: { receivedAt: 7_000 } });
  const pushed: StatusResponse<unknown> = { ok: true, data: { receivedAt: 8_000 } };
  assert.equal(acceptPush(path, pushed), true);
});
