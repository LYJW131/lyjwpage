import assert from "node:assert/strict";
import test from "node:test";

import { formatDayHeading, weekdayOf } from "./github-chart-compact.ts";
import { isHeatmapFuture } from "./heatmap-window.ts";
import {
  YEAR_DAYS,
  addDays,
  compactTokens,
  encodeCodingYear,
  expandYearDays,
  formatTokenLabel,
  indexYearMix,
} from "./coding-year.ts";

const ORIGIN = "2025-08-17";

function days(fill = 1) {
  return Array.from({ length: YEAR_DAYS }, () => fill);
}

test("画格子只到 through，不含窗尾未来空格", () => {
  const expanded = expandYearDays(ORIGIN, days(0));
  const through = addDays(ORIGIN, 365);
  const drawn = expanded.filter((day) => !isHeatmapFuture(day.date, through));
  assert.equal(drawn.at(-1)?.date, through);
  assert.ok(expanded.length > drawn.length);
});

test("年度编码：从今天所在周往回 52 周的周日起共 371 天，没用量的日子是 0、不进 mix，窗口外的日子丢掉", () => {
  const now = Date.parse("2026-08-31T09:00:00+08:00");
  const payload = encodeCodingYear({
    updatedAt: 1_000,
    days: {
      "2025-08-30": { tokens: 999, models: [["too-old", 999]] },
      "2025-08-31": { tokens: 10, models: [["claude-opus-5", 10]] },
      "2026-08-31": { tokens: 30, models: [] },
    },
  }, now);
  assert.equal(payload.origin, "2025-08-31");
  assert.equal(weekdayOf(payload.origin), 0);
  assert.equal(payload.days.length, YEAR_DAYS);
  assert.equal(payload.days[0], 10);
  assert.equal(payload.days[365], 30);
  assert.equal(payload.days.reduce((sum, value) => sum + value, 0), 40);
  assert.deepEqual(payload.models, ["claude-opus-5"]);
  assert.deepEqual(payload.mix, [[0, 0, 10]]);
  assert.equal(payload.updatedAt, 1_000);
});

test("年度编码：每天的前几名按模型表加稀疏 offset 对编码，indexYearMix 能原样展开", () => {
  const now = Date.parse("2026-08-31T09:00:00+08:00");
  const payload = encodeCodingYear({
    updatedAt: 1_000,
    days: {
      "2025-09-02": { tokens: 100, models: [["claude-opus-5", 80], ["gpt-5.6-sol", 20]] },
      "2025-09-03": { tokens: 50, models: [["gpt-5.6-sol", 50]] },
    },
  }, now);
  assert.deepEqual(payload.models, ["claude-opus-5", "gpt-5.6-sol"]);
  assert.deepEqual(payload.mix, [[2, 0, 80, 1, 20], [3, 1, 50]]);
  const byOffset = indexYearMix(payload.models, payload.mix);
  assert.deepEqual(byOffset.get(2), [
    { model: "claude-opus-5", tokens: 80 },
    { model: "gpt-5.6-sol", tokens: 20 },
  ]);
  assert.deepEqual(byOffset.get(3), [{ model: "gpt-5.6-sol", tokens: 50 }]);
  assert.equal(byOffset.get(0), undefined);
});

test("年度编码：今天由出口按钟现算，用量停了也不跟着少一格；按站点时区不按 UTC", () => {
  const stopped = { updatedAt: Date.parse("2026-08-30T04:15:00+08:00"), days: {} };
  assert.equal(encodeCodingYear(stopped, Date.parse("2026-08-31T09:00:00+08:00")).todayAtSource, "2026-08-31");
  assert.equal(encodeCodingYear(stopped, Date.parse("2026-08-31T00:30:00+08:00")).todayAtSource, "2026-08-31");
});

test("hover 文案带 compact token", () => {
  assert.equal(formatDayHeading("2026-08-08"), "August 8th");
  assert.equal(formatTokenLabel("2026-08-08", 0), "No tokens on August 8th.");
  assert.equal(formatTokenLabel("2026-08-08", 1200), "1.2k tokens on August 8th.");
  assert.equal(compactTokens(12_400), "12k");
  assert.equal(addDays(ORIGIN, 91), "2025-11-16");
});
