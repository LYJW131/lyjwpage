import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAntigravityQuota, rowFromAntigravityQuota } from "../../dist/providers/antigravity.js";

const quota = {
  groups: [
    {
      displayName: "Gemini Models",
      buckets: [
        {
          bucketId: "gemini-weekly",
          displayName: "Weekly Limit Remaining",
          window: "weekly",
          resetTime: "2026-09-10T22:45:09Z",
          remainingFraction: 0.9485461,
        },
        {
          bucketId: "gemini-5h",
          displayName: "Five Hour Limit Remaining",
          window: "5h",
          resetTime: "2026-09-05T04:51:12Z",
          remainingFraction: 0.6995202,
        },
      ],
    },
    {
      displayName: "Claude and GPT models",
      buckets: [
        {
          bucketId: "3p-weekly",
          displayName: "Weekly Limit Remaining",
          window: "weekly",
          resetTime: "2026-09-12T01:25:33Z",
          remainingFraction: 1,
        },
        {
          bucketId: "3p-5h",
          displayName: "Five Hour Limit Remaining",
          window: "5h",
          resetTime: "2026-09-05T06:25:33Z",
          remainingFraction: 1,
        },
      ],
    },
  ],
};

test("normalizeAntigravityQuota 按 groups.buckets 顺序出窗口，超过四扇也不丢", () => {
  const limits = normalizeAntigravityQuota({
    groups: [
      ...quota.groups,
      { displayName: "Extra", buckets: [{ window: "5h", resetTime: "2026-09-05T06:25:33Z", remainingFraction: 0.5 }] },
    ],
  });
  assert.deepEqual(
    limits.map((item) => [item.key, item.label, item.windowMinutes]),
    [
      ["antigravity.primary", "Gemini Weekly", 10_080],
      ["antigravity.secondary", "Gemini 5h", 300],
      ["antigravity.tertiary", "Claude & GPT Weekly", 10_080],
      ["antigravity.quaternary", "Claude & GPT 5h", 300],
      ["antigravity.5", "Extra 5h", 300],
    ],
  );
  assert.equal(limits[0]?.usedPercent, (1 - 0.9485461) * 100);
  assert.equal(limits[0]?.resetsAt, Date.parse("2026-09-10T22:45:09Z") / 1000);
});

test("remainingFraction 缺省（用尽）按 0 剩余算，不丢这条", () => {
  const limits = normalizeAntigravityQuota({
    groups: [{ displayName: "Gemini Models", buckets: [{ window: "5h", resetTime: "2026-09-05T04:51:12Z" }] }],
  });
  assert.equal(limits.length, 1);
  assert.equal(limits[0]?.usedPercent, 100);
});

test("rowFromAntigravityQuota 带套餐标签", () => {
  const row = rowFromAntigravityQuota(quota, "Google AI Pro");
  assert.equal(row.limitsError, null);
  assert.equal(row.limits.length, 4);
  assert.equal(row.plan?.label, "Google AI Pro");
});
