import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { Env } from "../dist/env.js";
import {
  AUTH_KEY,
  BACKOFF_UNTIL_KEY,
  FAILURE_STREAK_KEY,
  FULL_TICK_KEY,
  backoffMs,
} from "../dist/state.js";
import { MemoryStore } from "../dist/store.js";
import { resetPlaystationForTests, runPlaystation } from "../dist/tick.js";
import { PsnUpstreamUnavailable, isUpstreamUnavailable, upstream } from "../dist/util.js";

afterEach(() => resetPlaystationForTests());

const liveFailures = [
  () => JSON.parse("<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>"),
  () => JSON.parse("error code: 504"),
  () => { throw new Error("PSN 返回 403：<HTML><HEAD>\n<TITLE>Access Denied</TITLE>…gamelist/v2"); },
];

test("Akamai pages and plain-text gateway errors are classified as upstream unavailable", () => {
  for (const fail of liveFailures) {
    let caught: unknown;
    try { fail(); } catch (error) { caught = error; }
    assert.equal(isUpstreamUnavailable(caught), true, String(caught));
  }
  assert.equal(isUpstreamUnavailable(new Error("PSN 返回 502：Bad Gateway")), true);
  assert.equal(isUpstreamUnavailable(new Error("error code: 520")), true);
});

test("credential, permission and rate-limit failures are not upstream outages", () => {
  assert.equal(isUpstreamUnavailable(new Error("NPSSO 换不出 access code。")), false);
  assert.equal(isUpstreamUnavailable(new Error('PSN 返回 403：{"error":{"code":2240526,"message":"Not permitted"}}')), false);
  assert.equal(isUpstreamUnavailable(new Error("PSN 返回 429：too many requests")), false);
  assert.equal(isUpstreamUnavailable(new Error("PSN 奖杯总览 报错：Access token expired")), false);
  assert.equal(isUpstreamUnavailable("string"), false);
});

test("upstream() names the call that hit the outage and passes other errors through", async () => {
  await assert.rejects(upstream("presence", async () => JSON.parse("<HTML>")), (error: unknown) => {
    assert.ok(error instanceof PsnUpstreamUnavailable);
    assert.equal(error.call, "presence");
    return true;
  });
  await assert.rejects(upstream("presence", async () => { throw new PsnUpstreamUnavailable("auth", "x"); }), { call: "auth" });
  const plain = new Error("NPSSO missing");
  await assert.rejects(upstream("presence", async () => { throw plain; }), (error: unknown) => error === plain);
});

test("backoff starts at five minutes, doubles per consecutive failure and caps at thirty", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 20].map(backoffMs), [5, 10, 20, 30, 30, 30].map((minutes) => minutes * 60_000));
});

function environment(state: MemoryStore, vars: Partial<Env> = {}): Env {
  return {
    STATE: state,
    SITE_INGEST_URL: "https://ingest.example/api/ingest/playstation",
    ACCESS_CLIENT_ID: "client",
    ACCESS_CLIENT_SECRET: "secret",
    ...vars,
  };
}

async function seedFreshAuth(state: MemoryStore): Promise<void> {
  const now = Date.now();
  await state.put(AUTH_KEY, JSON.stringify({
    accessToken: "test-access",
    refreshToken: "test-refresh",
    accessTokenIssuedAt: now,
    accessTokenExpiresAt: now + 3_600_000,
    refreshTokenIssuedAt: now,
    refreshTokenExpiresAt: now + 864_000_000,
  }));
}

test("no NPSSO and no stored login skips cleanly without touching PSN", async (t) => {
  t.mock.method(console, "warn", () => {});
  const fetched = t.mock.method(globalThis, "fetch", async () => { throw new Error("no network in this test"); });
  const result = await runPlaystation(environment(new MemoryStore()));
  assert.equal(result.status, "skipped");
  assert.equal(fetched.mock.callCount(), 0);
});

test("an upstream outage backs off, doubles, and marks the log failing after two failed ticks", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => new Response("<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>", { status: 403, headers: { "content-type": "text/html" } }));
  const state = new MemoryStore();
  await seedFreshAuth(state);
  const env = environment(state);

  const started = Date.now();
  await assert.rejects(runPlaystation(env), (error: unknown) => {
    assert.ok(error instanceof PsnUpstreamUnavailable);
    assert.ok(["presence", "trophy-summary"].includes(error.call), error.call);
    return true;
  });
  const until = Number(state.raw(BACKOFF_UNTIL_KEY));
  assert.ok(until >= started + backoffMs(1) && until <= Date.now() + backoffMs(1));
  assert.deepEqual(JSON.parse(state.raw(FAILURE_STREAK_KEY)!).streak, 1);
  const event = warned.mock.calls.map((call) => JSON.parse(String(call.arguments[0]))).find((row) => row.event === "playstation-upstream-unavailable");
  assert.ok(event && event.backoffMs === backoffMs(1), JSON.stringify(event));

  const skipped = await runPlaystation(env);
  assert.equal(skipped.status, "skipped");
  assert.match(skipped.detail ?? "", /backoff/);
  assert.equal(skipped.failing, undefined);

  resetPlaystationForTests();
  await state.put(BACKOFF_UNTIL_KEY, "0");
  await state.delete(FULL_TICK_KEY);
  await assert.rejects(runPlaystation(env), PsnUpstreamUnavailable);
  assert.deepEqual(JSON.parse(state.raw(FAILURE_STREAK_KEY)!).streak, 2);
  assert.ok(Number(state.raw(BACKOFF_UNTIL_KEY)) >= Date.now() + backoffMs(2) - 5_000);

  const failing = await runPlaystation(env);
  assert.equal(failing.status, "skipped");
  assert.match(failing.failing ?? "", /连续 2 轮/);
});
