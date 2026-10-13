import assert from "node:assert/strict";
import test from "node:test";

import { displayChanged } from "./display-change.ts";

test("时钟字段不参与比较：任何深度、在数组元素里也一样", () => {
  const clocks = ["receivedAt", "pushedAt", "observedAt", "updatedAt", "collectedAt", "timestamp", "positionMs"];
  for (const clock of clocks) {
    assert.equal(displayChanged({ v: 1, [clock]: 100 }, { v: 1, [clock]: 200 }), false, clock);
  }
  assert.equal(displayChanged({ item: { v: 1, updatedAt: 1 } }, { item: { v: 1, updatedAt: 9 } }), false);
  assert.equal(displayChanged([{ v: 1, observedAt: 1 }], [{ v: 1, observedAt: 2 }]), false);
});

test("非时钟字段、数组顺序、形状差异都算作变化", () => {
  assert.equal(displayChanged({ v: 1 }, { v: 2 }), true);
  assert.equal(displayChanged({ v: 1 }, { v: 1, extra: 0 }), true);
  assert.equal(displayChanged([1, 2], [2, 1]), true);
  assert.equal(displayChanged(null, {}), true);
  assert.equal(displayChanged({ a: { b: 1 } }, { a: { b: 2 } }), true);
});

test("键序不同、时钟缺席与否都不算变化；undefined 值键视同缺席", () => {
  assert.equal(displayChanged({ a: 1, b: 2 }, { b: 2, a: 1 }), false);
  assert.equal(displayChanged({ a: 1 }, { a: 1, updatedAt: 5 }), false);
  assert.equal(displayChanged({ a: 1 }, { a: 1, extra: undefined }), false);
  assert.equal(displayChanged("same", "same"), false);
  assert.equal(displayChanged(1, 1), false);
});
