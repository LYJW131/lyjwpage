import assert from "node:assert/strict";
import test from "node:test";

import { trophyGroupSnapClass, trophyGroupTrackClass } from "./gaming-columns.ts";

test("奖杯组吸附步长等于当前断点的列数", () => {
  const wide = trophyGroupSnapClass(5);
  assert.match(wide, /md:max-lg:\[&:nth-child\(2n\+1\)\]:snap-start/);
  assert.match(wide, /lg:\[&:nth-child\(3n\+1\)\]:snap-start/);
  assert.equal(wide.includes("md:[&:nth-child(2n+1)]:snap-start"), false);

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
