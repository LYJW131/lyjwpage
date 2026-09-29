import assert from "node:assert/strict";
import test from "node:test";

import { rejectedNote } from "../dist/site.js";

test("回执里被拒的 coding 数据写成一行说明，没有被拒的是 null", () => {
  assert.equal(rejectedNote({ rejected: [] }), null);
  assert.equal(rejectedNote({}), null);
  assert.equal(rejectedNote(undefined), null);
  assert.equal(rejectedNote("ok"), null);
  assert.equal(
    rejectedNote({
      rejected: [
        { module: "codingUsage", error: "agents[0].days[2].totalTokens 小于四列之和" },
        { module: "codingTokenBuckets", error: "windows[0].from 必须对齐 5 分钟" },
      ],
    }),
    "codingUsage：agents[0].days[2].totalTokens 小于四列之和；codingTokenBuckets：windows[0].from 必须对齐 5 分钟",
  );
});
