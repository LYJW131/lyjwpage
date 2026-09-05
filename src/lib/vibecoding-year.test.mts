import assert from "node:assert/strict";
import test from "node:test";

import { formatDayHeading } from "./github-chart-compact.ts";
import { isHeatmapFuture } from "./heatmap-window.ts";
import {
  YEAR_DAYS,
  addDays,
  compactTokens,
  expandYearDays,
  formatTokenLabel,
  indexYearMix,
  normalizeVibeCodingYear,
  tokenScores,
  withYearFreshness,
} from "./vibecoding-year.ts";

const ORIGIN = "2025-08-17";

function days(fill = 1) {
  return Array.from({ length: YEAR_DAYS }, () => fill);
}

function year(extra: Record<string, unknown> = {}) {
  return { origin: ORIGIN, days: days(3), models: [], mix: [], ...extra };
}

test("画格子只到 through，不含窗尾未来空格", () => {
  const expanded = expandYearDays(ORIGIN, days(0));
  const through = addDays(ORIGIN, 365);
  const drawn = expanded.filter((day) => !isHeatmapFuture(day.date, through));
  assert.equal(drawn.at(-1)?.date, through);
  assert.ok(expanded.length > drawn.length);
});

test("53 周日合计才能收，少一天整份不收", () => {
  const parsed = normalizeVibeCodingYear(year());
  assert.ok(parsed);
  assert.equal(parsed.origin, ORIGIN);
  assert.equal(parsed.days.length, YEAR_DAYS);
  assert.deepEqual(parsed.models, []);
  assert.deepEqual(parsed.mix, []);
  assert.equal(
    normalizeVibeCodingYear(year({ days: days().slice(1) })),
    null,
  );
});

test("origin 必须是周日", () => {
  assert.equal(normalizeVibeCodingYear(year({ origin: "2025-08-18" })), null);
});

test("mix 是模型表加稀疏 offset 对，每天最多五名", () => {
  const counts = days(0);
  counts[2] = 100;
  counts[3] = 50;
  const parsed = normalizeVibeCodingYear(
    year({
      days: counts,
      models: ["claude-opus-5", "gpt-5.6-sol"],
      mix: [
        [2, 0, 80, 1, 20],
        [3, 0, 50],
      ],
    }),
  );
  assert.ok(parsed);
  const byOffset = indexYearMix(parsed.models, parsed.mix);
  assert.deepEqual(byOffset.get(2), [
    { model: "claude-opus-5", tokens: 80 },
    { model: "gpt-5.6-sol", tokens: 20 },
  ]);
  assert.deepEqual(byOffset.get(3), [{ model: "claude-opus-5", tokens: 50 }]);
  assert.equal(byOffset.get(0), undefined);
});

test("每天超过五名、offset 越界、拆分超过日合计，整份不收", () => {
  const counts = days(0);
  counts[2] = 100;
  const six = [2, 0, 1, 1, 1, 2, 1, 3, 1, 4, 1, 5, 1];
  assert.equal(
    normalizeVibeCodingYear(
      year({
        days: counts,
        models: ["a", "b", "c", "d", "e", "f"],
        mix: [six],
      }),
    ),
    null,
  );
  assert.equal(
    normalizeVibeCodingYear(
      year({
        days: counts,
        models: ["claude-opus-5"],
        mix: [[371, 0, 1]],
      }),
    ),
    null,
  );
  assert.equal(
    normalizeVibeCodingYear(
      year({
        days: counts,
        models: ["claude-opus-5"],
        mix: [[2, 0, 101]],
      }),
    ),
    null,
  );
  assert.equal(
    normalizeVibeCodingYear({ origin: ORIGIN, days: counts }),
    null,
  );
});

test("非零天按四分位打档，空格永远是 0", () => {
  const counts = Array.from({ length: YEAR_DAYS }, () => 0);
  counts[0] = 1;
  counts[1] = 10;
  counts[2] = 20;
  counts[3] = 40;
  const scores = tokenScores(counts);
  assert.equal(scores[4], 0);
  assert.ok((scores[0] ?? 0) >= 1);
  assert.equal(scores[3], 4);
});

test("hover 文案带 compact token", () => {
  assert.equal(formatDayHeading("2026-08-08"), "August 8th");
  assert.equal(formatTokenLabel("2026-08-08", 0), "No tokens on August 8th.");
  assert.equal(formatTokenLabel("2026-08-08", 1200), "1.2k tokens on August 8th.");
  assert.equal(compactTokens(12_400), "12k");
  assert.equal(addDays(ORIGIN, 91), "2025-11-16");
});

test("云端回填保留早于今天的日总量和模型，每次生成完整窗口", () => {
  const counts = days(0);
  counts[2] = 120;
  counts[300] = 80;
  const parsed = normalizeVibeCodingYear(year({
    days: counts,
    models: ["cursor-model", "local-model"],
    mix: [[2, 0, 120], [300, 1, 80]],
  }));
  assert.ok(parsed);
  const payload = withYearFreshness({ ...parsed, pushedAt: 2_000 });
  assert.equal(payload.days.length, YEAR_DAYS);
  assert.equal(payload.days[2], 120);
  assert.deepEqual(indexYearMix(payload.models, payload.mix).get(2), [
    { model: "cursor-model", tokens: 120 },
  ]);
  assert.equal("daysPartial" in payload, false);
  assert.equal("from" in payload, false);
});

test("今天由源站现盖，上报器停了也不跟着少一格", () => {
  const stopped = Date.parse("2026-08-30T04:15:00+08:00");
  const stored = { origin: ORIGIN, days: days(0), models: [], mix: [], pushedAt: stopped };

  // 上报器停在昨天凌晨，今天仍是今天 —— 切窗要是拿 pushedAt 当钟，今天那格会被切掉
  assert.equal(
    withYearFreshness(stored, Date.parse("2026-08-31T09:00:00+08:00")).todayAtSource,
    "2026-08-31",
  );
  // 站点时区而不是 UTC：东八区 00:30 拿 UTC 切会退回昨天，和 GitHub 那张图错开一列
  assert.equal(
    withYearFreshness(stored, Date.parse("2026-08-31T00:30:00+08:00")).todayAtSource,
    "2026-08-31",
  );
});
