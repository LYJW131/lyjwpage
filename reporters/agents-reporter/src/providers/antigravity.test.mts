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

test("normalizeAntigravityQuota 按 groups.buckets 顺序出四扇窗口", () => {
  const node = normalizeAntigravityQuota(quota);
  assert.deepEqual(node.primary_window, {
    used_percent: (1 - 0.9485461) * 100,
    reset_at: "2026-09-10T22:45:09Z",
    label: "Gemini Weekly",
    limit_window_seconds: 604_800,
  });
  assert.equal((node.secondary_window as { label: string }).label, "Gemini 5h");
  assert.equal((node.secondary_window as { limit_window_seconds: number }).limit_window_seconds, 18_000);
  assert.equal((node.tertiary_window as { label: string }).label, "Claude & GPT Weekly");
  assert.equal((node.quaternary_window as { label: string }).label, "Claude & GPT 5h");
  assert.equal((node.quaternary_window as { used_percent: number }).used_percent, 0);
});

test("rowFromAntigravityQuota 的 key / minutes 和从前 CLI 那路一致", () => {
  const row = rowFromAntigravityQuota(quota);
  assert.equal(row.id, "antigravity");
  assert.equal(row.limitsError, null);
  assert.deepEqual(
    row.limits.map((item) => [item.key, item.label, item.windowMinutes]),
    [
      ["antigravity.primary", "Gemini Weekly", 10_080],
      ["antigravity.secondary", "Gemini 5h", 300],
      ["antigravity.tertiary", "Claude & GPT Weekly", 10_080],
      ["antigravity.quaternary", "Claude & GPT 5h", 300],
    ],
  );
  assert.equal(row.limits[0]?.resetsAt, Date.parse("2026-09-10T22:45:09Z") / 1000);
});
