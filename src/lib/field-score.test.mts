import assert from "node:assert/strict";
import test from "node:test";

import { curveScore, fieldPerformanceScore } from "./field-score.ts";

test("curve hits 0.9 at p10 and 0.5 at the median", () => {
  assert.ok(Math.abs(curveScore(2500, 2500, 4000) - 0.9) < 1e-6);
  assert.ok(Math.abs(curveScore(4000, 2500, 4000) - 0.5) < 1e-6);
  assert.equal(curveScore(0, 0.1, 0.25), 1);
  assert.ok(curveScore(1000, 2500, 4000) > 0.99);
  assert.ok(curveScore(10_000, 2500, 4000) < 0.1);
});

test("weights renormalize over the vitals that are present", () => {
  const empty = { lcpP75Ms: null, inpP75Ms: null, clsP75: null, fcpP75Ms: null, ttfbP75Ms: null, samples: 0 };
  assert.equal(fieldPerformanceScore(null), null);
  assert.equal(fieldPerformanceScore(empty), null);
  // 只有 LCP 且正好在中位点：分数就是这一项的 50
  assert.equal(fieldPerformanceScore({ ...empty, lcpP75Ms: 4000 }), 50);
  const fast = fieldPerformanceScore({ lcpP75Ms: 1850, inpP75Ms: 96, clsP75: 0.021, fcpP75Ms: 1120, ttfbP75Ms: 184, samples: 312 });
  assert.ok(fast != null && fast >= 95, String(fast));
  const slow = fieldPerformanceScore({ lcpP75Ms: 5200, inpP75Ms: 620, clsP75: 0.3, fcpP75Ms: 3600, ttfbP75Ms: 2100, samples: 40 });
  assert.ok(slow != null && slow < 50, String(slow));
});
