import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  chartSize,
  expandGithubDays,
  formatContributionLabel,
  groupWeeks,
  monthLabels,
  weekdayOf,
} from "./github-chart-compact.ts";

test("按周日把天收成周", () => {
  const weeks = groupWeeks([
    { date: "2025-08-24", weekday: 0, count: 1, score: 1, label: "" },
    { date: "2025-08-17", weekday: 0, count: 0, score: 0, label: "" },
    { date: "2025-08-18", weekday: 1, count: 64, score: 3, label: "" },
  ]);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0]?.map((day) => day.date).join(","), "2025-08-17,2025-08-18");
  assert.equal(weeks[1]?.[0]?.date, "2025-08-24");
});

test("月份标在该月第一个周日那列", () => {
  const weeks = [
    [{ date: "2025-08-17", weekday: 0, count: 0, score: 0 as const, label: "" }],
    [{ date: "2025-08-24", weekday: 0, count: 0, score: 0 as const, label: "" }],
    [{ date: "2025-08-31", weekday: 0, count: 0, score: 0 as const, label: "" }],
    [{ date: "2025-09-07", weekday: 0, count: 0, score: 0 as const, label: "" }],
  ];
  const labels = monthLabels(weeks);
  assert.deepEqual(
    labels.map((label) => `${label.text}@${label.x}`),
    ["Aug@27", "Sep@63"],
  );
});

test("53 周画布对上从前的 663×104", () => {
  assert.deepEqual(chartSize(53), { width: 663, height: 104 });
});

test("weekday 按 UTC 日历算，周日是 0", () => {
  assert.equal(weekdayOf("2025-08-17"), 0);
  assert.equal(weekdayOf("2026-08-18"), 2);
});

test("hover 文案和资料页同一句", () => {
  assert.equal(formatContributionLabel("2025-08-17", 0), "No contributions on August 17th.");
  assert.equal(formatContributionLabel("2025-08-18", 1), "1 contribution on August 18th.");
  assert.equal(formatContributionLabel("2026-08-08", 64), "64 contributions on August 8th.");
  assert.equal(formatContributionLabel("2026-08-11", 107), "107 contributions on August 11th.");
});

test("紧凑信封展开出 date / weekday / label", () => {
  const days = expandGithubDays("2025-08-17", [0, 64], [0, 3]);
  assert.equal(days.length, 2);
  assert.equal(days[0]?.date, "2025-08-17");
  assert.equal(days[0]?.weekday, 0);
  assert.equal(days[0]?.label, "No contributions on August 17th.");
  assert.equal(days[1]?.date, addDays("2025-08-17", 1));
  assert.equal(days[1]?.count, 64);
  assert.equal(days[1]?.score, 3);
  assert.equal(JSON.stringify({ origin: "2025-08-17", counts: [0, 64], scores: [0, 3] }).includes("contributions on"), false);
});
