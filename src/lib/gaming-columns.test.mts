import assert from "node:assert/strict";
import test from "node:test";

import {
  GAME_TILE_ROWS,
  gameColumnSnapClass,
  isColumnStart,
  keepPartialGameColumn,
  trophyGroupColumns,
  trophyGroupSnapClass,
  trophyGroupTrackClass,
} from "./gaming-columns.ts";

test("不满一列的游戏仍全部展示", () => {
  const tiles = Array.from({ length: 32 }, (_, index) => index);
  assert.equal(tiles.length % GAME_TILE_ROWS, 2);
  assert.deepEqual(keepPartialGameColumn(tiles), tiles);
  assert.deepEqual(keepPartialGameColumn([0, 1]), [0, 1]);
  assert.deepEqual(keepPartialGameColumn([]), []);
});

test("游戏瓷砖只在列首吸附", () => {
  assert.equal(GAME_TILE_ROWS, 3);
  assert.equal(gameColumnSnapClass(), "[&:nth-child(3n+1)]:snap-start");
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].filter((index) => isColumnStart(index, GAME_TILE_ROWS)),
    [0, 3],
  );
});

test("奖杯组吸附步长等于当前断点的列数", () => {
  assert.equal(trophyGroupColumns(5, "base"), 1);
  assert.equal(trophyGroupColumns(5, "md"), 2);
  assert.equal(trophyGroupColumns(5, "lg"), 3);
  assert.equal(trophyGroupColumns(2, "lg"), 2);
  assert.equal(trophyGroupColumns(1, "lg"), 1);

  const wide = trophyGroupSnapClass(5);
  assert.match(wide, /md:max-lg:\[&:nth-child\(2n\+1\)\]:snap-start/);
  assert.match(wide, /lg:\[&:nth-child\(3n\+1\)\]:snap-start/);
  assert.equal(wide.includes("md:[&:nth-child(2n+1)]:snap-start"), false);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].filter((index) => isColumnStart(index, trophyGroupColumns(5, "lg"))),
    [0, 3],
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].filter((index) => isColumnStart(index, trophyGroupColumns(5, "md"))),
    [0, 2, 4],
  );

  const pair = trophyGroupSnapClass(2);
  assert.match(pair, /md:\[&:nth-child\(2n\+1\)\]:snap-start/);
  assert.equal(pair.includes("lg:"), false);
  assert.equal(trophyGroupSnapClass(1).includes("snap-start"), false);
});

test("两列及以下的奖杯组轨道在桌面仍是两列", () => {
  assert.match(trophyGroupTrackClass(2), /md:auto-cols-/);
  assert.equal(trophyGroupTrackClass(2).includes("lg:"), false);
  assert.match(trophyGroupTrackClass(4), /lg:auto-cols-\[calc\(\(100%-1\.5rem\)\/3\)\]/);
});
