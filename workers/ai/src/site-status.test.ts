import assert from "node:assert/strict";
import test from "node:test";

import { STATUS_VIEWS } from "@/lib/status-views";
import { runShowCard } from "./chat/show-card.ts";
import { newLedger, type ToolIO, type ToolLedger } from "./tools/registry.ts";
import { isImageField, SITE_STATUS_TOOL } from "./tools/site-status.ts";

const games = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    name: `Game ${i + 1}`,
    coverUrl: `https://cdn.example/covers/${i + 1}.png`,
    store: `https://store.example/game/${i + 1}`,
    playedAt: 1_700_000_000_000 + i,
    progress: i,
  }));

function fakeIO(data: () => unknown, paths: string[] = []): ToolIO {
  return {
    readStatus: async (path) => {
      paths.push(path);
      return Response.json(data());
    },
    readDoc: async () => new Response(""),
  };
}

const run = (input: unknown, io: ToolIO, ledger: ToolLedger = newLedger()) => SITE_STATUS_TOOL.run(input, io, ledger);

function section(text: string, view: string) {
  const body = text.split(`## ${view}\n`)[1] ?? "";
  const [summary, json] = body.split("\n");
  return { summary, json };
}

const cursorOf = (summary: string) => summary.match(/nextCursor: ([A-Za-z0-9_-]+)/)?.[1];

test("默认精简第一页，沿 nextCursor 读到最后一页没有 nextCursor 字段", async () => {
  const io = fakeIO(() => ({ ok: true, data: { games: games(60), avatarUrl: "/img/abc" } }));
  const ledger = newLedger();
  const first = await run({ views: ["playing"] }, io, ledger);
  assert.equal(first.isError, false);
  const page1 = section(first.text, "playing");
  const parsed = JSON.parse(page1.json);
  assert.equal(parsed.data.games.total, 60);
  assert.equal(parsed.data.games.items.length, 20);
  assert.equal(parsed.data.games.items[0].name, "Game 1");
  assert.equal(parsed.data.games.items[0].coverUrl, undefined);
  assert.equal(parsed.data.games.items[0].store, "https://store.example/game/1");
  assert.equal(parsed.data.avatarUrl, undefined);
  assert.ok(parsed.data.games.nextCursor);
  assert.equal(cursorOf(page1.summary), parsed.data.games.nextCursor);

  const second = await run({ cursor: parsed.data.games.nextCursor }, io, ledger);
  const page2 = JSON.parse(section(second.text, "playing").json);
  assert.equal(page2.data.games.items[0].name, "Game 21");
  const third = await run({ cursor: page2.data.games.nextCursor }, io, ledger);
  const page3 = section(third.text, "playing");
  const last = JSON.parse(page3.json);
  assert.deepEqual(last.data.games.items.map((game: { name: string }) => game.name), games(60).slice(40).map((game) => game.name));
  assert.equal("nextCursor" in last.data.games, false);
  assert.match(page3.summary, /last page/);
  assert.deepEqual(third.views, ["playing"]);
  assert.deepEqual([...ledger.views], ["playing"]);
});

test("detail=full 保留图片字段，短列表保持原样", async () => {
  const io = fakeIO(() => ({ games: games(3), iconUrl: "https://cdn.example/a.webp" }));
  const full = JSON.parse(section((await run({ views: ["playing"], detail: "full" }, io)).text, "playing").json);
  assert.equal(full.games[0].coverUrl, "https://cdn.example/covers/1.png");
  assert.equal(full.iconUrl, "https://cdn.example/a.webp");
  assert.ok(Array.isArray(full.games));
});

test("图片字段按键名与图片 URL 判定，非图片链接与普通字段保留", () => {
  assert.ok(isImageField("artworkUrl", "x"));
  assert.ok(isImageField("posterKey", "abc"));
  assert.ok(isImageField("trophyIconUrl", null));
  assert.ok(isImageField("url", "https://cdn.example/p.JPG?w=100"));
  assert.ok(isImageField("src", "/img/abcdef"));
  assert.ok(!isImageField("coverage", 0.5));
  assert.ok(!isImageField("artist", "Ado"));
  assert.ok(!isImageField("url", "https://store.example/game/1"));
});

test("query 不分大小写与全半角，返回 total 与 totalBeforeQuery；没有匹配时 items 为空", async () => {
  const list = [...games(30), { name: "ＥＬＤＥＮ Ring" }, { name: "elden ring nightreign" }];
  const io = fakeIO(() => ({ games: list, owner: "LYJW" }));
  const hit = await run({ views: ["playing"], query: "  Elden  " }, io);
  const { summary, json } = section(hit.text, "playing");
  const parsed = JSON.parse(json);
  assert.equal(parsed.games.total, 2);
  assert.equal(parsed.games.totalBeforeQuery, 32);
  assert.deepEqual(parsed.games.items.map((game: { name: string }) => game.name), ["ＥＬＤＥＮ Ring", "elden ring nightreign"]);
  assert.equal(parsed.owner, "LYJW");
  assert.match(summary, /2 of 32 match/);

  const miss = await run({ views: ["playing"], query: "zelda" }, io);
  const empty = section(miss.text, "playing");
  assert.deepEqual(JSON.parse(empty.json).games.items, []);
  assert.match(empty.summary, /0 of 32 match, 0 items/);

  const blank = JSON.parse(section((await run({ views: ["playing"], query: "   " }, io)).text, "playing").json);
  assert.equal(blank.games.total, 32);
  assert.equal("totalBeforeQuery" in blank.games, false);
});

