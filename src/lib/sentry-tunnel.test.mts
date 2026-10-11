import assert from "node:assert/strict";
import test from "node:test";

import { relaySentryEnvelope, sentryRelayTarget } from "./sentry-tunnel.ts";

const DSN =
  "https://13d4c7b65d377b6a3e1e546f9d940b9d@o4511888459890688.ingest.us.sentry.io/4512132602331136";
const ENVELOPE_TARGET =
  "https://o4511888459890688.ingest.us.sentry.io/api/4512132602331136/envelope/";

const envelope = (dsn = DSN) => new TextEncoder().encode(`${JSON.stringify({ dsn })}\n{"type":"event"}\n{}`);

function relayRequest(body = envelope()) {
  return new Request("https://lyjw.me/relay", {
    method: "POST",
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  });
}

test("信封 dsn 与站点 DSN 对齐时只按配置推导目标", () => {
  assert.equal(sentryRelayTarget(DSN, DSN), ENVELOPE_TARGET);
});

test("同公钥信封也投不进别的项目：目标不认路径与查询", () => {
  assert.equal(
    sentryRelayTarget("https://13d4c7b65d377b6a3e1e546f9d940b9d@o4511888459890688.ingest.us.sentry.io/999", DSN),
    null,
  );
  assert.equal(sentryRelayTarget(`${DSN}?sentry_key=abc`, DSN), null);
  assert.equal(sentryRelayTarget(`${DSN}#frag`, DSN), null);
  assert.equal(sentryRelayTarget("https://other:13d4c7b65d377b6a3e1e546f9d940b9d@o4511888459890688.ingest.us.sentry.io/4512132602331136", DSN), null);
  assert.equal(sentryRelayTarget("https://key:secret@o4511888459890688.ingest.us.sentry.io/4512132602331136", DSN), null);
});

test("别的 ingest 主机、非 https、缺 dsn 都拒绝", () => {
  assert.equal(sentryRelayTarget("https://key@evil.example.com/4512132602331136", DSN), null);
  assert.equal(sentryRelayTarget("http://key@o4511888459890688.ingest.us.sentry.io/4512132602331136", DSN), null);
  assert.equal(sentryRelayTarget(null, DSN), null);
  assert.equal(sentryRelayTarget(DSN, "not-a-dsn"), null);
});

test("/relay POST 把信封转到配置的 ingest 端点", async () => {
  const calls: { url: string; method?: string; redirect?: string }[] = [];
  const fetcher = (async (url: unknown, init: { method?: string; redirect?: string }) => {
    calls.push({ url: String(url), method: init?.method, redirect: init?.redirect });
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  const result = await relaySentryEnvelope(relayRequest(), DSN, fetcher);
  assert.deepEqual(calls, [{ url: ENVELOPE_TARGET, method: "POST", redirect: "error" }]);
  assert.equal("response" in result && result.response.status, 200);
});

test("信封对不上站点项目时 403，根本不发请求", async () => {
  const fetcher = async () => {
    throw new Error("must not fetch");
  };
  const foreign = relayRequest(envelope("https://13d4c7b65d377b6a3e1e546f9d940b9d@o4511888459890688.ingest.us.sentry.io/999"));
  assert.deepEqual(await relaySentryEnvelope(foreign, DSN, fetcher), { reject: 403 });
  const badHost = relayRequest(envelope("https://key@evil.example.com/4512132602331136"));
  assert.deepEqual(await relaySentryEnvelope(badHost, DSN, fetcher), { reject: 403 });
});

test("超过上限的信封体 413，缺 DSN 配置时 404", async () => {
  const oversized = relayRequest(new Uint8Array(1_048_577));
  assert.deepEqual(await relaySentryEnvelope(oversized, DSN, async () => { throw new Error("must not fetch"); }), { reject: 413 });
  assert.deepEqual(await relaySentryEnvelope(relayRequest(), undefined), { reject: 404 });
});
