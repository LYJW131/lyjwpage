import assert from "node:assert/strict";
import test from "node:test";

import { trophiesTilePath, TROPHIES_PATH } from "./paths.ts";

test("同一组 titleIds 顺序不同也落在同一个缓存键上", () => {
  assert.equal(trophiesTilePath(["b", "a", "c"]), trophiesTilePath(["c", "a", "b"]));
  assert.equal(trophiesTilePath(["a", "b", "c"]), `${TROPHIES_PATH}?titleids=${encodeURIComponent("a,b,c")}`);
});

test("不同集合与空集各自成键", () => {
  assert.equal(trophiesTilePath([]), `${TROPHIES_PATH}?titleids=`);
  assert.notEqual(trophiesTilePath(["a"]), trophiesTilePath(["b"]));
  assert.notEqual(trophiesTilePath(["a", "b"]), trophiesTilePath(["a"]));
});
