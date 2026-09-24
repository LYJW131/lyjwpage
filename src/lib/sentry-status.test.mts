import assert from "node:assert/strict";
import test from "node:test";

import { availability, fetchSentryStatus, parseLastCheck, parseUptimeBuckets } from "./sentry-status.ts";

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

test("uptime last check", () => {
  assert.deepEqual(parseLastCheck([{ timestamp: "2026-09-23T03:01:37Z", durationMs: 411, httpStatusCode: 200 }]), { at: Date.parse("2026-09-23T03:01:37Z"), durationMs: 411, httpStatus: 200 });
  assert.equal(parseLastCheck([]), null);
});

test("one failing block degrades to null without failing the round", async () => {
  // 在线率和错误那几块挂了、Vitals 那块成了：前者为 null，Vitals 照常
  const payload = await fetchSentryStatus(async (path, params) => {
    if (params.dataset === "spans") return { data: [{ "p75(measurements.lcp)": 1850, "count()": 3 }] };
    throw new Error(`503 ${path}`);
  }, 1790132942041);
  assert.equal(payload.uptime, null);
  assert.equal(payload.errors, null);
  assert.equal(payload.vitals?.lcpP75Ms, 1850);
  await assert.rejects(fetchSentryStatus(async () => { throw new Error("down"); }));
});
