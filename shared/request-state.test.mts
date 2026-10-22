import assert from "node:assert/strict";
import test from "node:test";
import { requestState, withRequestState } from "@shared/request-state";

test("重叠异步请求的工作副本互不覆盖", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const values = await Promise.all([
    withRequestState(async () => {
      const state = requestState("state", () => ({ value: 1 }));
      await gate;
      assert.equal(requestState("state", () => ({ value: 9 })), state);
      return state.value;
    }),
    withRequestState(async () => {
      requestState("state", () => ({ value: 2 }));
      release();
      return requestState("state", () => ({ value: 9 })).value;
    }),
  ]);
  assert.deepEqual(values, [1, 2]);
});
