import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { MemoryKv } from "../testing/memory-kv";
import type { Env } from "./env";
import { resetPlaystationForTests, runPlaystation } from "./index";
import {
  AUTH_KEY,
  BACKOFF_UNTIL_KEY,
  FAILURE_STREAK_KEY,
  FULL_TICK_KEY,
  backoffMs,
} from "./state";
import { PsnUpstreamUnavailable, isUpstreamUnavailable, upstream } from "./util";

afterEach(() => resetPlaystationForTests());

/** 线上真撞见过的三种：Akamai 拒绝页被 psn-api 当 JSON 解析、纯文本 504、自己 fetch 看到的 403 页 */
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
  // 里层已经贴过名字的保留里层那个（比如续期时撞上的是 auth）
  await assert.rejects(upstream("presence", async () => { throw new PsnUpstreamUnavailable("auth", "x"); }), { call: "auth" });
  const plain = new Error("NPSSO missing");
  await assert.rejects(upstream("presence", async () => { throw plain; }), (error: unknown) => error === plain);
});

test("backoff starts at five minutes, doubles per consecutive failure and caps at thirty", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 20].map(backoffMs), [5, 10, 20, 30, 30, 30].map((minutes) => minutes * 60_000));
});

function environment(kv: MemoryKv, vars: Partial<Env> = {}): Env {
  return {
    COLLECTOR_KV: kv.asKv(),
    CORE: {
      commitIngest: async () => { throw new Error("must not deliver during an outage"); },
      audience: async () => ({ connections: 0, online: 0 }),
      playstationPower: async () => null,
    },
    ...vars,
  };
}

async function seedFreshAuth(kv: MemoryKv): Promise<void> {
  const now = Date.now();
  await kv.put(AUTH_KEY, JSON.stringify({
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
  const result = await runPlaystation(environment(new MemoryKv()));
  assert.equal(result.status, "skipped");
  assert.equal(fetched.mock.callCount(), 0);
});

test("an upstream outage backs off, doubles, and marks the monitor failing after two failed ticks", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  // 所有 PSN 请求都吃 Akamai 的拒绝页
  t.mock.method(globalThis, "fetch", async () => new Response("<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>", { status: 403, headers: { "content-type": "text/html" } }));
  const kv = new MemoryKv();
  await seedFreshAuth(kv);
  const env = environment(kv);

  const started = Date.now();
  await assert.rejects(runPlaystation(env), (error: unknown) => {
    assert.ok(error instanceof PsnUpstreamUnavailable);
    assert.ok(["presence", "trophy-summary"].includes(error.call), error.call);
    return true;
  });
  const until = Number(kv.raw(BACKOFF_UNTIL_KEY));
  assert.ok(until >= started + backoffMs(1) && until <= Date.now() + backoffMs(1));
  assert.deepEqual(JSON.parse(kv.raw(FAILURE_STREAK_KEY)!).streak, 1);
  const event = warned.mock.calls.map((call) => JSON.parse(String(call.arguments[0]))).find((row) => row.event === "playstation-upstream-unavailable");
  assert.ok(event && event.backoffMs === backoffMs(1), JSON.stringify(event));

  // 退避期间不碰 PSN；只失败过一轮，监控照常报 ok
  const skipped = await runPlaystation(env);
  assert.equal(skipped.status, "skipped");
  assert.match(skipped.detail ?? "", /backoff/);
  assert.equal(skipped.failing, undefined);

  // 退避过去、门也放行（换一个 isolate：本地那份清掉，KV 里的开始时刻也清掉）后又失败一轮
  resetPlaystationForTests();
  await kv.put(BACKOFF_UNTIL_KEY, "0");
  await kv.delete(FULL_TICK_KEY);
  await assert.rejects(runPlaystation(env), PsnUpstreamUnavailable);
  assert.deepEqual(JSON.parse(kv.raw(FAILURE_STREAK_KEY)!).streak, 2);
  assert.ok(Number(kv.raw(BACKOFF_UNTIL_KEY)) >= Date.now() + backoffMs(2) - 5_000);

  // 连败两轮之后，退避中的每一响都让监控报 error
  const failing = await runPlaystation(env);
  assert.equal(failing.status, "skipped");
  assert.match(failing.failing ?? "", /连续 2 轮/);
});
