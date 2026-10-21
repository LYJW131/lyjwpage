import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createClockGate, makeMountedAtSource } from "@/hooks/use-mounted-at";

describe("makeMountedAtSource", () => {
  it("水合实例在 gate 放行前读到定格时刻", () => {
    const gate = createClockGate();
    const src = makeMountedAtSource(gate, 1000);
    assert.equal(src.getServerSnapshot(), 1000);
    assert.equal(src.getSnapshot(), 1000);
  });

  it("gate 放行后水合实例读到此刻并定格", () => {
    const gate = createClockGate();
    const src = makeMountedAtSource(gate, 1000);
    src.getServerSnapshot();
    gate.armed = true;
    const first = src.getSnapshot();
    assert.ok(first > 1000);
    assert.equal(src.getSnapshot(), first);
  });

  it("水合后新挂载的实例首帧就取此刻", () => {
    const gate = createClockGate();
    const src = makeMountedAtSource(gate, 1000);
    assert.ok(src.getSnapshot() > 1000);
    assert.equal(src.getServerSnapshot(), src.getSnapshot());
  });

  it("没有 gate 时不冻结", () => {
    const src = makeMountedAtSource(null, 1000);
    src.getServerSnapshot();
    assert.ok(src.getSnapshot() > 1000);
  });

  it("gate 经 requestIdleCallback 逐个放行", () => {
    type IdleCb = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;
    type IdleOpts = { timeout?: number };
    const scheduled: { cb: IdleCb; opts?: IdleOpts }[] = [];
    const g = globalThis as { requestIdleCallback?: (cb: IdleCb, opts?: IdleOpts) => number };
    const prev = g.requestIdleCallback;
    g.requestIdleCallback = (cb, opts) => (scheduled.push({ cb, opts }), scheduled.length);
    try {
      const gateA = createClockGate();
      const gateB = createClockGate();
      const srcA = makeMountedAtSource(gateA, 1000);
      const srcB = makeMountedAtSource(gateB, 1000);
      const fired: string[] = [];
      srcA.subscribe(() => fired.push("a"));
      srcB.subscribe(() => fired.push("b"));
      assert.equal(scheduled.length, 1);
      assert.deepEqual(scheduled[0].opts, { timeout: 2000 });
      scheduled[0].cb({ didTimeout: false, timeRemaining: () => 50 });
      assert.ok(gateA.armed && !gateB.armed);
      assert.deepEqual(fired, ["a"]);
      assert.equal(scheduled.length, 2);
      scheduled[1].cb({ didTimeout: false, timeRemaining: () => 50 });
      assert.ok(gateB.armed);
      assert.deepEqual(fired, ["a", "b"]);
    } finally {
      if (prev) g.requestIdleCallback = prev;
      else delete g.requestIdleCallback;
    }
  });
});
