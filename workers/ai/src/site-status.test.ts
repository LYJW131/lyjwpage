import assert from "node:assert/strict";
import test from "node:test";

import { STATUS_VIEWS } from "@shared/status-views";
import { runShowCard } from "./chat/show-card.ts";
import { newLedger, type ToolIO, type ToolLedger } from "./tools/registry.ts";
import { isImageField, nowListeningHint, runSiteStatusTool, SITE_STATUS_TOOL } from "./tools/site-status.ts";

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

test("逐日数值数组整份返回不分页，并附按月合计与最近几天带日期的值，一次读取就能答出本月总数与某一天", async () => {
  const counts = Array.from({ length: 371 }, (_, i) => i % 3);
  const io = fakeIO(() => ({ ok: true, data: { origin: "2025-10-05", counts } }));
  const { summary, json } = section((await run({ views: ["githubChart"] }, io)).text, "githubChart");
  const parsed = JSON.parse(json);
  assert.deepEqual(parsed.data.counts, counts);
  assert.match(summary, /no paged lists/);
  assert.equal(parsed.data.countsByMonth["2025-10"], counts.slice(0, 27).reduce((a, b) => a + b, 0));
  assert.equal(parsed.data.countsByMonth["2026-10"], counts.slice(361).reduce((a, b) => a + b, 0));
  assert.equal(Object.keys(parsed.data.countsByMonth).length, 13);
  const recent = Object.entries(parsed.data.countsLastDays);
  assert.equal(recent.length, 14);
  assert.deepEqual(recent.at(-1), ["2026-10-10", counts[370]]);
  assert.deepEqual(recent[0], ["2026-09-27", counts[357]]);
  const add = (list: number[]) => list.reduce((a, b) => a + b, 0);
  assert.deepEqual(parsed.data.countsSums, { last7Days: add(counts.slice(-7)), last30Days: add(counts.slice(-30)), all: add(counts) });
});

