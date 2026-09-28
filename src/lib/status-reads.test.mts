import assert from "node:assert/strict";
import test from "node:test";
import { acceptPush, guardPolled } from "./status-reads.ts";
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
