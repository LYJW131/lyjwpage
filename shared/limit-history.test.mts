import assert from "node:assert/strict";
import test from "node:test";

import { limitHistoryFromRows, type LimitHistoryRow } from "./limit-history.ts";

const row = (received_at: number, used_percent: number): LimitHistoryRow => ({
  agent: "claude", limit_key: "weekly_all", window_minutes: 10_080, used_percent, resets_at: 1_000, received_at,
});

test("daily readings fill in only before the first hourly one, so the same moment is not counted twice", () => {
  const payload = limitHistoryFromRows([row(100, 10), row(200, 20), row(300, 30)], [row(250, 25), row(300, 30)]);
  assert.deepEqual(payload.series[0]!.points.map(([at]) => at), [100, 200, 250, 300]);
});

test("a series with no hourly rows yet keeps every daily reading", () => {
  const payload = limitHistoryFromRows([row(100, 10), row(200, 20)], []);
  assert.deepEqual(payload.series[0]!.points.map(([, used]) => used), [10, 20]);
});
