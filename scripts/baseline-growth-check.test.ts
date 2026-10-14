import assert from "node:assert/strict";
import { test } from "node:test";

import { copyGrowth, designGrowth, mjsGrowth } from "./baseline-growth-check.ts";

test("mjs 基线多出的文件算增长，删掉的不算", () => {
  assert.deepEqual(mjsGrowth(["scripts/a.mjs", "scripts/b.mjs"], ["scripts/a.mjs", "scripts/c.mjs"]), ["新增 scripts/c.mjs"]);
  assert.deepEqual(mjsGrowth(["scripts/a.mjs"], []), []);
});

test("design 基线某个类名计数变多或新出现算增长，变少不算", () => {
  assert.deepEqual(
    designGrowth({ "spacing:p-[3px]": 2, "radius:rounded-[5px]": 1 }, { "spacing:p-[3px]": 3, "radius:rounded-[5px]": 0, "fontSize:text-[9px]": 1 }),
    ["fontSize:text-[9px]：0 → 1", "spacing:p-[3px]：2 → 3"],
  );
});

test("ui:copy 基线同文件多一条同样的文案、或换个文件出现都算增长", () => {
  assert.deepEqual(copyGrowth({ "src/a.tsx": ["你好"] }, { "src/a.tsx": ["你好", "你好"], "src/b.tsx": ["你好"] }), [
    "src/a.tsx：“你好”",
    "src/b.tsx：“你好”",
  ]);
  assert.deepEqual(copyGrowth({ "src/a.tsx": ["你好", "再见"] }, { "src/a.tsx": ["再见"] }), []);
});
