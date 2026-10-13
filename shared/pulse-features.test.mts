import assert from "node:assert/strict";
import test from "node:test";

import { mergeCoverage } from "./pulse-features.ts";

test("mergeCoverage：空输入、零宽与反宽区间都丢掉", () => {
  assert.deepEqual(mergeCoverage([]), []);
  assert.deepEqual(mergeCoverage([{ from: 5, to: 5 }, { from: 9, to: 4 }]), []);
  assert.deepEqual(mergeCoverage([{ from: 0, to: 10 }]), [{ from: 0, to: 10 }]);
});

test("mergeCoverage：重叠与首尾相接的区间并成一段", () => {
  assert.deepEqual(mergeCoverage([{ from: 0, to: 10 }, { from: 5, to: 15 }]), [{ from: 0, to: 15 }]);
  assert.deepEqual(mergeCoverage([{ from: 0, to: 10 }, { from: 10, to: 20 }]), [{ from: 0, to: 20 }]);
  assert.deepEqual(
    mergeCoverage([{ from: 0, to: 30 }, { from: 5, to: 10 }, { from: 28, to: 40 }]),
    [{ from: 0, to: 40 }],
  );
});

test("mergeCoverage：乱序输入先排稳，不相交的段各自保留", () => {
  assert.deepEqual(
    mergeCoverage([{ from: 20, to: 30 }, { from: 0, to: 5 }, { from: 4, to: 10 }]),
    [{ from: 0, to: 10 }, { from: 20, to: 30 }],
  );
  assert.deepEqual(
    mergeCoverage([{ from: 0, to: 5 }, { from: 4, to: 21 }, { from: 20, to: 30 }]),
    [{ from: 0, to: 30 }],
  );
  assert.deepEqual(
    mergeCoverage([{ from: 10, to: 15 }, { from: 0, to: 5 }]),
    [{ from: 0, to: 5 }, { from: 10, to: 15 }],
  );
});
