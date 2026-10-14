import assert from "node:assert/strict";
import test from "node:test";

import { matchOverride } from "./public-api";

const title = (titleIds: string[]) => ({ npCommunicationId: titleIds.join("+"), titleIds });
const stored = new Map<string, { ok: boolean; [field: string]: unknown }>([
  ["/api/status/trophies", { ok: true, data: "summary" }],
  ["/api/status/trophies?titleids=*", { ok: true, data: { titles: [title(["PPSA1"]), title(["CUSA2", "PPSA2"]), title(["PPSA3"])] } }],
  ["/api/status/coding", { ok: true, data: "coding" }],
  ["/api/lyrics?song=1", { ok: true, data: "lyrics-1" }],
]);
const read = async (path: string) => stored.get(path);
const match = async (path: string) => (await matchOverride(new URL(path, "http://core"), read))?.data;

test("带查询串的注入只答同一个查询", async () => {
  assert.equal(await match("/api/lyrics?song=1"), "lyrics-1");
  assert.equal(await match("/api/lyrics?song=2"), undefined);
});

test("无参注入兜住同路径的增量请求", async () => {
  assert.equal(await match("/api/status/coding?since=123"), "coding");
});

test("titleids 切片从注入的整份目录现切，不拿无参摘要去答", async () => {
  assert.equal(await match("/api/status/trophies"), "summary");
  const sliced = (await match("/api/status/trophies?titleids=PPSA1,PPSA2")) as { titles: { titleIds: string[] }[] };
  assert.deepEqual(sliced.titles.map((t) => t.titleIds), [["PPSA1"], ["CUSA2", "PPSA2"]]);
});

test("没注入整份目录时 titleids 切片不命中", async () => {
  const bare = async (path: string) => (path === "/api/status/trophies" ? { ok: true, data: "summary" } : undefined);
  assert.equal(await matchOverride(new URL("/api/status/trophies?titleids=PPSA1", "http://core"), bare), undefined);
});
