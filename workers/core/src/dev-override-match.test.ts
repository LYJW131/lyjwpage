import assert from "node:assert/strict";
import test from "node:test";

import { matchOverride } from "./public-api";

const stored = new Map([
  ["/api/status/trophies", "summary"],
  ["/api/status/coding", "coding"],
  ["/api/lyrics?song=1", "lyrics-1"],
]);
const read = async (path: string) => stored.get(path);
const match = (path: string) => matchOverride(new URL(path, "http://core"), read);

test("带查询串的注入只答同一个查询", async () => {
  assert.equal(await match("/api/lyrics?song=1"), "lyrics-1");
  assert.equal(await match("/api/lyrics?song=2"), undefined);
});

test("无参注入兜住同路径的增量请求", async () => {
  assert.equal(await match("/api/status/coding?since=123"), "coding");
});

test("titleids 切片不拿无参摘要去答", async () => {
  assert.equal(await match("/api/status/trophies"), "summary");
  assert.equal(await match("/api/status/trophies?titleids=PPSA1"), undefined);
});
