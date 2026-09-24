import assert from "node:assert/strict";
import test from "node:test";

import { availability, fetchSentryStatus, parseCronBuckets, parseCronStatus, parseUptimeBuckets, parseUptimeStatus } from "./sentry-status.ts";

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

test("cron heartbeat counts missed, timed-out and failed check-ins as failures", () => {
  const days = parseCronBuckets([
    { ts: 1790121600, ok: 1437, error: 1, missed: 2, timeout: 0, unknown: 0, duration: 12 },
    { ts: 1790208000, ok: 0, error: 0, missed: 0, timeout: 0, unknown: 0, duration: 0 },
  ]);
  assert.deepEqual(days[0], { dayStart: 1790121600_000, success: 1437, failure: 3, missed: 0 });
  assert.equal(availability(days), 1437 / 1440);
  assert.throws(() => parseCronBuckets({}));
  const detail = (status: string) => ({ environments: [{ name: "development", status: "error" }, { name: "production", status }] });
  assert.equal(parseCronStatus(detail("ok")), "up");
  assert.equal(parseCronStatus(detail("missed_checkin")), "down");
  assert.equal(parseCronStatus({ environments: [{ name: "development", status: "error" }] }), "unknown");
});

test("uptime status", () => {
  assert.equal(parseUptimeStatus({ uptimeStatus: 1 }), "up");
  assert.equal(parseUptimeStatus({ uptimeStatus: 2 }), "down");
  assert.equal(parseUptimeStatus(null), "unknown");
});

test("one failing block degrades to null without failing the round", async () => {
  // 在线率和错误那几块挂了、Vitals 那块成了：前者为 null，Vitals 照常
  const payload = await fetchSentryStatus(async (path, params) => {
    if (params.dataset === "spans") return { data: [{ "p75(measurements.lcp)": 1850, "count()": 3 }] };
    throw new Error(`503 ${path}`);
  }, 1790132942041);
  assert.equal(payload.uptime, null);
  assert.equal(payload.heartbeat, null);
  assert.equal(payload.errors, null);
  assert.equal(payload.vitals?.lcpP75Ms, 1850);
  await assert.rejects(fetchSentryStatus(async () => { throw new Error("down"); }));
});
