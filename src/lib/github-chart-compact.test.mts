import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  chartSize,
  expandGithubDays,
  heatmapScores,
  HEATMAP_LEVELS,
  formatContributionLabel,
  groupWeeks,
  monthLabels,
  weekdayOf,
  HEATMAP_WEEKS,
  heatmapFrame,
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

test("年度窗口边缘的单列月份隐藏标题，避免跨月重叠和右侧越界", () => {
  for (const through of ["2026-09-29", "2026-10-04", "2026-01-04"]) {
    const weeks = groupWeeks(heatmapFrame(through).map((date) => ({
      date, weekday: weekdayOf(date), count: 0, score: 0 as const, label: "",
    })));
    const labels = monthLabels(weeks);
    const visible = labels.filter((label) => !label.hidden);
    for (let index = 0; index < visible.length; index++) {
      assert.ok((visible[index + 1]?.x ?? chartSize(weeks.length).width) - visible[index]!.x >= 24);
    }
    if (through === "2026-09-29") {
      assert.equal(labels[0]?.text, "Sep");
      assert.equal(labels[0]?.hidden, true);
      assert.equal(visible[0]?.text, "Oct");
    } else {
      assert.equal(labels.at(-1)?.hidden, true);
    }
  }
});

test("weekday 按 UTC 日历算，周日是 0", () => {
  assert.equal(weekdayOf("2025-08-17"), 0);
  assert.equal(weekdayOf("2026-08-18"), 2);
});

test("hover 文案和资料页同一句", () => {
  assert.equal(formatContributionLabel("2025-08-17", 0), "No contributions on Aug 17.");
  assert.equal(formatContributionLabel("2025-08-18", 1), "1 contribution on Aug 18.");
  assert.equal(formatContributionLabel("2026-08-08", 64), "64 contributions on Aug 8.");
  assert.equal(formatContributionLabel("2026-08-11", 107), "107 contributions on Aug 11.");
  assert.equal(formatContributionLabel("2026-08-11", 1234), "1,234 contributions on Aug 11.");
});

test("紧凑信封展开出 date / weekday / label", () => {
  const days = expandGithubDays("2025-08-17", [0, 64]);
  assert.equal(days.length, 2);
  assert.equal(days[0]?.date, "2025-08-17");
  assert.equal(days[0]?.weekday, 0);
  assert.equal(days[0]?.label, "No contributions on Aug 17.");
  assert.equal(days[1]?.date, addDays("2025-08-17", 1));
  assert.equal(days[1]?.count, 64);
  assert.equal(days[1]?.score, HEATMAP_LEVELS);
  assert.equal(JSON.stringify({ origin: "2025-08-17", counts: [0, 64] }).includes("contributions on"), false);
});

test("非零天按分位分成 HEATMAP_LEVELS 档：空格是 0、最大值顶格、同值同档、越多越深、并列的最小值仍是最浅档", () => {
  const counts = [0, ...Array.from({ length: 16 }, (_, index) => index + 1), 16];
  const scores = heatmapScores(counts);
  assert.equal(scores[0], 0);
  assert.equal(scores[1], 1);
  assert.equal(scores.at(-1), HEATMAP_LEVELS);
  assert.equal(scores.at(-2), scores.at(-1));
  assert.equal(new Set(scores.slice(1)).size, HEATMAP_LEVELS);
  for (let index = 2; index < counts.length; index += 1) assert.ok(scores[index]! >= scores[index - 1]!);
  assert.deepEqual(heatmapScores([0, 0]), [0, 0]);
  assert.deepEqual(heatmapScores([1, 1, 1, 1, 1, 1, 3]), [1, 1, 1, 1, 1, 1, HEATMAP_LEVELS]);
});

test("年度图窗口：今天所在那一周是最后一列，往前一共 53 周，从周日起逐日到今天", () => {
  const frame = heatmapFrame("2026-09-29");
  assert.equal(frame[0], "2025-09-28");
  assert.equal(frame.at(-1), "2026-09-29");
  assert.equal(frame.length, (HEATMAP_WEEKS - 1) * 7 + 3);
  const sunday = heatmapFrame("2026-10-04");
  assert.equal(sunday[0], "2025-10-05");
  assert.equal(sunday.length, (HEATMAP_WEEKS - 1) * 7 + 1);
});
