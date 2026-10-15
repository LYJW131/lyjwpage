import assert from "node:assert/strict";
import test from "node:test";

import { judge, LCP_BUDGET_MS, lcpOf } from "./lcp-budget.ts";

test("fewer than three successful runs is inconclusive, not a failure", () => {
  assert.deepEqual(judge([9_000, 9_000]), { status: "inconclusive", samples: [9_000, 9_000] });
});

test("one slow outlier does not fail the median", () => {
  assert.equal(judge([4_000, 4_200, 12_000, 4_100, 4_300], 5_000).status, "pass");
});

test("a median over budget fails", () => {
  assert.deepEqual(judge([6_000, 6_200, 3_000, 6_100], LCP_BUDGET_MS), { status: "over", medianMs: 6_050, samples: [6_000, 6_200, 3_000, 6_100] });
});

test("reads LCP and rejects captcha or missing audits", () => {
  assert.equal(lcpOf({ lighthouseResult: { audits: { "largest-contentful-paint": { numericValue: 4425.6 } } } }), 4426);
  assert.throws(() => lcpOf({ captchaResult: "CAPTCHA_NEEDED" }));
  assert.throws(() => lcpOf({ lighthouseResult: { audits: {} } }));
});
