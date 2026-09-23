import assert from "node:assert/strict";
import test from "node:test";

import { pulseLanePath, pulseLaneRuns, pulseScoreWord } from "@/lib/pulse-lane";

const RANGE = { from: 0, to: 1000 };
const SILENT = 100;
const OPTIONS = { width: 100, height: 30, silentAfterMs: SILENT };

test("一笔非空闲撑到静默上限就断，空闲一直撑到窗口末端", () => {
  assert.deepEqual(
    pulseLaneRuns([{ t: 0, level: 3 }], RANGE, SILENT),
    [{ from: 0, to: SILENT, level: 3 }],
  );
  assert.deepEqual(
    pulseLaneRuns([{ t: 0, level: 0 }], RANGE, SILENT),
    [{ from: 0, to: 1000, level: 0 }],
  );
});

test("阶跃路径先竖后横，档位映射到高度", () => {
  const { area, line } = pulseLanePath(
    [{ t: 0, level: 3 }, { t: 50, level: 0 }],
    RANGE,
    OPTIONS,
  );
  // 3 档贴顶（y=0），0 档贴底（y=30）；x 按窗口线性映射，50/1000 → 5
  assert.equal(area, "M0.0 30.0 L0.0 0.0 L5.0 0.0 L5.0 30.0 L100.0 30.0 L100.0 30.0 Z");
  assert.equal(line, "M0.0 0.0 L5.0 0.0 L5.0 30.0 L100.0 30.0");
});

test("静默断口把泳道拆成两笔，中间是真的空白", () => {
  const { area, line } = pulseLanePath(
    [{ t: 0, level: 3 }, { t: 500, level: 2 }],
    RANGE,
    OPTIONS,
  );
  assert.equal(area.match(/M/g)?.length, 2);
  assert.equal(area.match(/Z/g)?.length, 2);
  assert.equal(line.match(/M/g)?.length, 2);
});

test("一个点都没有时两条路径都是空串，卡片据此画空态", () => {
  assert.deepEqual(pulseLanePath([], RANGE, OPTIONS), { area: "", line: "" });
});

test("分四舍五入到四档的词，越界夹住", () => {
  assert.equal(pulseScoreWord(0), "Idle");
  assert.equal(pulseScoreWord(1.68), "Moderate");
  assert.equal(pulseScoreWord(1.4), "Light");
  assert.equal(pulseScoreWord(3.4), "Intense");
  assert.equal(pulseScoreWord(-1), "Idle");
});
