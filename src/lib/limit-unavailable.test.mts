import assert from "node:assert/strict";
import test from "node:test";

import { featuredLimitRows, unavailableShare } from "@/components/live/vibecoding/limits.ts";
import type { VibeCodingLimit } from "@shared/types";

const weekly = (usedPercent: number, resetsAt: number | null = null): VibeCodingLimit => ({
  key: "weekly_all",
  label: null,
  group: "weekly",
  windowMinutes: 10080,
  usedPercent,
  resetsAt,
});
const noReset = { resetsAt: null };
const share = (cap: Parameters<typeof unavailableShare>[0], used: number, now: number) => unavailableShare(cap, noReset, used, now);
const fable = (w: VibeCodingLimit | null) => (w ? { weekly: w, sharePercent: 50 } : null);

test("Fable 没用时，周限额超过 50% 后右端按 (W-50)/50 不可用", () => {
  assert.equal(share(fable(weekly(80)), 0, 0), 0.6);
  assert.equal(share(fable(weekly(51)), 0, 0), 0.02);
});

test("Fable 自己的用量已计入周限额，不可用区要扣掉它", () => {
  assert.equal(share(fable(weekly(80)), 10, 0), 0.5);
  assert.equal(share(fable(weekly(80)), 30, 0), 0.3);
  assert.equal(share(fable(weekly(80)), 60, 0), 0);
  assert.equal(share(fable(weekly(51)), 10, 0), 0);
});

test("周限额不超过 50% 或缺失时没有不可用区，满额时 Fable 剩下的全部不可用", () => {
  assert.equal(share(fable(weekly(50)), 0, 0), 0);
  assert.equal(share(fable(weekly(10)), 0, 0), 0);
  assert.equal(share(fable(null), 0, 0), 0);
  assert.equal(share(fable(weekly(100)), 0, 0), 1);
  assert.equal(share(fable(weekly(100)), 40, 0), 0.6);
});

test("周限额已过期按 0 处理", () => {
  assert.equal(share(fable(weekly(80, 1_000)), 0, 2_000_000), 0);
  assert.equal(share(fable(weekly(80, 3_000)), 0, 2_000_000), 0.6);
});

const session: VibeCodingLimit = { key: "claude.primary", label: null, group: "session", windowMinutes: 300, usedPercent: 11, resetsAt: null };
const claude = (label: string, weeklyUsed: number, id = "claude") => ({
  id,
  plan: { tier: label, label },
  limits: [session, weekly(weeklyUsed)],
  limitsError: null,
});
const sessionCap = (row: ReturnType<typeof claude>) => {
  const item = featuredLimitRows(row).find((r) => r.key === "session");
  return item?.kind === "limit" ? item.cap : null;
};

test("5 小时条按套餐折算：Max 20x 一个窗口约占周 2/7，Pro 与 Max 5x 约 1/7", () => {
  assert.equal(Math.round(share(sessionCap(claude("Max 20x", 84)), 11, 0) * 100), 33);
  assert.equal(share(sessionCap(claude("Max 5x", 84)), 11, 0), 0);
  assert.equal(Math.round(share(sessionCap(claude("Pro", 95)), 0, 0) * 100), 65);
});

test("没见过的套餐和别家的 5 小时条不画死区", () => {
  assert.equal(sessionCap(claude("Team", 95)), null);
  assert.equal(sessionCap({ ...claude("Pro", 95), plan: null } as unknown as ReturnType<typeof claude>), null);
  assert.equal(sessionCap(claude("Pro", 95, "codex")), null);
});

test("周限额先于这条重置时不画死区，晚于或同时重置照画", () => {
  const cap = { weekly: weekly(95, 1_000), sharePercent: 200 / 7 };
  assert.equal(unavailableShare(cap, { resetsAt: 2_000 }, 11, 0), 0);
  assert.ok(unavailableShare(cap, { resetsAt: 1_000 }, 11, 0) > 0.7);
  assert.ok(unavailableShare(cap, { resetsAt: 500 }, 11, 0) > 0.7);
});
