import assert from "node:assert/strict";
import test from "node:test";

import { displayGrokPlanName, normalizeGrokBillingResponse, rowFromGrokBilling } from "../../dist/providers/grok.js";

test("displayGrokPlanName 把 heavy 收成 SuperGrok Heavy", () => {
  assert.equal(displayGrokPlanName("supergrok_heavy"), "SuperGrok Heavy");
  assert.equal(displayGrokPlanName("SuperGrok"), "SuperGrok");
  assert.equal(displayGrokPlanName("heavy"), "SuperGrok Heavy");
});

test("normalizeGrokBillingResponse 把 unified format=credits 周池收成主窗口", () => {
  const result = normalizeGrokBillingResponse({
    config: {
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        start: "2026-07-13T09:23:37.846092+00:00",
        end: "2026-07-20T09:23:37.846092+00:00",
      },
      creditUsagePercent: 18.0,
      onDemandCap: { val: 0 },
      onDemandUsed: { val: 0 },
      productUsage: [
        { product: "GrokBuild", usagePercent: 17.0 },
        { product: "GrokChat", usagePercent: 1.0 },
      ],
      isUnifiedBillingUser: true,
      billingPeriodStart: "2026-07-13T09:23:37.846092+00:00",
      billingPeriodEnd: "2026-07-20T09:23:37.846092+00:00",
    },
  });
  assert.equal(result.period_type, "weekly");
  assert.equal(result.credit_usage_percent, 18);
  assert.deepEqual(result.primary_window, {
    used_percent: 18,
    reset_at: "2026-07-20T09:23:37.846Z",
    limit_window_seconds: 7 * 86400,
  });
  assert.equal(result.secondary_window, null);
});

test("normalizeGrokBillingResponse 把旧的月额度收成主窗口", () => {
  const result = normalizeGrokBillingResponse({
    config: {
      monthlyLimit: { val: 150_000 },
      used: { val: 4_625 },
      onDemandCap: { val: 0 },
      onDemandUsed: { val: 0 },
      billingPeriodStart: "2026-06-01T00:00:00+00:00",
      billingPeriodEnd: "2026-07-01T00:00:00+00:00",
    },
  });
  assert.equal(result.period_type, "monthly");
  assert.deepEqual(result.primary_window, {
    used_percent: (4_625 / 150_000) * 100,
    reset_at: "2026-07-01T00:00:00.000Z",
    limit_window_seconds: 30 * 86400,
  });
});

test("rowFromGrokBilling 在 cap 为正时加 on-demand 第二扇", () => {
  const row = rowFromGrokBilling({
    config: {
      monthlyLimit: { val: 100 },
      used: { val: 10 },
      onDemandCap: { val: 50 },
      onDemandUsed: { val: 25 },
      billingPeriodEnd: "2026-07-01T00:00:00Z",
      subscriptionTier: "SuperGrok",
    },
  });
  assert.equal(row.plan?.label, "SuperGrok");
  assert.equal(row.limits[0]?.key, "grok.primary");
  assert.equal(row.limits[1]?.key, "grok.secondary");
  assert.equal(row.limits[1]?.usedPercent, 50);
});
