import assert from "node:assert/strict";
import test from "node:test";
import { statusEnvelope } from "./api.ts";
import { LagResult } from "./lag-result.ts";
import { acceptPush, guardPolled, withoutServedAt } from "./status-reads.ts";
import { STATUS_VIEWS } from "./status-views.ts";

test("acceptPush / guardPolled: stamped payloads drop out-of-order values", () => {
  const path = STATUS_VIEWS.desktop.path;
  const older = { ok: true as const, data: { receivedAt: 1_000 } };
  const newer = { ok: true as const, data: { receivedAt: 2_000 } };
  assert.equal(acceptPush(path, newer), true);
  assert.equal(acceptPush(path, older), false);
  assert.deepEqual(guardPolled(path, older), newer);
  const equal = { ok: true as const, data: { receivedAt: 2_000, extra: "polled" } };
  assert.deepEqual(guardPolled(path, equal), equal);
});

test("acceptPush: pushes without a comparable stamp are always taken", () => {
  const path = STATUS_VIEWS.watching.path;
  assert.equal(acceptPush(path, { ok: true, data: { items: [] } }), true);
  assert.equal(acceptPush(path, { ok: true, data: { items: [1] } }), true);
});

test("guardPolled: an error envelope stays visible instead of the last success", () => {
  const path = STATUS_VIEWS.powerBank.path;
  const pushed = { ok: true as const, data: { pushedAt: 9_000 } };
  assert.equal(acceptPush(path, pushed), true);
  const failed = { ok: false as const, error: "Status unavailable" };
  assert.deepEqual(guardPolled(path, failed), failed);
});

test("withoutServedAt: 取回的信封摘掉出站时刻，别的原样（SWR 深比较才不会每轮都判「变了」）", () => {
  assert.deepEqual(withoutServedAt({ ok: true, data: { a: 1 }, servedAt: 5 }), { ok: true, data: { a: 1 } });
  assert.deepEqual(
    withoutServedAt({ ok: true, data: { a: 1 }, updatedAt: 3, servedAt: 5 }),
    { ok: true, data: { a: 1 }, updatedAt: 3 },
  );
  const bare = { ok: true as const, data: { a: 1 } };
  assert.equal(withoutServedAt(bare), bare);
  const failed = { ok: false as const, error: "x" };
  assert.equal(withoutServedAt(failed), failed);
});

test("statusEnvelope: 成功的信封带出站时刻，可滞后层的 updatedAt 照旧；降级信封不带", async () => {
  const before = Date.now();
  const live = await statusEnvelope(async () => ({ a: 1 }));
  const after = Date.now();
  assert.equal(live.ok, true);
  assert.ok(live.ok && live.servedAt !== undefined && live.servedAt >= before && live.servedAt <= after);
  assert.deepEqual(live.ok && live.data, { a: 1 });

  const lag = await statusEnvelope(async () => new LagResult({ b: 2 }, 42));
  assert.ok(lag.ok && lag.updatedAt === 42 && typeof lag.servedAt === "number");

  const failed = await statusEnvelope(async () => {
    throw new Error("boom");
  });
  assert.equal(failed.ok, false);
  assert.equal("servedAt" in failed, false);
});
