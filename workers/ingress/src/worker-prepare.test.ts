import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { prepareIngest } from "@shared/ingest/prepare";
import { resetStoredImageCacheForTests } from "@shared/ingest/r2-assets";

import { codingUsage, json, MAC_OTLP, mac, post, server, workout, world } from "./testing/world";

test("prepare runs here: Emby confirms images against R2 before the command leaves", async () => {
  resetStoredImageCacheForTests();
  const w = world();
  const hash = "c".repeat(64);
  const response = await w.send("/api/ingest/emby", post({ images: [{ imageKey: "item:poster", objectKey: `${hash}.webp` }, { imageKey: "junk", objectKey: "nope" }] }));
  assert.equal(response.status, 202);
  assert.deepEqual(w.calls.heads, [`${hash}.webp`]);
  const [command] = w.calls.commits;
  assert.deepEqual(command?.source === "emby" ? command.images : null, [{ key: "item:poster", objectKey: `${hash}.webp` }]);
});

test("every source prepares into a command that survives structured cloning", async () => {
  const images = { head: async () => ({}) };
  const fixtures: [string, unknown][] = [
    ["mac", mac({
      chargingDevices: { devices: [{ id: "charger", kind: "charger", connected: true, updatedAt: Date.now(), totalOutputW: 30 }] },
      desktop: { applicationName: "Xcode", bundleIdentifier: "com.apple.dt.Xcode", windowTitle: "App.swift" },
      appleMusic: { state: "playing", title: "Song", queue: [{ title: "Next" }] },
      codingUsage: codingUsage(10),
      codingActivity: { collectedAt: Date.now(), agents: [{ id: "claude", lastActivityAt: Date.now() - 1_000, model: "claude-opus-5" }] },
      codingTokenBuckets: {
        from: Date.now() - 600_000, to: Date.now(), collectedAt: Date.now(), agents: [{ id: "claude", state: "ok" }],
        windows: [{ from: Math.floor(Date.now() / 300_000) * 300_000 - 300_000, agents: [{
          id: "claude", model: null, inputTokens: 1, outputTokens: 1, cacheReadTokens: 1, cacheCreationTokens: 1, reasoningTokens: 0, eventCount: null,
        }] }],
      },
      vibeCodingNow: { agents: [] },
    })],
    ["iphone", { version: 1, modules: { workouts: { items: [workout()] }, extra: {} } }],
    ["homepod", { state: "playing", title: "Song", artist: "Artist", entityId: "media_player.homepod" }],
    ["emby", { playing: { itemId: "1", paused: false, media: { video: { codec: "hevc" } } }, resume: { items: [{ id: "1", name: "Pilot" }] } }],
    ["playstation", { version: 1, presence: {
      observedAt: Date.now(), online: false, availability: null, platform: null, lastOnlineAt: null, playing: null,
    } }],
    ["server", server()],
    ["agents", { codingActivity: { collectedAt: Date.now(), agents: [{ id: "cursor", lastActivityAt: Date.now(), model: "x" }] }, codingUsage: { bad: true } }],
    ["agents-otlp", { resourceMetrics: [] }],
  ];
  for (const [source, body] of fixtures) {
    const command = await prepareIngest(source, body, Date.now(), images);
    assert.deepEqual(structuredClone(command), command, source);
  }
});

test("PlayStation power 字段直接拒收", async () => {
  await assert.rejects(
    () => prepareIngest("playstation", { version: 1, power: { on: true } }, Date.now()),
    /power 字段不再接受/,
  );
});

test("OTLP: gzip or plain JSON answers the exporter's empty 200; other encodings and bad bodies keep their statuses", async () => {
  const w = world();
  const metrics = JSON.stringify({ resourceMetrics: [] });
  for (const [body, headers] of [
    [metrics, {}],
    [gzipSync(metrics), { "content-encoding": "gzip" }],
    [metrics, { "content-encoding": "identity" }],
  ] as const) {
    const response = await w.send("/api/ingest/agents/otlp", { body: body as BodyInit, headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), {});
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.ok(w.calls.commits.every((command) => command.source === "agents-otlp"));
  const fromMac = await w.send("/api/ingest/agents/otlp", { body: metrics, client: MAC_OTLP });
  assert.equal(fromMac.status, 200);
  assert.equal(w.calls.commits.at(-1)?.source, "mac-otlp", "the verified token decides the source, not the payload");
  const br = await w.send("/api/ingest/agents/otlp", { body: metrics, headers: { "content-encoding": "br" } });
  assert.equal(br.status, 415);
  assert.deepEqual(await json(br), { ok: false, error: "不支持的压缩：br" });
  const badGzip = await w.send("/api/ingest/agents/otlp", { body: "invalid gzip", headers: { "content-encoding": "gzip" } });
  assert.equal(badGzip.status, 400);
  assert.deepEqual(await json(badGzip), { ok: false, error: "无法读取上报数据" });
  const invalid = await w.send("/api/ingest/agents/otlp", { body: "{}" });
  assert.equal(invalid.status, 400, "failures keep the ingest error body, only success becomes {}");
  assert.deepEqual(await json(invalid), { ok: false, error: "上报数据无效或处理失败" });
  assert.equal((await w.send("/api/ingest/mac", { ...post(mac({})), headers: { "content-encoding": "gzip" } })).status, 202);
});
