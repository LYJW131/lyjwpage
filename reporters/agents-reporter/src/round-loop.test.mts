import assert from "node:assert/strict";
import test from "node:test";
import { runRounds } from "../dist/round-loop.js";

class Stop extends Error {}

function harness(pushResults: boolean[], { reuseMs = 300_000, stepMs = 0 } = {}) {
  let clock = 0;
  let collected = 0;
  const pushed: number[] = [];
  const sleeps: number[] = [];
  const loop = runRounds<number>({
    collect: async () => ++collected,
    push: async (payload) => {
      pushed.push(payload);
      if (pushResults.shift() === false) throw new Error("fetch failed");
    },
    waitForNextRound: async () => {
      throw new Stop();
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += stepMs || ms;
    },
    onPushFailure: (error) => {
      if (error instanceof Stop) throw error;
    },
    now: () => clock,
    reuseMs,
    retryMs: 2_000,
    maxRetryMs: 300_000,
  });
  return { loop, stats: () => ({ collected, pushed, sleeps }) };
}

test("上报失败按退避重发同一封，不重新采集", async () => {
  const { loop, stats } = harness([false, false, true]);
  await assert.rejects(loop, Stop);
  assert.deepEqual(stats(), { collected: 1, pushed: [1, 1, 1], sleeps: [2_000, 4_000] });
});

test("待发信封超过 reuseMs 才重新采集", async () => {
  const { loop, stats } = harness([false, false, true], { reuseMs: 5_000, stepMs: 3_000 });
  await assert.rejects(loop, Stop);
  assert.deepEqual(stats().collected, 2);
  assert.deepEqual(stats().pushed, [1, 1, 2]);
});
