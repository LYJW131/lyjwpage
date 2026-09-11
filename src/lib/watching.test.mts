import assert from "node:assert/strict";
import test from "node:test";

import type { WatchingItem } from "./types.ts";
import { isNowWatching, pinNowWatching, watchingIdentity } from "./watching.ts";

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
