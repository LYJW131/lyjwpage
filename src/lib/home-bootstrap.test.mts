import assert from "node:assert/strict";
import test from "node:test";
import { createHomeBootstrap, HOME_PATH, type HomeBootstrapDeps } from "./home-bootstrap.ts";
import { hasLiveRead, markLiveRead } from "./read-model-freshness.ts";

const envelope = (label: string) => ({ ok: true as const, data: { label } });

function aggregateResponse(
  body: Record<string, unknown>,
  { readModel = "kv", fetchedAt = "2026-09-18T10:00:30.000Z", status = 200 } = {},
) {
  const headers = new Headers({ "X-Read-Model": readModel });
  if (fetchedAt) headers.set("X-Fetched-At", fetchedAt);
  return new Response(JSON.stringify(body), { status, headers });
}

const T0 = Date.parse("2026-09-18T10:00:00.000Z");

function harness(overrides: Partial<HomeBootstrapDeps> & { body?: Record<string, unknown>; response?: () => Response } = {}) {
  const calls: string[] = [];
  let now = T0 + 60_000;
  const live = new Set<string>();
  const body = overrides.body ?? {
    desktop: envelope("desktop"),
    charger: envelope("charger"),
    watching: envelope("watching"),
    nowListening: envelope("now"),
    playing: envelope("playing"),
    nowWatching: envelope("now-watching"),
    server: { ok: false as const, error: "Status unavailable" },
  };
  const bootstrap = createHomeBootstrap({
    fetch: overrides.fetch ?? (async (path) => { calls.push(path); return overrides.response ? overrides.response() : aggregateResponse(body); }),
    now: () => now,
    isLiveRead: overrides.isLiveRead ?? ((path) => live.has(path)),
    windowMs: overrides.windowMs,
  });
  return { bootstrap, calls, live, advance: (ms: number) => { now += ms; } };
}

test("home bootstrap: first fetch of every mapped path is answered by one aggregate request", async () => {
  const { bootstrap, calls } = harness();
  bootstrap.markSnapshotAt(T0);
  const [desktop, charger, watching] = await Promise.all([
    bootstrap.slice("/api/status/desktop"),
    bootstrap.slice("/api/status/charger?since=123"),
    bootstrap.slice("/api/status/watching"),
  ]);
  assert.deepEqual(calls, [HOME_PATH]);
  assert.deepEqual(desktop, envelope("desktop"));
  assert.deepEqual(charger, envelope("charger"));
  assert.deepEqual(watching, envelope("watching"));
  // Second fetch of the same path goes straight to its own endpoint.
  assert.equal(bootstrap.slice("/api/status/desktop"), null);
  assert.deepEqual(calls, [HOME_PATH]);
});

test("home bootstrap: unknown paths and non-since queries never touch the aggregate", () => {
  const { bootstrap, calls } = harness();
  bootstrap.markSnapshotAt(T0);
  assert.equal(bootstrap.slice("/api/status/online"), null);
  assert.equal(bootstrap.slice("/api/status/listening?fresh=1"), null);
  assert.equal(bootstrap.slice("/api/status/charger?since=1&fresh=1"), null);
  assert.deepEqual(calls, []);
});

test("home bootstrap: cards mounting after the window fetch directly", async () => {
  const { bootstrap, calls, advance } = harness({ windowMs: 10_000 });
  bootstrap.markSnapshotAt(T0);
  assert.deepEqual(await bootstrap.slice("/api/status/desktop"), envelope("desktop"));
  advance(10_001);
  assert.equal(bootstrap.slice("/api/status/watching"), null);
  assert.deepEqual(calls, [HOME_PATH]);
});

test("home bootstrap: an aggregate older than the SSR snapshot is discarded", async () => {
  const { bootstrap } = harness();
  // HTML was rebuilt from the origin at 10:01:00; KV projection dates from 10:00:30.
  bootstrap.markSnapshotAt(T0 + 60_000);
  assert.equal(await bootstrap.slice("/api/status/desktop"), null);
  // Once discarded, later first-time paths are answered directly too (served set + same result).
  assert.equal(await bootstrap.slice("/api/status/watching"), null);
});

test("home bootstrap: without a snapshot time nothing is served from the aggregate", async () => {
  const { bootstrap } = harness();
  assert.equal(await bootstrap.slice("/api/status/desktop"), null);
});

test("home bootstrap: an origin answer counts as current", async () => {
  const { bootstrap } = harness({
    response: () => aggregateResponse({ desktop: envelope("desktop") }, { readModel: "origin", fetchedAt: "" }),
  });
  bootstrap.markSnapshotAt(T0 + 59_000);
  assert.deepEqual(await bootstrap.slice("/api/status/desktop"), envelope("desktop"));
});

test("home bootstrap: failed aggregate, bad status or missing field fall back to direct fetches", async () => {
  const failing = harness({ fetch: async () => { throw new Error("offline"); } });
  failing.bootstrap.markSnapshotAt(T0);
  assert.equal(await failing.bootstrap.slice("/api/status/desktop"), null);

  const rejected = harness({ response: () => aggregateResponse({}, { status: 503 }) });
  rejected.bootstrap.markSnapshotAt(T0);
  assert.equal(await rejected.bootstrap.slice("/api/status/desktop"), null);

  // A card that failed inside the projection is fetched directly: that is what the mount round is for.
  const failedCard = harness();
  failedCard.bootstrap.markSnapshotAt(T0);
  assert.equal(await failedCard.bootstrap.slice("/api/status/server"), null);

  // An older Worker without the pulse field: only that card fetches on its own.
  const partial = harness({ body: { desktop: envelope("desktop") } });
  partial.bootstrap.markSnapshotAt(T0);
  assert.equal(await partial.bootstrap.slice("/api/status/pulse"), null);
  assert.deepEqual(await partial.bootstrap.slice("/api/status/desktop"), envelope("desktop"));
});

test("home bootstrap: a path that already received a push bypasses the aggregate, before and after it resolves", async () => {
  const { bootstrap, live } = harness();
  bootstrap.markSnapshotAt(T0);
  live.add("/api/status/watching");
  assert.equal(bootstrap.slice("/api/status/watching"), null);

  const pending = bootstrap.slice("/api/status/playing");
  assert.ok(pending);
  // WebSocket forward lands while the aggregate is in flight.
  live.add("/api/status/playing");
  assert.equal(await pending, null);
  // Same body, no push: the slice is served, so the null above really came from the push.
  const control = harness();
  control.bootstrap.markSnapshotAt(T0);
  assert.deepEqual(await control.bootstrap.slice("/api/status/playing"), envelope("playing"));
});

test("home bootstrap: the production live-read registry covers pushes to non-KV paths", async () => {
  const { bootstrap } = harness({ isLiveRead: hasLiveRead });
  bootstrap.markSnapshotAt(T0);
  const pending = bootstrap.slice("/api/status/watching/now");
  assert.ok(pending);
  markLiveRead("/api/status/watching/now");
  assert.equal(await pending, null);
  // Control: a path nothing was pushed to is still served through the real registry.
  const control = harness({ isLiveRead: hasLiveRead });
  control.bootstrap.markSnapshotAt(T0);
  assert.deepEqual(await control.bootstrap.slice("/api/status/playing"), envelope("playing"));
  // A push that arrived before the first fetch: never even joins the aggregate.
  markLiveRead("/api/status/charger");
  assert.equal(bootstrap.slice("/api/status/charger"), null);
});
