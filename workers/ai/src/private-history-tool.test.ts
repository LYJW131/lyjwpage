import assert from "node:assert/strict";
import test from "node:test";

import { historyText, parseHistoryInput, parseHistoryTime } from "./tools/private-history.ts";

const NOW = Date.parse("2026-10-28T04:00:00Z");

test("不带时区的日期与时间按站点时区读，带时区的照写的算", () => {
  assert.equal(parseHistoryTime("2026-10-27"), Date.parse("2026-10-26T16:00:00Z"));
  assert.equal(parseHistoryTime("2026-10-27T08:30"), Date.parse("2026-10-27T00:30:00Z"));
  assert.equal(parseHistoryTime("2026-10-27T08:30:00Z"), Date.parse("2026-10-27T08:30:00Z"));
  assert.equal(parseHistoryTime("2026-10-27T08:30+09:00"), Date.parse("2026-10-26T23:30:00Z"));
  for (const bad of ["yesterday", "1730000000000", "", 1730000000000, null]) assert.equal(parseHistoryTime(bad), null, String(bad));
});

test("缺省读最近 7 天、100 行；坏输入回一句能照着改的话", () => {
  assert.deepEqual(parseHistoryInput({ table: "workouts" }, NOW), { table: "workouts", from: NOW - 7 * 86_400_000, to: NOW, limit: 100 });
  assert.match(parseHistoryInput({ table: "transcripts" }, NOW) as string, /Unknown table/);
  assert.match(parseHistoryInput({ table: "workouts", from: "2026-10-28", to: "2026-10-27" }, NOW) as string, /earlier/);
  assert.match(parseHistoryInput({ table: "workouts", limit: 501 }, NOW) as string, /limit/);
  assert.match(parseHistoryInput({ table: "workouts", from: "last week" }, NOW) as string, /ISO/);
});

test("列名转成 camelCase，时间列换成本地时间，截断时提示怎么接着读", () => {
  const query = { table: "charging_samples" as const, from: NOW - 3_600_000, to: NOW, limit: 1 };
  const text = historyText(query, { ok: true, rows: [{ t: NOW - 60_000, device_name: "iPhone", watts: 20 }], truncated: true }, NOW);
  assert.match(text, /"observedAt":"2026-10-28 11:59 \(today\)","deviceName":"iPhone","watts":20/);
  assert.match(text, /call again with to set to "2026-10-28T03:59:00\.001Z"/);
  const days = { table: "coding_usage_days" as const, from: NOW - 7 * 86_400_000, to: NOW, limit: 1 };
  assert.match(historyText(days, { ok: true, rows: [{ date: "2026-10-26", tokens: 1 }], truncated: true }, NOW), /to set to "2026-10-27"/);
  assert.match(historyText(query, { ok: false, error: "The history archive is not bound here." }, NOW), /not bound/);
});
