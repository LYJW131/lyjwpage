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
});