test("只传 cursor 也能读，沿用其中的 query 与 detail，冲突参数被忽略并提示", async () => {
  const list = games(50).map((game, i) => ({ ...game, name: i % 2 ? `Odd ${i}` : `Even ${i}` }));
  const paths: string[] = [];
  const io = fakeIO(() => ({ games: list }), paths);
  const first = await run({ views: ["playing"], query: "even", detail: "full" }, io);
  const cursor = cursorOf(section(first.text, "playing").summary);
  assert.ok(cursor);
  const next = await run({ cursor, views: ["desktop"], query: "odd", detail: "summary" }, io);
  assert.equal(next.isError, false);
  assert.deepEqual(next.views, ["playing"]);
  assert.deepEqual(paths, [STATUS_VIEWS.playing.path, STATUS_VIEWS.playing.path]);
  const page = JSON.parse(section(next.text, "playing").json);
  assert.equal(page.games.total, 25);
  assert.equal(page.games.items[0].name, "Even 40");
  assert.ok(page.games.items[0].coverUrl);
  assert.match(next.text, /cursor given, so views, detail, query were ignored/);
});

test("非法 cursor 返回 isError，不抛异常、不占额度", async () => {
  const io = fakeIO(() => ({ games: games(10) }));
  const ledger = newLedger();
  for (const cursor of ["not a cursor!", "eyJ4IjoxfQ", 42, btoa(JSON.stringify(["bogus", 20, "", "summary", [60]]))]) {
    const result = await run({ cursor }, io, ledger);
    assert.equal(result.isError, true);
    assert.match(result.text, /Invalid cursor.*without cursor/);
  }
  const valid = await run({ views: ["playing"] }, fakeIO(() => ({ games: games(60) })), newLedger());
  const outOfRange = await run({ cursor: cursorOf(section(valid.text, "playing").summary) }, io, ledger);
  assert.equal(outOfRange.isError, true);
  assert.equal(ledger.reads?.size, 0);
  assert.equal(ledger.views.size, 0);
});

test("翻页期间总数变化时摘要提示；摘要在开头，JSON 被截断时摘要仍完整", async () => {
  let count = 60;
  const io = fakeIO(() => ({ games: games(count).map((game) => ({ ...game, note: "x".repeat(600) })) }));
  const ledger = newLedger();
  const first = await run({ views: ["playing"] }, io, ledger);
  const page1 = section(first.text, "playing");
  assert.match(page1.summary, /^detail=summary \| lists: games \(60 total, items 1-20\) \| nextCursor: /);
  assert.match(page1.json, /…\[truncated\]$/);
  const cursor = cursorOf(page1.summary);
  assert.ok(cursor);
  count = 61;
  const second = await run({ cursor }, io, ledger);
  assert.match(section(second.text, "playing").summary, /lists changed while paging, items may repeat or be missing/);
});

test("同一条回复里完全相同的读取被拒，换页或换 query 可读并计入 8 次上限", async () => {
  const io = fakeIO(() => ({ games: games(60) }));
  const ledger = newLedger();
  const first = await run({ views: ["playing"] }, io, ledger);
  const same = await run({ views: ["playing"] }, io, ledger);
  assert.equal(same.isError, true);
  assert.match(same.text, /Already read earlier in this reply/);
  await run({ cursor: cursorOf(section(first.text, "playing").summary) }, io, ledger);
  for (const query of ["1", "2", "3", "4", "5", "6"]) assert.equal((await run({ views: ["playing"], query }, io, ledger)).isError, false);
  assert.equal(ledger.reads?.size, 8);
  const over = await run({ views: ["playing"], query: "7" }, io, ledger);
  assert.equal(over.isError, true);
  assert.match(over.text, /at most 8 views or pages/);
  assert.deepEqual([...ledger.views], ["playing"]);
});

test("没有 reads 的旧账本第一次使用时再初始化", async () => {
  const ledger: ToolLedger = { views: new Set(), docs: new Set() };
  await run({ views: ["playing"] }, fakeIO(() => ({ games: games(2) })), ledger);
  assert.equal(ledger.reads?.size, 1);
});

test("show_card 回给模型的是精简后的第一页，带摘要与 nextCursor", async () => {
  const io = fakeIO(() => ({ games: games(60) }));
  const text = await runShowCard("playing", io, newLedger());
  const { summary, json } = section(text, "playing");
  assert.match(summary, /nextCursor: /);
  const parsed = JSON.parse(json);
  assert.equal(parsed.games.items.length, 20);
  assert.equal(parsed.games.items[0].coverUrl, undefined);
});
