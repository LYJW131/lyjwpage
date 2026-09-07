import assert from "node:assert/strict";
import test from "node:test";

import {
  isSyncEpochCurrent,
  normalizeSyncUpcomingSongIds,
  planSyncUpcomingQueue,
  queuedUpcomingSongIds,
  shouldKeepNaturalNext,
} from "./web-player-sync.ts";

const song = (id: string, isAutoplay = false) => ({ id, isAutoplay });

test("同步后续队列保留顺序和重复曲目，只过滤空 ID", () => {
  assert.deepEqual(
    normalizeSyncUpcomingSongIds(["song-2", "", null, "song-2", undefined, "song-3"]),
    ["song-2", "song-2", "song-3"],
  );
});

test("从当前曲开始读取队列，并排除 MusicKit 自动推荐项", () => {
  assert.deepEqual(
    queuedUpcomingSongIds(
      [song("i.current"), song("next-1"), song("auto-1", true), song("next-2")],
      "current",
    ),
    ["next-1", "next-2"],
  );
});

test("完全相同的重复队列不需要重新排尾", () => {
  const plan = planSyncUpcomingQueue(
    [song("current"), song("next"), song("next"), song("last")],
    "current",
    ["next", "next", "last"],
  );
  assert.equal(plan.matches, true);
  assert.equal(plan.action, "none");
});

test("来源队列缩短时必须清掉旧尾巴，而不是只比较前缀", () => {
  const plan = planSyncUpcomingQueue(
    [song("current"), song("next-1"), song("next-2")],
    "current",
    ["next-1"],
  );
  assert.deepEqual(plan.queuedSongIds, ["next-1", "next-2"]);
  assert.equal(plan.matches, false);
  assert.equal(plan.action, "replace-upcoming");
});

test("来源队列变空时产生 clear-upcoming 计划", () => {
  const plan = planSyncUpcomingQueue(
    [song("current"), song("stale-1"), song("stale-2")],
    "current",
    [],
  );
  assert.equal(plan.matches, false);
  assert.equal(plan.action, "clear-upcoming");
  assert.deepEqual(plan.desiredSongIds, []);
});

test("自然下一首先于旧 host 锚点到达时保留本地进度", () => {
  assert.equal(
    shouldKeepNaturalNext({
      queueItems: [song("host"), song("local")],
      hostSongId: "host",
      localSongId: "local",
      hostPositionMs: 196_000,
      hostDurationMs: 200_000,
    }),
    true,
  );
});

test("host 真拖回歌中间时允许切回 host 曲目", () => {
  assert.equal(
    shouldKeepNaturalNext({
      queueItems: [song("host"), song("local")],
      hostSongId: "host",
      localSongId: "local",
      hostPositionMs: 100_000,
      hostDurationMs: 200_000,
    }),
    false,
  );
});

test("用户控制或新来源刷新后，旧异步同步任务失效", () => {
  const expected = { generation: 4, revision: 9 };
  assert.equal(isSyncEpochCurrent(expected, expected, true), true);
  assert.equal(
    isSyncEpochCurrent({ generation: 5, revision: 9 }, expected, true),
    false,
  );
  assert.equal(
    isSyncEpochCurrent({ generation: 4, revision: 10 }, expected, true),
    false,
  );
  assert.equal(isSyncEpochCurrent(expected, expected, false), false);
});

test("总时长未知时不能认定旧锚点位于歌尾", () => {
  assert.equal(shouldKeepNaturalNext({
    queueItems: [song("host"), song("local")],
    hostSongId: "host",
    localSongId: "local",
    hostPositionMs: 100_000,
    hostDurationMs: 0,
  }), false);
});
