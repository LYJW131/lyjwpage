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

test("列名转成 camelCase，时间列换成本地时间", () => {
  const query = { table: "charging_samples" as const, from: NOW - 3_600_000, to: NOW, limit: 5 };
  const text = historyText(query, { ok: true, rows: [{ t: NOW - 60_000, device_name: "iPhone", watts: 20 }], truncated: false }, NOW);
  assert.match(text, /"observedAt":"2026-10-28 11:59 \(today\)","deviceName":"iPhone","watts":20/);
  assert.match(historyText(query, { ok: false, error: "The history archive is not bound here." }, NOW), /not bound/);
});

test("截断时去掉最旧那一刻的整组行，给无损且一定往前走的续读 to", () => {
  const samples = { table: "charging_samples" as const, from: 0, to: NOW, limit: 3 };
  const page = historyText(samples, { ok: true, rows: [{ t: 3_000 }, { t: 2_000 }, { t: 1_500 }], truncated: true }, NOW);
  assert.match(page, /^2 rows/m);
  assert.match(page, /to set to "1970-01-01T00:00:01\.500Z"/);
  const days = { table: "coding_usage_days" as const, from: 0, to: NOW, limit: 3 };
  const dayPage = historyText(days, { ok: true, rows: [{ date: "2026-10-27" }, { date: "2026-10-26" }, { date: "2026-10-26" }], truncated: true }, NOW);
  assert.match(dayPage, /^1 rows/m);
  assert.match(dayPage, /to set to "2026-10-26"/);
  assert.equal((parseHistoryInput({ table: "coding_usage_days", to: "2026-10-26" }, NOW) as { to: number }).to, Date.parse("2026-10-25T16:00:00Z"), "day 表的 to 落在那天零点，那一天不含");
  const stuck = historyText({ ...samples, limit: 1 }, { ok: true, rows: [{ t: 3_000 }], truncated: true }, NOW);
  assert.match(stuck, /higher limit/);
});
