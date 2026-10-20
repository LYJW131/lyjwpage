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

test("上报失败按退避重发同一份采集结果，成功后立即重采一次再等下一轮", async () => {
  const { loop, stats } = harness([false, false, true, true]);
  await assert.rejects(loop, Stop);
  assert.deepEqual(stats(), { collected: 2, pushed: [1, 1, 1, 2], sleeps: [2_000, 4_000] });
});

test("一次成功的上报直接进入正常等待", async () => {
  const { loop, stats } = harness([true]);
  await assert.rejects(loop, Stop);
  assert.deepEqual(stats(), { collected: 1, pushed: [1], sleeps: [] });
});

test("待发信封超过 reuseMs 才重新采集", async () => {
  const { loop, stats } = harness([false, false, true, true], { reuseMs: 5_000, stepMs: 3_000 });
  await assert.rejects(loop, Stop);
  assert.deepEqual(stats().collected, 3);
  assert.deepEqual(stats().pushed, [1, 1, 2, 3]);
});

test("采集失败记为采集失败并等下一轮，不走上报退避、不立刻重采", async () => {
  let clock = 0;
  let collected = 0;
  const events: string[] = [];
  const pushFailures: unknown[] = [];
  const collectFailures: unknown[] = [];
  const loop = runRounds<number>({
    collect: async () => {
      collected += 1;
      events.push(`collect${collected}`);
      if (collected === 1) throw new Error("限额接口 429");
      return collected;
    },
    push: async () => {
      events.push("push");
    },
    waitForNextRound: async () => {
      events.push("wait");
      if (events.filter((event) => event === "wait").length === 2) throw new Stop();
    },
    sleep: async (ms) => {
      events.push(`sleep${ms}`);
      clock += ms;
    },
    onPushFailure: (error) => {
      if (error instanceof Stop) throw error;
      pushFailures.push(error);
    },
    onCollectFailure: (error) => {
      collectFailures.push(error);
    },
    now: () => clock,
    reuseMs: 300_000,
    retryMs: 2_000,
    maxRetryMs: 300_000,
  });
  await assert.rejects(loop, Stop);
  assert.equal(collectFailures.length, 1);
  assert.match(String(collectFailures[0]), /429/);
  assert.deepEqual(pushFailures, []);
  assert.deepEqual(events, ["collect1", "wait", "collect2", "push", "wait"]);
});
