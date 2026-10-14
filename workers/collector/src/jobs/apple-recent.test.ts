import assert from "node:assert/strict";
import test from "node:test";

import { LISTENING_ELSEWHERE_HOLD_MS } from "@shared/limits";
import { LISTENING_TRACE_JITTER_MS, LISTENING_TRACE_LAG_MS } from "@shared/pulse-listening";

import { ACTIVE_FOLLOW_MS, ACTIVE_HOLD_MS, ACTIVE_POLL_MS, appleRecentDue, followRecentTracks, IDLE_EVERY_MINUTES, maskOwnerName, nextPollAt, OWNER_ALIAS } from "./apple-recent";

const MINUTE = 60_000;
const BOUNDARY = 29_000_000 * MINUTE;

test("闲档只在整 5 分钟拉，列表刚变过就每分钟拉，超出保持期回闲档", () => {
  assert.equal(IDLE_EVERY_MINUTES, 5);
  assert.equal(appleRecentDue(BOUNDARY, undefined), true);
  assert.equal(appleRecentDue(BOUNDARY + MINUTE, undefined), false);
  assert.equal(appleRecentDue(BOUNDARY + MINUTE, BOUNDARY), true);
  assert.equal(appleRecentDue(BOUNDARY + 3 * MINUTE, BOUNDARY + MINUTE), true);
  assert.equal(appleRecentDue(BOUNDARY + 11 * MINUTE, BOUNDARY), false);
  assert.equal(appleRecentDue(BOUNDARY + ACTIVE_HOLD_MS - MINUTE, BOUNDARY), true);
});

function fakeIo(replies: ({ traced: boolean; nextBy?: number } | Error)[], start: number) {
  let now = start;
  const polledAt: number[] = [];
  return {
    polledAt,
    io: {
      clock: () => now,
      wait: async (ms: number) => { now += ms; },
      poll: async () => {
        polledAt.push(now - BOUNDARY);
        const reply = replies.shift() ?? { traced: false };
        if (reply instanceof Error) throw reply;
        return reply;
      },
    },
  };
}

test("活跃档在这一响里接着每 15 秒拉一次，最后一次在下一响之前开始", async () => {
  const { io, polledAt } = fakeIo([], BOUNDARY + 2_000);
  const result = await followRecentTracks(io, { polledAt: BOUNDARY + 1_000, until: BOUNDARY + ACTIVE_FOLLOW_MS });
  assert.equal(ACTIVE_POLL_MS, 15_000);
  assert.deepEqual(polledAt, [16_000, 31_000, 46_000]);
  assert.deepEqual(result, { polls: 3, traced: 0 });
});

test("下一首该上榜的时刻早于下一次拉就提前到那一刻，拉过了不再追", async () => {
  const { io, polledAt } = fakeIo([{ traced: true, nextBy: BOUNDARY + 24_000 }], BOUNDARY + 2_000);
  const result = await followRecentTracks(io, { polledAt: BOUNDARY + 1_000, nextBy: BOUNDARY + 70_000, until: BOUNDARY + ACTIVE_FOLLOW_MS });
  assert.deepEqual(polledAt, [16_000, 24_000, 39_000, 54_000]);
  assert.deepEqual(result, { polls: 4, traced: 1 });
  assert.equal(nextPollAt(BOUNDARY, BOUNDARY + 1_000), BOUNDARY + 3_000, "紧挨着上一次的也隔开几秒");
  assert.equal(nextPollAt(BOUNDARY, BOUNDARY - 1_000), BOUNDARY + ACTIVE_POLL_MS, "已经过去的不算");
});

test("醒来时钟没走也按计划时刻排下一次，不会一次接一次地拉", async () => {
  const frozen = BOUNDARY + 2_000;
  let polls = 0;
  const result = await followRecentTracks({
    clock: () => frozen,
    wait: async () => {},
    poll: async () => { polls += 1; return { traced: false }; },
  }, { polledAt: BOUNDARY + 1_000, until: BOUNDARY + ACTIVE_FOLLOW_MS });
  assert.equal(polls, 3);
  assert.deepEqual(result, { polls: 3, traced: 0 });
});

test("接着拉的某一次失败就停在这一响", async () => {
  const { io, polledAt } = fakeIo([{ traced: false }, new Error("Apple Music 返回 503")], BOUNDARY + 2_000);
  const result = await followRecentTracks(io, { polledAt: BOUNDARY + 1_000, until: BOUNDARY + ACTIVE_FOLLOW_MS });
  assert.deepEqual(polledAt, [16_000, 31_000]);
  assert.deepEqual(result, { polls: 1, traced: 0, error: "Apple Music 返回 503" });
});

test("推断的那首放完后留着的时长盖得住上榜滞后、抖动和一次活跃档拉取", () => {
  assert.ok(LISTENING_ELSEWHERE_HOLD_MS >= LISTENING_TRACE_LAG_MS + LISTENING_TRACE_JITTER_MS + ACTIVE_POLL_MS);
});

test("真名在署名、标题和链接 slug 里都换成站名，其余字段原样", () => {
  const owner = "张三丰";
  const station = `https://music.apple.com/cn/station/${encodeURIComponent(`${owner}的电台`)}/ra.u-1`;
  const masked = maskOwnerName({
    items: [
      { id: "pl.u-1", title: "心血来潮", artist: owner, link: null, durationMs: null, palette: ["#bc5692"] },
      { id: "pl.rp-1", title: "音乐回忆 2025", artist: `${owner}的 Apple Music`, link: null, durationMs: 1 },
      { id: "ra.u-1", title: `${owner}的电台`, artist: "", link: station, durationMs: null },
    ],
    container: { id: "pl.u-1", tracks: [{ id: "t", title: "群青", artist: "YOASOBI" }] },
  }, owner);
  assert.equal(JSON.stringify(masked).includes(owner), false);
  assert.equal(JSON.stringify(masked).includes(encodeURIComponent(owner)), false);
  assert.deepEqual(masked.items.map((item) => [item.title, item.artist]), [
    ["心血来潮", OWNER_ALIAS],
    ["音乐回忆 2025", `${OWNER_ALIAS}的 Apple Music`],
    [`${OWNER_ALIAS}的电台`, ""],
  ]);
  assert.equal(masked.items[2]?.link, `https://music.apple.com/cn/station/${OWNER_ALIAS}${encodeURIComponent("的电台")}/ra.u-1`);
  assert.deepEqual(masked.items[0]?.palette, ["#bc5692"]);
  assert.deepEqual(masked.container, { id: "pl.u-1", tracks: [{ id: "t", title: "群青", artist: "YOASOBI" }] });
});
