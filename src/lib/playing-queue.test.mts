import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogItemId,
  mediaItemIndex,
  normalizePlayingQueue,
  upcomingQueueTracks,
} from "./playing-queue.ts";

const QUEUE = {
  beta: true,
  source: "音乐",
  index: 1,
  tracks: [
    { title: "A", trackID: "AAAAAAAAAAAAAAAA" },
    { title: "B" },
    { title: "C", trackID: "CCCCCCCCCCCCCCCC" },
    { title: "D", trackID: "DDDDDDDDDDDDDDDD" },
  ],
};

test("收下上报器的 queue：只留目录查询用的三样，persistent ID 不收", () => {
  const queue = normalizePlayingQueue(QUEUE);
  assert.deepEqual(queue, {
    index: 1,
    tracks: [
      { title: "A", artist: null, album: null },
      { title: "B", artist: null, album: null },
      { title: "C", artist: null, album: null },
      { title: "D", artist: null, album: null },
    ],
  });
});

test("后面两首从 index 往后切", () => {
  const queue = normalizePlayingQueue(QUEUE);
  assert.deepEqual(
    upcomingQueueTracks(queue, "B").map((track) => track.title),
    ["C", "D"],
  );
});

test("index 对不上时标题唯一才猜", () => {
  const queue = normalizePlayingQueue({ ...QUEUE, index: null });
  assert.deepEqual(
    upcomingQueueTracks(queue, "B").map((track) => track.title),
    ["C", "D"],
  );
  assert.deepEqual(upcomingQueueTracks(queue, "没有这首"), []);
});

test("最后一首后面是空的", () => {
  const queue = normalizePlayingQueue({ ...QUEUE, index: 3 });
  assert.deepEqual(upcomingQueueTracks(queue, "D"), []);
});

test("MusicKit 条目 ID 去掉 i. 再对 songId", () => {
  assert.equal(catalogItemId("i.1690036415"), "1690036415");
  assert.equal(mediaItemIndex([{ id: "111" }, { id: "i.222" }], "222"), 1);
  assert.equal(mediaItemIndex([{ id: "111" }], "222"), -1);
});
