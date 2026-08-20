import assert from "node:assert/strict";
import test from "node:test";

import {
  CHUNK_DAYS,
  YEAR_DAYS,
  addDays,
  chunkLength,
  chunkStarts,
  compactTokens,
  formatTokenLabel,
  normalizeVibeCodingYear,
  tokenScores,
} from "./vibecoding-year.ts";

const ORIGIN = "2025-08-17";

test("53 周切成 4 块，最后一块吃掉尾巴", () => {
  const starts = chunkStarts(ORIGIN);
  assert.deepEqual(starts, ["2025-08-17", "2025-11-16", "2026-02-15", "2026-05-17"]);
  assert.equal(chunkLength(0), CHUNK_DAYS);
  assert.equal(chunkLength(CHUNK_DAYS * 3), YEAR_DAYS - CHUNK_DAYS * 3);
  assert.equal(CHUNK_DAYS * 3 + chunkLength(CHUNK_DAYS * 3), YEAR_DAYS);
});

test("合法的周日块才能收", () => {
  const days = Array.from({ length: CHUNK_DAYS }, () => 1);
  assert.ok(normalizeVibeCodingYear({ origin: ORIGIN, from: ORIGIN, days }));
  assert.equal(
    normalizeVibeCodingYear({ origin: ORIGIN, from: "2025-08-18", days }),
    null,
  );
  assert.equal(
    normalizeVibeCodingYear({ origin: ORIGIN, from: ORIGIN, days: days.slice(1) }),
    null,
  );
});

test("最后一块必须是填满窗口的长度", () => {
  const from = "2026-05-17";
  const length = chunkLength(CHUNK_DAYS * 3);
  const days = Array.from({ length }, () => 2);
  const parsed = normalizeVibeCodingYear({ origin: ORIGIN, from, days });
  assert.ok(parsed);
  assert.equal(parsed.days.length, 98);
  assert.equal(
    normalizeVibeCodingYear({ origin: ORIGIN, from, days: days.slice(0, 91) }),
    null,
  );
});

test("非零天按四分位打档，空格永远是 0", () => {
  const scores = tokenScores([0, 1, 10, 20, 40, 0]);
  assert.equal(scores[0], 0);
  assert.equal(scores[5], 0);
  assert.ok((scores[1] ?? 0) >= 1);
  assert.equal(scores[4], 4);
});

test("hover 文案带 compact token", () => {
  assert.equal(formatTokenLabel("2026-08-08", 0), "No tokens on August 8th.");
  assert.equal(formatTokenLabel("2026-08-08", 1200), "1.2k tokens on August 8th.");
  assert.equal(compactTokens(12_400), "12k");
  assert.equal(addDays(ORIGIN, 91), "2025-11-16");
});
