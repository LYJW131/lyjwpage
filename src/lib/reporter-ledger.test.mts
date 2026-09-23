import assert from "node:assert/strict";
import test from "node:test";

import { reporterBlockOf } from "./reporter-ledger.ts";

const block = { commit: "b15e3cc", pushes: 612, start: 1_790_000_000_000, end: 1_790_043_200_000 };

test("合法的 reporter 块原样收下", () => {
  assert.deepEqual(reporterBlockOf({ reporter: block }), block);
  assert.deepEqual(reporterBlockOf({ reporter: { ...block, commit: null } }), { ...block, commit: null });
});

test("旧版没带、字段写坏的一律当没有，不抛错拒掉整封", () => {
  assert.equal(reporterBlockOf({}), null);
  assert.equal(reporterBlockOf(null), null);
  assert.equal(reporterBlockOf({ reporter: { ...block, commit: "not a sha" } }), null);
  assert.equal(reporterBlockOf({ reporter: { ...block, pushes: -1 } }), null);
  assert.equal(reporterBlockOf({ reporter: { ...block, pushes: 1.5 } }), null);
  assert.equal(reporterBlockOf({ reporter: { ...block, start: block.end + 1 } }), null);
});
