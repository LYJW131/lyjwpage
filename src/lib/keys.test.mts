import assert from "node:assert/strict";
import test from "node:test";

import { stableKeys } from "./keys.ts";

test("重复 id 按出现次序加 #n 后缀，首个原样", () => {
  assert.deepEqual(stableKeys(["a", "b", "a", "a", "b"]), ["a", "b", "a#1", "a#2", "b#1"]);
  assert.deepEqual(stableKeys([]), []);
  assert.deepEqual(stableKeys(["x"]), ["x"]);
});
