import assert from "node:assert/strict";
import test from "node:test";

import { withDeadline } from "./first-screen.ts";

test("状态读超过上限就报错，首屏按这一读失败降级，不等它回来", async () => {
  const hanging = new Promise<string>(() => {});
  await assert.rejects(withDeadline(hanging, 20), /Deadline 20ms/);
});

test("上限内回来的读照常返回", async () => {
  assert.equal(await withDeadline(Promise.resolve("ok"), 1_000), "ok");
});
