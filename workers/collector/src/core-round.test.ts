import assert from "node:assert/strict";
import test from "node:test";

import { driveCoreRound } from "./core-round.ts";

test("每分钟把采集 cron 的 scheduledTime 原样交给 core 的 cronRound", async () => {
  const calls: number[] = [];
  await driveCoreRound({ cronRound: async (time) => { calls.push(time); return { ran: true }; } }, 1_791_916_968_000);
  assert.deepEqual(calls, [1_791_916_968_000]);
});

test("core 这一轮抛错或还没有 cronRound 时只记 warn，不让采集这一分钟失败", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  await driveCoreRound({ cronRound: async () => { throw new Error("The RPC receiver does not implement the method \"cronRound\"."); } }, 0);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]?.arguments[1]), /cronRound/);
});
