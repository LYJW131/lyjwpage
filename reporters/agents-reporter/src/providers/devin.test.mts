import assert from "node:assert/strict";
import test from "node:test";

import { parseDevinCredentials, rowFromDevinStatus } from "../../dist/providers/devin.js";

function status(planStatus: Record<string, unknown>) {
  return {
    userStatus: {
      pro: true,
      planStatus: {
        planInfo: { teamsTier: "TEAMS_TIER_DEVIN_PRO", planName: "Pro", billingStrategy: "BILLING_STRATEGY_QUOTA" },
        planStart: "2026-10-11T10:13:36Z",
        planEnd: "2026-11-11T10:13:36Z",
        availablePromptCredits: -1,
        overageBalanceMicros: "-27787",
        ...planStatus,
      },
    },
    planInfo: { planName: "Pro" },
  };
}

test("rowFromDevinStatus 把日、周剩余百分比翻成已用，重置时刻取 unix 秒", () => {
  const row = rowFromDevinStatus(
    status({
      dailyQuotaRemainingPercent: 72,
      weeklyQuotaRemainingPercent: 100,
      dailyQuotaResetAtUnix: "1792396800",
      weeklyQuotaResetAtUnix: "1792915200",
    }),
  );
  assert.deepEqual(row, {
    id: "devin",
    plan: { tier: "Pro", label: "Pro" },
    limits: [
      { key: "devin.primary", label: "Daily", group: null, windowMinutes: 1_440, usedPercent: 28, resetsAt: 1_792_396_800 },
      { key: "devin.secondary", label: "Weekly", group: null, windowMinutes: 10_080, usedPercent: 0, resetsAt: 1_792_915_200 },
    ],
    limitsError: null,
  });
});

test("rowFromDevinStatus 额度用尽时 proto3 省掉剩余百分比，只要有重置时刻就记 100% 已用", () => {
  const row = rowFromDevinStatus(
    status({
      weeklyQuotaRemainingPercent: 3,
      dailyQuotaResetAtUnix: "1792396800",
      weeklyQuotaResetAtUnix: "1792915200",
    }),
  );
  assert.equal(row.limits[0]?.usedPercent, 100);
  assert.equal(row.limits[1]?.usedPercent, 97);
});

test("rowFromDevinStatus 按套餐的 hide 开关去掉窗口；两扇都没有时报错行", () => {
  const hidden = rowFromDevinStatus({
    userStatus: {
      planStatus: {
        planInfo: { planName: "Pro", hideDailyQuota: true },
        dailyQuotaRemainingPercent: 50,
        weeklyQuotaRemainingPercent: 40,
        dailyQuotaResetAtUnix: "1792396800",
        weeklyQuotaResetAtUnix: "1792915200",
      },
    },
  });
  assert.deepEqual(hidden.limits.map((limit) => limit.key), ["devin.secondary"]);

  const credits = rowFromDevinStatus({
    userStatus: { planStatus: { planInfo: { planName: "Teams", billingStrategy: "BILLING_STRATEGY_CREDITS" } } },
  });
  assert.deepEqual(credits.limits, []);
  assert.equal(credits.plan?.label, "Teams");
  assert.ok(credits.limitsError);
});

test("parseDevinCredentials 读 API key 与服务器，非 https 的服务器退回默认地址", () => {
  assert.deepEqual(
    parseDevinCredentials(
      'windsurf_api_key = "devin-session-token$abc"\napi_server_url = "https://server.codeium.com/"\ndevin_api_url = "https://api.devin.ai"\n',
    ),
    { apiKey: "devin-session-token$abc", apiServerUrl: "https://server.codeium.com" },
  );
  assert.deepEqual(
    parseDevinCredentials('windsurf_api_key = "k"\napi_server_url = "http://evil.example"\n'),
    { apiKey: "k", apiServerUrl: "https://server.codeium.com" },
  );
  assert.equal(parseDevinCredentials('api_server_url = "https://server.codeium.com"\n'), null);
});
