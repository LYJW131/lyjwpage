import assert from "node:assert/strict";
import test from "node:test";
import { createMembershipCheck } from "./membership.ts";

const settings = { token: "test-bot-token", targetUserId: "123", timeoutMs: 1_000 };

test("membership verification reads one target with Bot auth and discards the profile body", async () => {
  let cancelled = false;
  const check = createMembershipCheck(settings, (async (url, init) => {
    assert.equal(url, "https://discord.com/api/v10/guilds/456/members/123");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bot test-bot-token");
    assert.ok(init?.signal);
    assert.equal(init?.redirect, "error");
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  }) as typeof fetch);
  assert.equal(await check("456"), "present");
  assert.equal(cancelled, true);
});

test("missing target or forbidden guild revokes membership; rate limits and service errors remain unknown", async () => {
  for (const [status, expected] of [[200, "present"], [403, "absent"], [404, "absent"], [401, "unknown"], [429, "unknown"], [500, "unknown"]] as const) {
    let requests = 0;
    const check = createMembershipCheck(settings, (async () => { requests += 1; return new Response(null, { status }); }) as typeof fetch);
    assert.equal(await check("456"), expected);
    assert.equal(requests, 1);
  }
});

test("network failures leave membership unknown", async () => {
  const check = createMembershipCheck(settings, (async () => { throw new Error("network down"); }) as typeof fetch);
  assert.equal(await check("456"), "unknown");
});

test("a hanging member request is bounded by timeout without retrying", async () => {
  const check = createMembershipCheck({ ...settings, timeoutMs: 5 }, (async (_url, init) => {
    const signal = init?.signal;
    assert.ok(signal);
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    return new Response(null);
  }) as typeof fetch);
  const keepAlive = setTimeout(() => {}, 100);
  try { assert.equal(await check("456"), "unknown"); }
  finally { clearTimeout(keepAlive); }
});
