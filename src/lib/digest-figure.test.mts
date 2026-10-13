import assert from "node:assert/strict";
import { test } from "node:test";

import { digestFigure } from "@/lib/digest-figure";

test("digest figures put the unit right against the number and cap width at two significant digits", () => {
  assert.equal(digestFigure({ value: 22, unit: "hours", atLeast: false }), "22h");
  assert.equal(digestFigure({ value: 22.5, unit: "hours", atLeast: false }), "22.5h");
  assert.equal(digestFigure({ value: 8.5, unit: "hours", atLeast: false }), "8.5h");
  assert.equal(digestFigure({ value: 45, unit: "minutes", atLeast: false }), "45m");
  assert.equal(digestFigure({ value: 44_200_000, unit: "count", atLeast: false }), "44M");
  assert.equal(digestFigure({ value: 3_400, unit: "count", atLeast: false }), "3.4K");
  assert.equal(digestFigure({ value: 620, unit: "count", atLeast: false }), "620");
  assert.equal(digestFigure({ value: 10, unit: "count", atLeast: true }), "10+");
});
