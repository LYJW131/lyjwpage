import assert from "node:assert/strict";
import test from "node:test";

import {
  availability,
  fetchSentryStatus,
  parseCron,
  parseLastCheck,
  parseSessions,
  parseUptimeBuckets,
  parseUptimeStatus,
} from "./sentry-status.ts";

// 形状取自 2026-09-23 对 Sentry API 的真实响应，只删了用不到的字段

test("uptime buckets count incident failures as downtime and ignore missed windows", () => {
  const days = parseUptimeBuckets({
    "10416301": [
      [1790035200, { failure: 0, failure_incident: 0, success: 19, missed_window: 0 }],
      [1790121600, { failure: 1, failure_incident: 2, success: 187, missed_window: 4 }],
    ],
  }, "10416301");
  assert.deepEqual(days[1], { dayStart: 1790121600_000, success: 187, failure: 3, missed: 4 });
  assert.equal(availability(days), (19 + 187) / (19 + 187 + 3));
  assert.equal(availability([{ success: 0, failure: 0 }]), null);
  assert.throws(() => parseUptimeBuckets({}, "10416301"));
});

test("uptime status and last check", () => {
  assert.deepEqual(parseUptimeStatus({ uptimeStatus: 1, url: "https://lyjw.me/", intervalSeconds: 60 }), { status: "up", url: "https://lyjw.me/", intervalSeconds: 60 });
  assert.equal(parseUptimeStatus({ uptimeStatus: 2 }).status, "down");
  assert.equal(parseUptimeStatus(null).status, "unknown");
  assert.deepEqual(parseLastCheck([{ timestamp: "2026-09-23T03:01:37Z", durationMs: 411, httpStatusCode: 200 }]), { at: Date.parse("2026-09-23T03:01:37Z"), durationMs: 411, httpStatus: 200 });
  assert.equal(parseLastCheck([]), null);
});

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
  assert.equal(payload.uptime, null);
  assert.equal(payload.errors, null);
  assert.equal(payload.cron?.status, "ok");
  await assert.rejects(fetchSentryStatus(async () => { throw new Error("down"); }));
});
