import assert from "node:assert/strict";
import { test } from "node:test";

import { githubChartWeeks } from "./github-chart-history.ts";

const payload = { origin: "2025-09-28", counts: Array.from({ length: 367 }, (_, i) => i % 5) };

test("贡献图画到浏览器的今天：跨过零点、数据还没到的今天画成 0 的一格", () => {
  const drawn = githubChartWeeks(payload).flat();
  assert.equal(drawn.at(-1)?.date, "2026-09-29");
  const rolled = githubChartWeeks(payload, "2026-09-30").flat();
  assert.equal(rolled.length, drawn.length + 1);
  assert.deepEqual({ ...rolled.at(-1), label: undefined }, { date: "2026-09-30", weekday: 3, count: 0, score: 0, label: undefined });
  assert.equal(rolled.at(-2)?.count, drawn.at(-1)?.count, "已有的数原样填进去");
});

test("跨到新的一周：最早一列出窗，还是 53 列；浏览器的钟慢了就按数据画", () => {
  const weeks = githubChartWeeks(payload, "2026-10-04");
  assert.equal(weeks.length, 53);
  assert.equal(weeks[0][0].date, "2025-10-05");
  assert.equal(githubChartWeeks(payload, "2026-09-20").flat().at(-1)?.date, "2026-09-29");
});
