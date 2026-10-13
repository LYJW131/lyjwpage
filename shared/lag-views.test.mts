import assert from "node:assert/strict";
import test from "node:test";

import { getActivitySnapshot, getDigest, serveLagStatus } from "@shared/lag-views";
import { localDate } from "@shared/freshness";
import { sliceGithubChart } from "@shared/github-chart";
import { installLagReader, readLag, writeLag } from "@shared/lag";
import { LAG_KEYS, type LagEntry } from "@shared/lag";
import { MemoryKv } from "@shared/testing/memory-kv";

const rings = {
  secondsFromGMT: 28_800,
  moveKcal: 320, moveGoalKcal: 400, exerciseMinutes: 12, exerciseGoalMinutes: 30,
  standHours: 6, standGoalHours: 12, steps: 5_400, distanceMeters: 4_100, flightsClimbed: 3,
};

test("activity reads the rings from the lag layer: pushedAt is updatedAt and the date boundary is judged at read time", async (t) => {
  const updatedAt = Date.now() - 60_000;
  let entry: LagEntry<unknown> | null = null;
  installLagReader(async (key) => (key === LAG_KEYS.activity ? entry : null));
  t.after(() => installLagReader(null));

  await assert.rejects(getActivitySnapshot, /尚未收到活动圆环上报/);
  entry = { updatedAt, data: { ...rings, date: localDate(Date.now(), rings.secondsFromGMT) } };
  const today = await getActivitySnapshot();
  assert.equal(today.updatedAt, updatedAt);
  assert.equal(today.data.pushedAt, updatedAt);
  assert.equal(today.data.currentAtSource, true);
  assert.equal(today.data.moveKcal, 320);

  entry = { updatedAt, data: { ...rings, date: "2020-01-01" } };
  assert.equal((await getActivitySnapshot()).data.currentAtSource, false, "yesterday's rings are not today's");
});

const origins = { ALLOWED_ORIGINS: "https://lyjw131.com,https://lyjw.me" };

function siteRequest(path: string, origin?: string): Request {
  return new Request(`https://lyjw.me${path}`, origin ? { headers: { Origin: origin } } : {});
}

test("site 直读可滞后层：只出公开模型，带 CORS、取数时刻与 no-store", async (t) => {
  const kv = new MemoryKv();
  installLagReader((key) => readLag(kv, key));
  t.after(() => installLagReader(null));
  const updatedAt = Date.now() - 30_000;
  await writeLag(kv, LAG_KEYS.server, { hostname: "misaka-jp", publicIp: "203.0.113.7", pushedAt: updatedAt }, updatedAt);

  const response = await serveLagStatus(siteRequest("/api/status/server", "https://lyjw131.com"), "server", origins);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://lyjw131.com");
  assert.equal(response.headers.get("Access-Control-Expose-Headers"), "X-Fetched-At, X-Edge-Cache");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.ok(response.headers.get("X-Fetched-At"));
  const body = (await response.json()) as { ok: boolean; updatedAt: number; data: Record<string, unknown> };
  assert.equal(body.ok, true);
  assert.equal(body.updatedAt, updatedAt);
  assert.equal(body.data.hostname, "misaka-jp");
  assert.ok(!("publicIp" in body.data));
});

test("site 直读可滞后层：陌生来源 403，还没有数据时回等待信封", async (t) => {
  installLagReader(async () => null);
  t.after(() => installLagReader(null));

  const foreign = await serveLagStatus(siteRequest("/api/status/limits", "https://lyjwpage-abc.vercel.app"), "limits", origins);
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await foreign.json(), { ok: false });

  const empty = await serveLagStatus(siteRequest("/api/status/limits"), "limits", origins);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { ok: false, error: "尚未收到限额上报" });
});

test("site 直读可滞后层：贡献日历按 since 切窗", async (t) => {
  const chart = { origin: "2026-01-01", counts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
  const kv = new MemoryKv();
  await writeLag(kv, LAG_KEYS.githubChart, chart, Date.now());
  installLagReader((key) => readLag(kv, key));
  t.after(() => installLagReader(null));

  const response = await serveLagStatus(siteRequest("/api/status/github-chart?since=2026-01-08"), "githubChart", origins);
  const body = (await response.json()) as { data: { countsPartial?: boolean } };
  assert.deepEqual(body.data, sliceGithubChart(chart, "2026-01-08"));
  assert.equal(body.data.countsPartial, true);
});

test("the digest view keeps the input hash on the collector side", async (t) => {
  const kv = new MemoryKv();
  const updatedAt = Date.now() - 60_000;
  await writeLag(kv, LAG_KEYS.digest, { headline: "Coding all day", highlights: [{ topic: "coding", value: 22, unit: "hours", atLeast: false, caption: "coding" }], model: "claude-sonnet-5-5", generatedAt: updatedAt - 3_600_000, inputHash: "abc" }, updatedAt);
  installLagReader((key) => readLag(kv, key));
  t.after(() => installLagReader(null));

  const digest = await getDigest();
  assert.equal(digest.updatedAt, updatedAt);
  assert.deepEqual(digest.data, { headline: "Coding all day", highlights: [{ topic: "coding", value: 22, unit: "hours", atLeast: false, caption: "coding" }], model: "claude-sonnet-5-5", generatedAt: updatedAt - 3_600_000 });
});
