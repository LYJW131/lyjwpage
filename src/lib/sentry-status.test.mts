import assert from "node:assert/strict";
import test from "node:test";

import { fetchSentryStatus } from "./sentry-status.ts";

// 形状取自 2026-09-23 对 Sentry API 的真实响应，只删了用不到的字段

test("one failing block degrades to null without failing the round", async () => {
  // 错误那两块挂了、Vitals 那块成了：错误为 null，Vitals 照常
  const payload = await fetchSentryStatus(async (path, params) => {
    if (params.dataset === "spans") return { data: [{ "p75(measurements.lcp)": 1850, "count()": 3 }] };
    throw new Error(`503 ${path}`);
  }, 1790132942041);
  assert.equal(payload.errors, null);
  assert.equal(payload.vitals?.lcpP75Ms, 1850);
  await assert.rejects(fetchSentryStatus(async () => { throw new Error("down"); }));
});
