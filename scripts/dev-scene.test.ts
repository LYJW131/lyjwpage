import assert from "node:assert/strict";
import test from "node:test";

import { siteDay, stampNow } from "../shared/fixture-time.ts";
import { tokenize } from "./dev-fixtures.ts";
import { buildScene, formatScene, loadScene, parseDuration, setPath, trophyTitleIds, type Envelope } from "./dev-scene.ts";

const NOW = Date.parse("2026-10-14T10:00:00Z");

test("抓取时把绝对时刻改写成相对令牌，注入时平移到新的当下", () => {
  const captured = {
    observedAt: NOW - 90_000.5,
    durationMs: 4_000,
    committedAt: new Date(NOW - 60_000).toISOString(),
    date: siteDay(NOW, -1),
    label: "2026",
  };
  const tokens = tokenize(captured, NOW);
  assert.deepEqual(tokens, { observedAt: "$now-90000", durationMs: 4_000, committedAt: "$iso-60000", date: "$today-1", label: "2026" });
  const later = NOW + 86_400_000;
  assert.deepEqual(stampNow(tokens, later), {
    observedAt: later - 90_000,
    durationMs: 4_000,
    committedAt: new Date(later - 60_000).toISOString(),
    date: siteDay(later, -1),
    label: "2026",
  });
});

test("字段名带非时间单位的大数不当成时刻", () => {
  const captured = { networkRxBytes: NOW + 5_000, traffic: { quotaBytes: 2_000_000_000_000 }, samples: [{ t: NOW - 1_000 }] };
  assert.deepEqual(tokenize(captured, NOW), { networkRxBytes: NOW + 5_000, traffic: { quotaBytes: 2_000_000_000_000 }, samples: [{ t: "$now-1000" }] });
});

test("奖杯目录覆盖游玩列表与 presence 里的全部游戏", () => {
  const views = {
    "/api/status/playing": { ok: true, data: { items: [{ titleId: "PPSA2" }, { titleId: "CUSA1" }, { titleId: "PPSA2" }] } },
    "/api/status/playing/now": { ok: true, data: { playing: { titleId: "PPSA9" } } },
  };
  assert.deepEqual(trophyTitleIds(views), ["PPSA2", "CUSA1", "PPSA9"]);
});

test("场景文件把原始值数组压成一行，内容不变", () => {
  const scene = { views: { "/api/status/x": { ok: true, data: { values: [1, 2, 3], names: ["a,  b", "c"], nested: [{ a: 1 }] } } } };
  const text = formatScene(scene);
  assert.match(text, /"values": \[1, 2, 3\]/);
  assert.deepEqual(JSON.parse(text), scene);
});

test("注入时摘要三格按场景里的 Pulse 重算，标题池收成一句", async () => {
  const base = loadScene("readme-base");
  const scene = { ...base, views: { ...base.views, "/api/status/pulse": "pulse-busy-day.json" }, headline: "代码不停歇" };
  const { views, missing, derived } = await buildScene(scene, NOW);
  assert.equal(derived, true);
  assert.deepEqual(missing, []);
  const pulse = views.get("/api/status/pulse")!.data as { lanes: { coding: { summary: { humanSeconds: number; bothSeconds: number } } } };
  const { humanSeconds, bothSeconds } = pulse.lanes.coding.summary;
  const digest = (views.get("/api/status/digest") as Envelope).data as { headline: string; headlines: string[]; highlights: { topic: string; value: number }[] };
  assert.equal(digest.headline, "代码不停歇");
  assert.deepEqual(digest.headlines, ["代码不停歇"]);
  const coding = digest.highlights.find((highlight) => highlight.topic === "coding");
  assert.equal(coding?.value, Math.round((humanSeconds + bothSeconds) / 1_800) / 2);
});

test("set 按点路径改一份副本，不动原夹具", () => {
  const base = { ok: true, data: { power: { total: 10 } } };
  assert.deepEqual(setPath(base, "data.power.total", 42), { ok: true, data: { power: { total: 42 } } });
  assert.equal(base.data.power.total, 10);
  assert.throws(() => setPath(base, "data.missing.total", 1), /data.missing.total/);
});

test("--age 的时长写法", () => {
  assert.equal(parseDuration("20m"), 1_200_000);
  assert.equal(parseDuration("30s"), 30_000);
  assert.equal(parseDuration("2h"), 7_200_000);
  assert.equal(parseDuration("1500"), 1_500);
  assert.throws(() => parseDuration("soon"));
});

test("场景条目可以从夹具派生变体", async () => {
  const scene = { views: { "/api/status/charger": { from: "charger-idle.json", set: { "data.marker": "variant" } } } };
  const { views } = await buildScene(scene, NOW);
  assert.equal((views.get("/api/status/charger")!.data as { marker: string }).marker, "variant");
});
