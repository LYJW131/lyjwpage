import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCodexUsage, rowFromCodexUsage } from "../../dist/providers/codex.js";

test("Codex Spark 窗口按时长归位，槽位反了也能认", () => {
  const node = normalizeCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 11111 },
      secondary_window: { used_percent: 30, limit_window_seconds: 604800, reset_at: 99999 },
    },
    additional_rate_limits: [
      {
        limit_name: "codex spark model",
        rate_limit: {
          primary_window: { used_percent: 18, limit_window_seconds: 604800, reset_at: 33333 },
          secondary_window: { used_percent: 4, limit_window_seconds: 18000, reset_at: 22222 },
        },
      },
    ],
  });
  assert.deepEqual(node.primary_window, {
    used_percent: 12,
    limit_window_seconds: 18000,
    reset_at: 11111,
  });
  assert.deepEqual(node.secondary_window, {
    used_percent: 30,
    limit_window_seconds: 604800,
    reset_at: 99999,
  });
  assert.deepEqual(node.spark_primary_window, {
    used_percent: 4,
    limit_window_seconds: 18000,
    reset_at: 22222,
  });
  assert.deepEqual(node.spark_secondary_window, {
    used_percent: 18,
    limit_window_seconds: 604800,
    reset_at: 33333,
  });
});

test("Codex 用量百分比先四舍五入再交给窗口", () => {
  const node = normalizeCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 12.4, limit_window_seconds: 18000, reset_at: 100 },
      secondary_window: { used_percent: 30.6, limit_window_seconds: 604800, reset_at: 200 },
    },
  });
  assert.equal((node.primary_window as { used_percent: number }).used_percent, 12);
  assert.equal((node.secondary_window as { used_percent: number }).used_percent, 31);
});

test("rowFromCodexUsage 把 prolite 收成 Pro Lite", () => {
  const row = rowFromCodexUsage(
    {
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_at: 1757100000 },
        secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1757700000 },
      },
    },
    "prolite",
  );
  assert.deepEqual(row.plan, { tier: "prolite", label: "Pro Lite" });
  assert.equal(row.limits[0]?.key, "codex.primary");
  assert.equal(row.limits[0]?.windowMinutes, 300);
  assert.equal(row.limits[1]?.windowMinutes, 10080);
});
