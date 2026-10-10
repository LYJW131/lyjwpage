import assert from "node:assert/strict";
import test from "node:test";

import type { WatchingItem } from "./types.ts";
import {
  currentWatchingItem,
  isNowWatching,
  pinNowWatching,
  watchProgressLabel,
  watchRunStyle,
  watchingIdentity,
} from "./watching.ts";

function item(partial: Partial<WatchingItem> & Pick<WatchingItem, "id" | "title">): WatchingItem {
  return {
    subtitle: "",
    progress: 0,
    poster: null,
    backdrop: null,
    type: "Episode",
    year: null,
    link: null,
    playedAt: null,
    ...partial,
  };
}

test("同一集 BD / WEB 两个 Id：正在播放置顶，续播那张丢掉", () => {
  const resume = item({
    id: "21821",
    title: "Fate/strange Fake",
    subtitle: "S1:E13 · 夢幻は現となりて",
  });
  const current = item({
    id: "21840",
    title: "Fate/strange Fake",
    subtitle: "S1:E13 · 夢幻は現となりて",
  });
  const other = item({
    id: "22364",
    title: "辉夜大小姐想让我告白～天才们的恋爱头脑战～",
    subtitle: "S3:E1 · 伊井野想要被治愈",
  });

  assert.deepEqual(
    pinNowWatching([resume, other], current).map((entry) => entry.id),
    ["21840", "22364"],
  );
});

test("Id 相同仍按原样去重", () => {
  const episode = item({
    id: "21821",
    title: "Fate/strange Fake",
    subtitle: "S1:E13 · 夢幻は現となりて",
  });
  assert.deepEqual(
    pinNowWatching([episode], episode).map((entry) => entry.id),
    ["21821"],
  );
});

test("没在播时列表里同名同集也并成一张", () => {
  const bd = item({
    id: "21821",
    title: "Fate/strange Fake",
    subtitle: "S1:E13 · 夢幻は現となりて",
  });
  const web = item({
    id: "21840",
    title: "Fate/strange Fake",
    subtitle: "S1:E13 · 夢幻は現となりて",
  });
  assert.deepEqual(
    pinNowWatching([bd, web], null).map((entry) => entry.id),
    ["21821"],
  );
});

test("同一集两个版本的 identity 相同，不同集不同", () => {
  const bd = item({
    id: "21821",
    title: "Fate/strange Fake",
    subtitle: "S1:E13 · 夢幻は現となりて",
  });
  const web = item({
    id: "21840",
    title: "Fate/strange Fake",
    subtitle: "S1:E13 · 夢幻は現となりて",
  });
  const other = item({
    id: "21820",
    title: "Fate/strange Fake",
    subtitle: "S1:E12 · 逃避の果て",
  });
  assert.equal(watchingIdentity(bd), watchingIdentity(web));
  assert.notEqual(watchingIdentity(bd), watchingIdentity(other));
});

test("并掉重复项时条用续播那份，哪怕比开播时记下的更低", () => {
  const resume = item({
    id: "21821",
    title: "Fate/strange Fake",
    subtitle: "S1:E13 · 夢幻は現となりて",
    progress: 12,
  });
  const current = item({
    id: "21840",
    title: "Fate/strange Fake",
    subtitle: "S1:E13 · 夢幻は現となりて",
    progress: 14.7,
  });
  const [pinned] = pinNowWatching([resume], current);
  assert.equal(pinned.id, "21840");
  assert.equal(pinned.progress, 12);
});

test("正在播按 Id 或同一部的另一个版本来认", () => {
  const resume = item({
    id: "21821",
    title: "Fate/strange Fake",
    subtitle: "S1:E13 · 夢幻は現となりて",
  });
  const current = item({
    id: "21840",
    title: "Fate/strange Fake",
    subtitle: "S1:E13 · 夢幻は現となりて",
  });
  assert.equal(isNowWatching(current, "21840", current), true);
  assert.equal(isNowWatching(resume, "21840", current), true);
  assert.equal(isNowWatching(resume, "21840", null), false);
});

test("进度读数四舍五入，0 不显示", () => {
  assert.equal(watchProgressLabel(0), null);
  assert.equal(watchProgressLabel(0.4), null);
  assert.equal(watchProgressLabel(31.012), "31%");
  assert.equal(watchProgressLabel(70.368), "70%");
  assert.equal(watchProgressLabel(Number.NaN), null);
  assert.equal(watchProgressLabel(140), "100%");
});

test("减弱动效或没有时长时进度条停在当前百分比，不跑向 100%", () => {
  const live = {
    progress: 36.2,
    live: true,
    paused: false,
    positionMs: 514_000,
    durationMs: 1_421_000,
    reducedMotion: false,
  };
  assert.equal(watchRunStyle(live).animationName, "progress-run");
  assert.equal(watchRunStyle(live).animationDelay, "-514000ms");
  assert.equal(watchRunStyle(live).width, "36%");
  assert.equal(watchRunStyle({ ...live, reducedMotion: true }).animationName, undefined);
  assert.equal(watchRunStyle({ ...live, reducedMotion: true }).width, "36%");
  assert.equal(watchRunStyle({ ...live, live: false }).animationName, undefined);
  assert.equal(watchRunStyle({ ...live, durationMs: null }).animationName, undefined);
  assert.equal(watchRunStyle({ ...live, paused: true }).animationPlayState, "paused");
});

test("此刻详情还没到时，用续播列表里同一个 Id 的那一集", () => {
  const listed = item({ id: "22099", title: "我推的孩子", poster: "/img/abc.webp" });
  const current = item({ id: "22099", title: "我推的孩子", poster: "/img/from-session.webp" });
  assert.equal(currentWatchingItem(current, [listed], "22099")?.poster, "/img/from-session.webp");
  assert.equal(currentWatchingItem(null, [listed], "22099")?.poster, "/img/abc.webp");
  assert.equal(currentWatchingItem(null, [listed], "999"), null);
  assert.equal(currentWatchingItem(null, [listed], undefined), null);
});

test("不同集不合并", () => {
  const e12 = item({
    id: "21820",
    title: "Fate/strange Fake",
    subtitle: "S1:E12 · 逃避の果て",
  });
  const e13 = item({
    id: "21821",
    title: "Fate/strange Fake",
    subtitle: "S1:E13 · 夢幻は現となりて",
  });
  assert.deepEqual(
    pinNowWatching([e12, e13], null).map((entry) => entry.id),
    ["21820", "21821"],
  );
});
