import assert from "node:assert/strict";
import test from "node:test";

import { heartbeatWindowMs } from "./freshness.ts";
import { mirror, nextLiveness, offlineByLiveness, readLiveness, withPresence } from "./reporter-liveness.ts";
import { FakeStorage, installTestStorage } from "./testing/fake-storage.ts";

test.afterEach(() => {
  installTestStorage(null);
});

test("mirror 键带存储前缀与固定两段", () => {
  assert.equal(mirror.key, "lyjwpage:reporter:liveness");
});

test("nextLiveness：写下最新心跳与离线标志，flipped 只在离线标志变化时为真", () => {
  let live = { lastSeenAt: 0, declaredOffline: false };
  let step = nextLiveness(live, { offline: true, at: 100 });
  assert.deepEqual(step.next, { lastSeenAt: 100, declaredOffline: true });
  assert.equal(step.flipped, true);

  live = step.next;
  step = nextLiveness(live, { offline: true, at: 200 });
  assert.deepEqual(step.next, { lastSeenAt: 200, declaredOffline: true });
  assert.equal(step.flipped, false);

  step = nextLiveness(live, { offline: false, at: 300 });
  assert.deepEqual(step.next, { lastSeenAt: 300, declaredOffline: false });
  assert.equal(step.flipped, true);
});

test("offlineByLiveness：亲口离线、从没见过、心跳超窗都算离线；窗口边界那一刻还不算", () => {
  const now = 1_000_000;
  assert.equal(offlineByLiveness({ lastSeenAt: now, declaredOffline: true }, now), true);
  assert.equal(offlineByLiveness({ lastSeenAt: 0, declaredOffline: false }, now), true);

  const windowMs = heartbeatWindowMs();
  const seen = { lastSeenAt: now - windowMs, declaredOffline: false };
  assert.equal(offlineByLiveness(seen, now), false);
  assert.equal(offlineByLiveness({ ...seen, lastSeenAt: seen.lastSeenAt - 1 }, now), true);
});

test("readLiveness：没写过时是默认的「从没见过」，写过原样读回", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  assert.deepEqual(await readLiveness(), { lastSeenAt: 0, declaredOffline: false });

  await mirror.put({ lastSeenAt: 9, declaredOffline: true });
  assert.deepEqual(await readLiveness(), { lastSeenAt: 9, declaredOffline: true });
});

test("withPresence 把存活事实并进载荷，窗口值随心跳配置走", () => {
  const merged = withPresence({ v: 1 }, { lastSeenAt: 5, declaredOffline: false });
  assert.deepEqual(merged, {
    v: 1,
    lastSeenAt: 5,
    declaredOffline: false,
    heartbeatWindowMs: heartbeatWindowMs(),
  });
});
