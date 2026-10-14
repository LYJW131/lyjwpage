import assert from "node:assert/strict";
import test from "node:test";

import {
  HEALTH_BUCKET_MS,
  HEALTH_DAYS,
  HEARTBEAT_SERIES,
  UPTIME_SERIES,
  availability,
  expectedRuns,
  mergeHealth,
  summarizeBuckets,
  type HealthBucket,
} from "./health.ts";
import type { HealthPayload } from "./health-types.ts";

const HOUR = HEALTH_BUCKET_MS;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 12, 10, 30);
const TODAY = Date.UTC(2026, 9, 12);

const bucket = (hourStart: number, success: number, failure = 0, lastOk = true): HealthBucket => ({
  hourStart, success, failure, lastAt: hourStart + 55 * 60_000, lastOk,
});

test("expected runs follow the schedule offset and wait for the grace period", () => {
  assert.equal(expectedRuns(HEARTBEAT_SERIES, TODAY, TODAY + HOUR + HEARTBEAT_SERIES.graceMs), 12);
  assert.equal(expectedRuns(HEARTBEAT_SERIES, TODAY, TODAY + 2 * 60_000 + HEARTBEAT_SERIES.graceMs), 1);
  assert.equal(expectedRuns(HEARTBEAT_SERIES, TODAY, TODAY + 2 * 60_000 + HEARTBEAT_SERIES.graceMs - 1), 0);
  assert.equal(expectedRuns(UPTIME_SERIES, TODAY, TODAY + HOUR + UPTIME_SERIES.graceMs), 60);
});

test("missed heartbeats count as failures, missed probes only as missed", () => {
  const hour = TODAY + 8 * HOUR;
  const heartbeat = summarizeBuckets(HEARTBEAT_SERIES, [bucket(hour, 10, 1)], NOW);
  const today = heartbeat.days.at(-1)!;
  assert.deepEqual([today.success, today.failure, today.missed], [10, 2 + 12 + 4, 0]);
  const probe = summarizeBuckets(UPTIME_SERIES, [bucket(hour, 58, 1)], NOW);
  const probeToday = probe.days.at(-1)!;
  assert.deepEqual([probeToday.success, probeToday.failure, probeToday.missed], [58, 1, 1 + 60 + 28]);
});

test("days before the first bucket stay empty instead of counting as missed", () => {
  const summary = summarizeBuckets(HEARTBEAT_SERIES, [bucket(TODAY + 9 * HOUR, 12)], NOW);
  assert.equal(summary.days.length, HEALTH_DAYS);
  assert.equal(summary.days[0].dayStart, TODAY - (HEALTH_DAYS - 1) * DAY);
  assert.ok(summary.days.slice(0, -1).every((day) => day.success + day.failure + day.missed === 0));
  assert.equal(summarizeBuckets(HEARTBEAT_SERIES, [], NOW).status, "unknown");
  assert.equal(summarizeBuckets(HEARTBEAT_SERIES, [], NOW).availability30d, null);
});

test("the 24h availability keeps the hour the window starts in", () => {
  const yesterday = bucket(TODAY + 10 * HOUR - DAY, 59, 1);
  const summary = summarizeBuckets(UPTIME_SERIES, [yesterday, bucket(TODAY + 10 * HOUR, 30)], NOW);
  assert.equal(summary.availability24h, 89 / 90);
  assert.equal(summarizeBuckets(UPTIME_SERIES, [bucket(TODAY + 9 * HOUR - DAY, 0, 5), bucket(TODAY + 10 * HOUR, 30)], NOW).availability24h, 1);
});

test("status follows the latest result and goes down when the heartbeat stops", () => {
  const recent = (ok: boolean): HealthBucket => ({ hourStart: TODAY + 10 * HOUR, success: ok ? 6 : 5, failure: ok ? 0 : 1, lastAt: NOW - 60_000, lastOk: ok });
  assert.equal(summarizeBuckets(HEARTBEAT_SERIES, [recent(true)], NOW).status, "up");
  assert.equal(summarizeBuckets(HEARTBEAT_SERIES, [recent(false)], NOW).status, "down");
  const old = { ...recent(true), lastAt: NOW - HOUR };
  assert.equal(summarizeBuckets(HEARTBEAT_SERIES, [old], NOW).status, "down");
  assert.equal(summarizeBuckets(UPTIME_SERIES, [old], NOW).status, "unknown");
});

test("availability ignores empty days", () => {
  assert.equal(availability([{ success: 0, failure: 0 }]), null);
  assert.equal(availability([{ success: 3, failure: 1 }, { success: 0, failure: 0 }]), 0.75);
});

test("blocks that failed this round carry over for a day", () => {
  const previous: HealthPayload = { fetchedAt: 1000, uptime: null, heartbeat: null, errors: { site: { count12h: 1, count7d: 2, unresolved: 0 }, worker: { count12h: 0, count7d: 0, unresolved: 0 } }, vitals: null, blockAt: { errors: 1000 } };
  const next: HealthPayload = { fetchedAt: 2000, uptime: null, heartbeat: null, errors: null, vitals: null };
  assert.deepEqual(mergeHealth(next, previous).errors, previous.errors);
  assert.equal(mergeHealth(next, previous).blockAt?.errors, 1000);
  assert.equal(mergeHealth({ ...next, fetchedAt: 1000 + DAY }, previous).errors, null);
});
