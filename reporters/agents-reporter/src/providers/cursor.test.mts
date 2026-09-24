import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCursorUsage, rowFromCursorResponses } from "../../dist/providers/cursor.js";

const period = {
  billingCycleStart: "1786898591000",
  billingCycleEnd: "1789576991000",
  planUsage: {
    totalSpend: 63684,
    includedSpend: 40000,
    bonusSpend: 23684,
    limit: 40000,
    autoPercentUsed: 12.986666666666666,
    apiPercentUsed: 49.448,
    totalPercentUsed: 18.19542857142857,
  },
  spendLimitUsage: {
    individualLimit: 1000,
    individualRemaining: 1000,
    limitType: "user",
  },
};

const plan = {
  planInfo: {
    planName: "Ultra",
    includedAmountCents: 40000,
    price: "$200/mo",
    billingCycleEnd: "1789576991000",
    planOwner: "PLAN_OWNER_STRIPE",
  },
};

const hardLimit = { hardLimit: 10 };

const sand = {
  currentPeriodStart: "2026-09-20T17:03:18.185Z",
  nextResetTimestampUtc: "2026-09-27T17:03:18.185Z",
  usagePercent: 0.908158,
  hasAvailableUsage: true,
  hasNonZeroIncludedLimit: true,
  grokPlanLabel: "Grok Bot Plan",
  cursorPlanName: "Ultra",
};

test("normalizeCursorUsage 把总额、自家模型、其他模型收成三扇窗口，忽略 On-Demand", () => {
  const node = normalizeCursorUsage(period, plan, hardLimit);
  assert.equal(node.plan_label, "Ultra");
  assert.deepEqual(node.primary_window, {
    used_percent: 18.19542857142857,
    reset_at: "2026-09-16T16:43:11.000Z",
    label: "Included",
    limit_window_seconds: 2_678_400,
  });
  assert.equal((node.secondary_window as { label: string }).label, "Cursor models");
  assert.equal((node.secondary_window as { used_percent: number }).used_percent, 12.986666666666666);
  assert.equal((node.tertiary_window as { label: string }).label, "Other models");
  assert.equal((node.tertiary_window as { used_percent: number }).used_percent, 49.448);
  assert.equal(node.quaternary_window, null);
});

test("Grok Bot 周额度进第四扇窗口，额度为 0 时不报", () => {
  const node = normalizeCursorUsage(period, plan, hardLimit, sand);
  assert.deepEqual(node.quaternary_window, {
    used_percent: 0.908158,
    reset_at: "2026-09-27T17:03:18.185Z",
    label: "Grok Bot",
    limit_window_seconds: 7 * 86_400,
  });
  const off = normalizeCursorUsage(period, plan, hardLimit, { ...sand, hasNonZeroIncludedLimit: false });
  assert.equal(off.quaternary_window, null);
  const row = rowFromCursorResponses({ period, plan, hardLimit, sand });
  assert.equal(row.limits[3]?.key, "cursor.quaternary");
  assert.equal(row.limits[3]?.windowMinutes, 7 * 1440);
});

test("rowFromCursorResponses 把 planName 收成套餐，key 是 cursor.primary 起", () => {
  const row = rowFromCursorResponses({ period, plan, hardLimit });
  assert.deepEqual(row.plan, { tier: "Ultra", label: "Ultra" });
  assert.equal(row.limitsError, null);
  assert.equal(row.limits[0]?.key, "cursor.primary");
  assert.equal(row.limits[0]?.label, "Included");
  assert.equal(row.limits[1]?.key, "cursor.secondary");
  assert.equal(row.limits[2]?.key, "cursor.tertiary");
  assert.equal(row.limits[0]?.windowMinutes, 2_678_400 / 60);
  assert.equal(row.limits[0]?.resetsAt, 1_789_576_991);
});