test("带 todayAtSource 的热力图从数据源的今天往回算最近几天，今天之后补的空格子不算", async () => {
  const days = [...Array.from({ length: 30 }, (_, i) => i + 1), 0, 0, 0];
  const io = fakeIO(() => ({ ok: true, data: { origin: "2026-09-01", todayAtSource: "2026-09-30", days } }));
  const { json } = section((await run({ views: ["codingYear"] }, io)).text, "codingYear");
  const parsed = JSON.parse(json);
  const recent = Object.entries(parsed.data.daysLastDays);
  assert.equal(recent.length, 14);
  assert.deepEqual(recent.at(-1), ["2026-09-30", 30]);
  assert.deepEqual(parsed.data.daysSums, { last7Days: 24 + 25 + 26 + 27 + 28 + 29 + 30, last30Days: 465, all: 465 });
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

const nowListening = (startedAt: number, music: unknown = null) => ({
  ok: true,
  data: {
    music,
    idle: !music,
    elsewhere: {
      title: "片っぽ (Acoustic Version)",
      artist: "eill",
      album: "プレロマンス / フィナーレ。 - EP",
      artworkUrl: "https://is1-ssl.mzstatic.com/a.jpg",
      songId: "1",
      startedAt,
      durationMs: 248_000,
      marginMs: 2_600,
      next: { title: "だから僕は音楽を辞めた", artist: "ヨルシカ", songId: "2", artworkUrl: null, durationMs: 200_000, basis: "order" },
    },
  },
});

test("nowListening 只有推断的 elsewhere 时，结果写明此刻多半正在听，idle 只管 Mac 与 HomePod", async () => {
  const now = 1_800_000_000_000;
  const text = await runSiteStatusTool(async () => Response.json(nowListening(now - 46_000)), ["nowListening"], now);
  const [summary, hint, json] = text.split("## nowListening\n")[1]!.split("\n");
  assert.match(summary!, /^detail=summary/);
  assert.match(hint!, /estimated position is 0:46 of 4:08, so LYJW is most likely listening to "片っぽ \(Acoustic Version\)" by eill right now/);
  assert.match(hint!, /idle and music: null only cover the Mac and HomePod/);
  assert.doesNotMatch(hint!, /\bSay\b|don't say/i, "措辞要求会被模型照抄成英文回答");
  assert.match(json!, /^\{"ok":true/);
});

test("推断的那首刚放完、下一首还没上榜时，仍说多半在听并给出猜的下一首", () => {
  const now = 1_800_000_000_000;
  const hint = nowListeningHint(nowListening(now - 250_000), now);
  assert.match(hint!, /most likely still listening/);
  assert.match(hint!, /likely "だから僕は音楽を辞めた" by ヨルシカ/);
});

test("Mac / HomePod 在放或没有推断时不加说明", () => {
  const now = 1_800_000_000_000;
  assert.equal(nowListeningHint(nowListening(now - 46_000, { title: "Idol", state: "playing" }), now), null);
  assert.equal(nowListeningHint({ ok: true, data: { music: null, idle: true, elsewhere: null } }, now), null);
  assert.equal(nowListeningHint({ ok: false, error: "x" }, now), null);
});

test("时间点字段给成 LYJW 时区的本地时间，时长和普通数字保持原样", async () => {
  const io = fakeIO(() => ({ ok: true, data: { games: [{ name: "月姬", lastPlayedAt: 1_760_160_382_580, playDurationMs: 194_726_000, playCount: 75 }], since: 1_749_703_254_960 } }));
  const { json } = section((await run({ views: ["playing"], query: "月姬" }, io)).text, "playing");
  assert.match(json, /"lastPlayedAt":"2025-10-11 13:26 \(\d+ days ago\)"/);
  assert.match(json, /"since":"2025-06-12 12:40 \(\d+ days ago\)"/);
  assert.match(json, /"playDurationMs":194726000,"playCount":75/);
});

test("Unix 秒的 resetsAt、ISO 字符串的 playedAt 与 pulse 的 window 也给成本地时间", async () => {
  const io = fakeIO(() => ({ ok: true, data: { resetsAt: 1_760_160_382, playedAt: "2025-10-11T05:26:00.000Z", window: { from: 1_760_160_382_580, to: 1_760_160_382_580 }, id: "2025-10-11" } }));
  const { json } = section((await run({ views: ["limits"] }, io)).text, "limits");
  assert.equal(json.replace(/ \(\d+ days ago\)/g, ""), '{"ok":true,"data":{"resetsAt":"2025-10-11 13:26","playedAt":"2025-10-11 13:26","window":{"from":"2025-10-11 13:26","to":"2025-10-11 13:26"},"id":"2025-10-11"}}');
});

test("时间点后面附上按本地日历日算的相对日，凌晨归当天", async () => {
  const now = Date.parse("2026-10-20T14:25:00+08:00");
  const at = (local: string) => Date.parse(`${local}+08:00`);
  const data = { ok: true, data: { lastOnlineAt: at("2026-10-19T02:28:00"), startedAt: at("2026-10-20T00:10:00"), endedAt: at("2026-10-19T23:50:00"), resetsAt: at("2026-10-21T01:00:00") / 1000, playedAt: "2026-10-17T05:00:00.000Z" } };
  const json = (await runSiteStatusTool(async () => Response.json(data), ["playingNow"], now)).split("\n").at(-1);
  assert.equal(json, '{"ok":true,"data":{"lastOnlineAt":"2026-10-19 02:28 (yesterday)","startedAt":"2026-10-20 00:10 (today)","endedAt":"2026-10-19 23:50 (yesterday)","resetsAt":"2026-10-21 01:00 (tomorrow)","playedAt":"2026-10-17 13:00 (3 days ago)"}}');
});

test("pulse 改成带本地时间的行：编码道再长听歌道也在，空闲与暂停去掉，同一首歌的短暂停合成一段", async () => {
  const from = Date.parse("2026-10-20T00:00:00+08:00");
  const n = 2_000;
  const coding = { startSec: Array.from({ length: n }, (_, i) => i * 10), endSec: Array.from({ length: n }, (_, i) => i * 10 + 10), value: Array.from({ length: n }, (_, i) => (i % 2) + 2), agentSources: Array(n).fill(1) };
  const listening = {
    startSec: [0, 3600, 3900, 3960, 4200, 50_000],
    endSec: [3600, 3900, 3960, 4200, 4500, 50_200],
    state: [0, 2, 1, 2, 2, 2],
    title: [null, "水光接天", "水光接天", "水光接天", "EYE", "水光接天"],
    subtitle: [null, "NOMELON NOLEMON", "NOMELON NOLEMON", "NOMELON NOLEMON", "NOMELON NOLEMON", "NOMELON NOLEMON"],
  };
  const pulse = { generatedAt: from + 86_400_000, window: { from, to: from + 86_400_000 }, lanes: { coding: { kind: "coding", segments: coding, summary: { humanSeconds: 0, agentSeconds: 1, bothSeconds: 2 } }, listening: { kind: "state", segments: listening, summary: { activeSeconds: 900, titles: 2 } } } };
  const result = await run({ views: ["pulse"] }, fakeIO(() => ({ ok: true, data: pulse })));
  const lanes = JSON.parse(section(result.text, "pulse").json).data.lanes;
  const day = (time: string) => time.replace(/ \(.*\)$/, "");
  assert.deepEqual(lanes.listening.spans.map((span: { from: string; to: string }) => ({ ...span, from: day(span.from), to: day(span.to) })), [
    { from: "2026-10-20 01:00", to: "2026-10-20 01:10", title: "水光接天", minutes: 10, artist: "NOMELON NOLEMON" },
    { from: "2026-10-20 01:10", to: "2026-10-20 01:15", title: "EYE", minutes: 5, artist: "NOMELON NOLEMON" },
    { from: "2026-10-20 13:53", to: "2026-10-20 13:56", title: "水光接天", minutes: 3, artist: "NOMELON NOLEMON" },
  ]);
  assert.equal(lanes.coding.activeSpans.length, 1);
  assert.equal(lanes.coding.activeSpans[0].minutes, Math.round((n * 10) / 60));
});
