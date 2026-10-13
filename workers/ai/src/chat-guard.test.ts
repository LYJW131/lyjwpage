import assert from "node:assert/strict";
import test from "node:test";

import { turnstilePassed, verifyTurnstile } from "./chat/guard.ts";

test("siteverify 收的是 secret、访客 token 与来访 IP 的表单，判定结果原样返回", async (t) => {
  let seen: { url: string; body: URLSearchParams } | undefined;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    seen = { url: String(input), body: new URLSearchParams(String(init?.body)) };
    return Response.json({ success: true, hostname: "lyjw.me", action: "god-chat" });
  });
  const result = await verifyTurnstile("s3cret", "visitor-token", "203.0.113.9");
  assert.equal(seen?.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(seen?.body.get("secret"), "s3cret");
  assert.equal(seen?.body.get("response"), "visitor-token");
  assert.equal(seen?.body.get("remoteip"), "203.0.113.9");
  assert.equal(result.hostname, "lyjw.me");
});

test("判定接口请求失败、响应不是 JSON 都按未通过处理，不把访客放进对话", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("connect timeout");
  });
  assert.deepEqual(await verifyTurnstile("s", "t", "ip"), {});
  assert.equal(turnstilePassed(await verifyTurnstile("s", "t", "ip"), ["https://lyjw.me"], false), false);

  t.mock.method(globalThis, "fetch", async () => new Response("not json"));
  assert.deepEqual(await verifyTurnstile("s", "t", "ip"), {});
});
