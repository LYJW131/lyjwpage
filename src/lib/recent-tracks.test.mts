import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { RECENT_VISIBLE_ROWS, RECENT_WIDE_SLOTS, recentTrackSnap } from "./recent-tracks.ts";

test("最后一列吸附到末尾，两列并排时不会停在只露出半列的位置", () => {
  assert.equal(recentTrackSnap(0, 10, RECENT_VISIBLE_ROWS), "start");
  assert.equal(recentTrackSnap(4, 10, RECENT_VISIBLE_ROWS), "start");
  assert.equal(recentTrackSnap(8, 10, RECENT_VISIBLE_ROWS), "end");
  assert.equal(recentTrackSnap(1, 10, RECENT_VISIBLE_ROWS), null);
  assert.equal(recentTrackSnap(9, 10, RECENT_VISIBLE_ROWS), null);
});

test("只有一列时从开头吸附", () => {
  assert.equal(recentTrackSnap(0, 3, RECENT_VISIBLE_ROWS), "start");
  assert.equal(recentTrackSnap(0, 0, RECENT_VISIBLE_ROWS), null);
  assert.equal(recentTrackSnap(-1, 4, RECENT_VISIBLE_ROWS), null);
});

test("刚好铺满两列时，第二列吸附到末尾", () => {
  assert.equal(recentTrackSnap(0, RECENT_WIDE_SLOTS, RECENT_VISIBLE_ROWS), "start");
  assert.equal(recentTrackSnap(RECENT_VISIBLE_ROWS, RECENT_WIDE_SLOTS, RECENT_VISIBLE_ROWS), "end");
});

test("宽屏静态两列的隐藏起点与 RECENT_WIDE_SLOTS 对齐，滚动布局不再裁掉第 9 条", () => {
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const cutoff = RECENT_WIDE_SLOTS + 1;
  assert.match(
    css,
    new RegExp(
      `\\.recent-tracks\\.is-wide:not\\(\\.has-more\\) \\.recent-tracks-track > :nth-child\\(n \\+ ${cutoff}\\)`,
    ),
  );
  assert.doesNotMatch(css, /^\.recent-tracks-track > :nth-child\(n \+ \d+\)/m);
});
