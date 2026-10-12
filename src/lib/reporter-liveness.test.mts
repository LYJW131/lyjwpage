import { writeLiveness } from "@api/stores/reporter-liveness";
import assert from "node:assert/strict";
import test from "node:test";

import { heartbeatWindowMs } from "@/lib/freshness";
import {
  nextLiveness,
  offlineByLiveness,
  readLiveness,
} from "@shared/reporter-liveness";
import { FakeStorage, installTestStorage } from "@/lib/testing/fake-storage";

test.beforeEach(() => {
  installTestStorage(null);
});

test.afterEach(() => {
  installTestStorage(null);
});

test("从没见过上报器时是 lastSeenAt 0", async () => {
  installTestStorage(new FakeStorage());
  assert.deepEqual(await readLiveness(), { lastSeenAt: 0, declaredOffline: false });
});

test("writeLiveness 之后 readLiveness 读到同一份", async () => {
  installTestStorage(new FakeStorage());
  const live = { lastSeenAt: 42, declaredOffline: false };
  await writeLiveness(live);
  assert.deepEqual(await readLiveness(), live);
});

test("nextLiveness 离线声明翻转才算 flipped", () => {
  const same = nextLiveness({ lastSeenAt: 1, declaredOffline: false }, { offline: false, at: 2 });
  assert.equal(same.flipped, false);
  assert.deepEqual(same.next, { lastSeenAt: 2, declaredOffline: false });

  const flipped = nextLiveness({ lastSeenAt: 1, declaredOffline: false }, { offline: true, at: 3 });
  assert.equal(flipped.flipped, true);
  assert.deepEqual(flipped.next, { lastSeenAt: 3, declaredOffline: true });
});

test("亲口离线或心跳窗口过了才算掉线", () => {
  const window = heartbeatWindowMs();
  assert.equal(offlineByLiveness({ lastSeenAt: 1000, declaredOffline: false }, 1000), false);
  assert.equal(offlineByLiveness({ lastSeenAt: 1000, declaredOffline: false }, 1000 + window), false);
  assert.equal(
    offlineByLiveness({ lastSeenAt: 1000, declaredOffline: false }, 1000 + window + 1),
    true,
  );
  assert.equal(offlineByLiveness({ lastSeenAt: 1000, declaredOffline: true }, 1000), true);
  assert.equal(offlineByLiveness({ lastSeenAt: 0, declaredOffline: false }, 1000), true);
});
