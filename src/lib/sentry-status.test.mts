import assert from "node:assert/strict";
import test from "node:test";

import { fetchSentryStatus, parseCron, parseSessions } from "./sentry-status.ts";

// 形状取自 2026-09-23 对 Sentry API 的真实响应，只删了用不到的字段

test("sessions and cron", () => {
  assert.deepEqual(parseSessions({ groups: [{ totals: { "crash_free_rate(session)": 0.992, "sum(session)": 876 } }] }), { crashFreeRate: 0.992, count: 876 });
  // 没有会话时 Sentry 仍给一个比率，不能当成 100% 展示
  assert.deepEqual(parseSessions({ groups: [{ totals: { "crash_free_rate(session)": 1, "sum(session)": 0 } }] }), { crashFreeRate: null, count: 0 });
  assert.deepEqual(parseCron({ environments: [{ name: "development", status: "error", lastCheckIn: "2026-09-22T23:49:06Z" }] }), { status: "unknown", lastCheckInAt: null });
  assert.deepEqual(parseCron({ environments: [{ name: "production", status: "missed_checkin", lastCheckIn: "2026-09-23T03:00:00Z" }] }), { status: "missed", lastCheckInAt: Date.parse("2026-09-23T03:00:00Z") });
});

test("one failing block degrades to null without failing the round", async () => {
  const payload = await fetchSentryStatus(async (path) => {
    if (path.includes("/monitors/")) return { environments: [{ name: "production", status: "ok", lastCheckIn: "2026-09-23T03:00:00Z" }] };
    throw new Error(`503 ${path}`);
  }, 1790132942041);
  assert.equal(payload.errors, null);
  assert.equal(payload.cron?.status, "ok");
  await assert.rejects(fetchSentryStatus(async () => { throw new Error("down"); }));
});
