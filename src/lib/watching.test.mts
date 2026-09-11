import assert from "node:assert/strict";
import test from "node:test";

import type { WatchingItem } from "./types.ts";
import { isNowWatching, splitNowWatching, watchingIdentity } from "./watching.ts";

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
const other = item({
  id: "22364",
  title: "辉夜大小姐想让我告白～天才们的恋爱头脑战～",
  subtitle: "S3:E1 · 伊井野想要被治愈",
});
const e12 = item({
  id: "21820",
  title: "Fate/strange Fake",
  subtitle: "S1:E12 · 逃避の果て",
});

test("正在播的那一集拎出来当 hero，同一集的 BD / WEB 版本也不留在行里", () => {
  const { hero, rest } = splitNowWatching([resume, other], "21840", current);
  assert.equal(hero?.id, "21840");
  assert.deepEqual(rest.map((entry) => entry.id), ["22364"]);
});

test("详情还没到时，续播列表里同 Id 的那一项先顶上", () => {
  const { hero, rest } = splitNowWatching([resume, other], "21821", null);
  assert.equal(hero?.id, "21821");
  assert.deepEqual(rest.map((entry) => entry.id), ["22364"]);
});

test("两边都没有这一项：hero 为 null，列表原样", () => {
  const { hero, rest } = splitNowWatching([other], "21840", null);
  assert.equal(hero, null);
  assert.deepEqual(rest.map((entry) => entry.id), ["22364"]);
});

test("没在播时没有 hero，列表里同名同集也并成一张，不同集不合并", () => {
  const web = item({ ...resume, id: "21840" });
  const { hero, rest } = splitNowWatching([resume, web, e12, other], undefined, null);
  assert.equal(hero, null);
  assert.deepEqual(rest.map((entry) => entry.id), ["21821", "21820", "22364"]);
});

test("同一集两个版本的 identity 相同，不同集不同", () => {
  assert.equal(watchingIdentity(resume), watchingIdentity(current));
  assert.notEqual(watchingIdentity(resume), watchingIdentity(e12));
});

test("正在播按 Id 或同一部的另一个版本来认", () => {
  assert.equal(isNowWatching(current, "21840", current), true);
  assert.equal(isNowWatching(resume, "21840", current), true);
  assert.equal(isNowWatching(resume, "21840", null), false);
  assert.equal(isNowWatching(e12, "21840", current), false);
});
