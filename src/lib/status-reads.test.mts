import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptPush,
  createHomeBootstrap,
  guardPolled,
  hasLiveRead,
  HOME_PATH,
  markLiveRead,
  type HomeBootstrapDeps,
} from "./status-reads.ts";
import { STATUS_VIEWS } from "./status-views.ts";

const envelope = (label: string) => ({ ok: true as const, data: { label } });

function aggregateResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const T0 = 1_000_000;

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
  const [desktop, charger, watching] = await Promise.all([
    bootstrap.slice("/api/status/desktop"),
    bootstrap.slice("/api/status/charger?since=123"),
    bootstrap.slice("/api/status/watching"),
  ]);
  assert.deepEqual(calls, [HOME_PATH]);
  assert.deepEqual(desktop, envelope("desktop"));
  assert.deepEqual(charger, envelope("charger"));
  assert.deepEqual(watching, envelope("watching"));
  assert.equal(bootstrap.slice("/api/status/desktop"), null);
  assert.deepEqual(calls, [HOME_PATH]);
});

test("home bootstrap: unknown paths and non-since queries never touch the aggregate", () => {
  const { bootstrap, calls } = harness();
  assert.equal(bootstrap.slice("/api/status/online"), null);
  assert.equal(bootstrap.slice("/api/status/trophies?titleids=CUSA00001"), null);
  assert.equal(bootstrap.slice("/api/status/charger?since=1&titleids=x"), null);
  assert.deepEqual(calls, []);
});

test("home bootstrap: cards mounting after the window fetch directly", async () => {
  const { bootstrap, calls, advance } = harness({ windowMs: 10_000 });
  assert.deepEqual(await bootstrap.slice("/api/status/desktop"), envelope("desktop"));
  advance(10_001);
  assert.equal(bootstrap.slice("/api/status/watching"), null);
  assert.deepEqual(calls, [HOME_PATH]);
});

test("home bootstrap: failed aggregate, bad status or missing field fall back to direct fetches", async () => {
  const failing = harness({ fetch: async () => { throw new Error("offline"); } });
  assert.equal(await failing.bootstrap.slice("/api/status/desktop"), null);

  const rejected = harness({ response: () => aggregateResponse({}, 503) });
  assert.equal(await rejected.bootstrap.slice("/api/status/desktop"), null);

  const failedCard = harness();
  assert.equal(await failedCard.bootstrap.slice("/api/status/server"), null);

  const partial = harness({ body: { desktop: envelope("desktop") } });
  assert.equal(await partial.bootstrap.slice("/api/status/pulse"), null);
  assert.deepEqual(await partial.bootstrap.slice("/api/status/desktop"), envelope("desktop"));
});

test("home bootstrap: a path that already received a push bypasses the aggregate, before and after it resolves", async () => {
  const { bootstrap, live } = harness();
  live.add("/api/status/watching");
  assert.equal(bootstrap.slice("/api/status/watching"), null);

  const pending = bootstrap.slice("/api/status/playing");
  assert.ok(pending);
  live.add("/api/status/playing");
  assert.equal(await pending, null);
  const control = harness();
  assert.deepEqual(await control.bootstrap.slice("/api/status/playing"), envelope("playing"));
});

test("home bootstrap: the production live-read registry covers pushes to paths without timestamps", async () => {
  const { bootstrap } = harness({ isLiveRead: hasLiveRead });
  const pending = bootstrap.slice("/api/status/watching/now");
  assert.ok(pending);
  markLiveRead("/api/status/watching/now");
  assert.equal(await pending, null);
  const control = harness({ isLiveRead: hasLiveRead });
  assert.deepEqual(await control.bootstrap.slice("/api/status/playing"), envelope("playing"));
  markLiveRead("/api/status/charger");
  assert.equal(bootstrap.slice("/api/status/charger"), null);
});

test("acceptPush / guardPolled: stamped payloads drop out-of-order values", () => {
  const path = STATUS_VIEWS.desktop.path;
  const older = { ok: true as const, data: { receivedAt: 1_000 } };
  const newer = { ok: true as const, data: { receivedAt: 2_000 } };
  assert.equal(acceptPush(path, newer), true);
  assert.equal(acceptPush(path, older), false);
  assert.deepEqual(guardPolled(path, older), newer);
  const equal = { ok: true as const, data: { receivedAt: 2_000, extra: "polled" } };
  assert.deepEqual(guardPolled(path, equal), equal);
});

test("acceptPush / guardPolled: agent-status fetchedAt rejects an older poll", () => {
  const path = STATUS_VIEWS.agentStatus.path;
  const older = { ok: true as const, data: { fetchedAt: 1_000, agents: [] } };
  const newer = { ok: true as const, data: { fetchedAt: 2_000, agents: [{ id: "claude" }] } };
  assert.equal(acceptPush(path, newer), true);
  assert.equal(acceptPush(path, older), false);
  assert.deepEqual(guardPolled(path, older), newer);
  const equal = { ok: true as const, data: { fetchedAt: 2_000, agents: [{ id: "codex" }] } };
  assert.deepEqual(guardPolled(path, equal), equal);
});

test("guardPolled: error envelope is visible but does not clear the live mark", () => {
  const path = STATUS_VIEWS.powerBank.path;
  const pushed = { ok: true as const, data: { pushedAt: 9_000 } };
  assert.equal(acceptPush(path, pushed), true);
  assert.equal(hasLiveRead(path), true);
  const failed = { ok: false as const, error: "Status unavailable" };
  assert.deepEqual(guardPolled(path, failed), failed);
  assert.equal(hasLiveRead(path), true);
  const { bootstrap } = harness({ isLiveRead: hasLiveRead });
  assert.equal(bootstrap.slice(path), null);
});
