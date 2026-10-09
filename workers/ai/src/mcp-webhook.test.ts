import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  WEBHOOK_PAYLOAD_LIMIT,
  WEBHOOK_RESPONSE_LIMIT,
  constantTimeEqual,
  createWebhookPost,
  isPublicAddress,
  normalizeCallbackUrl,
  resolveWebhookAddresses,
  signWebhook,
  validateCallbackUrl,
  validateSigningSecret,
  verifyCallback,
  type WebhookNetwork,
  type WebhookPost,
  type WebhookSocket,
} from "./mcp-webhook.ts";

const URL_VALUE = "https://receiver.example.com/callback?subscription=abc";
const SECRET = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fixture(response: string | Uint8Array[] = "HTTP/1.1 204 No Content\r\n\r\n", addresses = ["93.184.215.14"]) {
  const connected: { hostname: string; port: number }[] = [];
  const tlsHosts: string[] = [];
  const writes: Uint8Array[] = [];
  let closed = 0;
  let resolved = 0;
  const secure: WebhookSocket = {
    readable: new ReadableStream({ start(controller) {
      for (const chunk of typeof response === "string" ? [encoder.encode(response)] : response) controller.enqueue(chunk);
      controller.close();
    } }),
    writable: new WritableStream({ write(chunk) { writes.push(chunk); } }),
    opened: Promise.resolve(),
    closed: Promise.resolve(),
    close: async () => { closed++; },
    startTls: () => { throw new Error("TLS already active"); },
  };
  const raw: WebhookSocket = {
    ...secure,
    writable: new WritableStream({ write() { throw new Error("Unencrypted write"); } }),
    startTls: ({ expectedServerHostname }) => { tlsHosts.push(expectedServerHostname); return secure; },
  };
  const network: WebhookNetwork = {
    resolve: async (hostname, signal) => {
      assert.equal(hostname, "receiver.example.com");
      assert.equal(signal.aborted, false);
      resolved++;
      return addresses;
    },
    connect: (address, options) => {
      assert.deepEqual(options, { secureTransport: "starttls", allowHalfOpen: false });
      connected.push(address);
      return raw;
    },
  };
  return { network, connected, tlsHosts, writes, secure, get closed() { return closed; }, get resolved() { return resolved; } };
}

test("callback URLs require HTTPS, exact administrator hosts and no authority ambiguity", () => {
  assert.equal(validateCallbackUrl("HTTPS://RECEIVER.EXAMPLE.COM:443/a", " receiver.example.com,other.example.com "), "https://receiver.example.com/a");
  assert.equal(normalizeCallbackUrl("HTTPS://RECEIVER.EXAMPLE.COM:443/a"), "https://receiver.example.com/a");
  for (const url of [
    "http://receiver.example.com/a", "https://receiver.example.com:8443/a", "https://user:pass@receiver.example.com/a",
    "https://@receiver.example.com/a", "https://receiver.example.com/#", "https://receiver.example.com/#fragment",
    "https://127.0.0.1/a", "https://[::1]/a", "https://[2606:4700::1111]/a", "https://2130706433/a", "https://0x7f000001/a",
    "https://0177.0.0.1/a", "https://receiver.example.com./a", "https://localhost/a", "https://service.internal/a",
    " https://receiver.example.com/a", "https://receiver.example.com\n/a", "https://receiver.example.com\\@evil.example.com/a",
    "https:receiver.example.com/a", "https://receiver.example.com/" + "a".repeat(2_048),
  ]) assert.throws(() => validateCallbackUrl(url, "receiver.example.com"), { reason: "invalid_url" }, url);
  for (const hosts of ["", "*", "*.example.com", "example.com", "receiver.example.com.evil.com"]) {
    assert.throws(() => validateCallbackUrl(URL_VALUE, hosts), { reason: "host_not_allowed" });
  }
});

test("destination policy rejects private, reserved, mapped, documentation and malformed addresses", () => {
  for (const address of [
    "0.0.0.0", "10.2.3.4", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.0.0.9", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255", "01.2.3.4", "1.2.3.256", "1.2.3", "2130706433",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "64:ff9b:1::1", "100::1", "fc00::1", "fdff::1",
    "fe80::1", "febf::1", "ff02::1", "2001::1", "2001:2::1", "2001:10::1", "2001:db8::1", "2002:7f00:1::", "3fff:fff::1",
    "2606:4700::1%eth0", "2606:4700:::1", "2606:4700::1::", "2000", "2000:1:2:3:4:5:6:7:8", "[2606:4700::1111]",
  ]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["93.184.215.14", "8.8.8.8", "100.128.0.1", "172.15.255.255", "172.32.0.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001:0800:0000:0000:0000:200e"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("signing secret requires canonical base64 and a 24–64 byte HMAC key", () => {
  for (const length of [24, 25, 26, 32, 63, 64]) {
    assert.equal(validateSigningSecret(`whsec_${Buffer.alloc(length, 7).toString("base64")}`).byteLength, length);
  }
  for (const secret of ["", "secret", SECRET.replace("whsec_", ""), SECRET.replace("=", ""), SECRET + "\n", "whsec_" + "_".repeat(32),
    ...[0, 16, 23, 65].map((length) => `whsec_${Buffer.alloc(length).toString("base64")}`),
    `whsec_${Buffer.alloc(25).toString("base64").slice(0, -3)}B==`,
  ]) assert.throws(() => validateSigningSecret(secret), { reason: "invalid_secret" });
});

test("Standard Webhooks signature covers the exact UTF-8 body, event ID and Unix seconds", async () => {
  const body = '{"data":{"title":"你好"}}';
  const expected = createHmac("sha256", Buffer.alloc(32, 7)).update(`evt_123.1791547200.${body}`).digest("base64");
  assert.equal(await signWebhook(SECRET, "evt_123", 1_791_547_200, body), `v1,${expected}`);
  assert.notEqual(await signWebhook(SECRET, "evt_124", 1_791_547_200, body), `v1,${expected}`);
  assert.notEqual(await signWebhook(SECRET, "evt_123", 1_791_547_201, body), `v1,${expected}`);
  assert.notEqual(await signWebhook(SECRET, "evt_123", 1_791_547_200, body + " "), `v1,${expected}`);
  await assert.rejects(signWebhook(SECRET, "evt.bad", 1, body));
  await assert.rejects(signWebhook(SECRET, "evt_good", 1.1, body));
  assert.equal(constantTimeEqual("abcdef", "abcdef"), true);
  assert.equal(constantTimeEqual("abcdef", "abcdeg"), false);
  assert.equal(constantTimeEqual("abcdef", "abc"), false);
});

test("transport pins the validated IP, upgrades TLS with the original hostname, and preserves body bytes", async () => {
  const setup = fixture();
  const post = createWebhookPost(setup.network);
  const body = '{"value":"你好"}';
  assert.deepEqual(await post(URL_VALUE, { "webhook-id": "evt_123" }, body), { status: 204, body: "" });
  assert.deepEqual(setup.connected, [{ hostname: "93.184.215.14", port: 443 }]);
  assert.deepEqual(setup.tlsHosts, ["receiver.example.com"]);
  const wire = decoder.decode(setup.writes[0]);
  assert.match(wire, /^POST \/callback\?subscription=abc HTTP\/1\.1\r\nHost: receiver\.example\.com\r\n/u);
  assert.ok(wire.includes(`Content-Length: ${Buffer.byteLength(body)}\r\n`));
  assert.ok(wire.endsWith(`\r\n\r\n${body}`));
  assert.ok(wire.includes("Accept-Encoding: identity\r\n"));
  assert.equal(setup.closed, 1);
});

test("mixed public/private DNS answers never open a connection; every attempt resolves again", async () => {
  for (const answers of [["93.184.215.14", "10.0.0.1"], ["2606:4700::1", "::1"], ["::ffff:93.184.215.14"], ["not-an-ip"]]) {
    const setup = fixture(undefined, answers);
    await assert.rejects(createWebhookPost(setup.network)(URL_VALUE, {}, "{}"), { reason: "address_not_public" });
    assert.equal(setup.connected.length, 0);
  }
  const setup = fixture(undefined, []);
  await assert.rejects(createWebhookPost(setup.network)(URL_VALUE, {}, "{}"), { reason: "dns_failed" });
  const rebinding = fixture();
  let count = 0;
  rebinding.network.resolve = async () => ++count === 1 ? ["93.184.215.14"] : ["127.0.0.1"];
  const post = createWebhookPost(rebinding.network);
  await post(URL_VALUE, {}, "{}");
  await assert.rejects(post(URL_VALUE, {}, "{}"), { reason: "address_not_public" });
  assert.equal(rebinding.connected.length, 1);
  assert.equal(count, 2);
});

test("requests reject header injection, destination overrides and oversized UTF-8 payloads before DNS", async () => {
  const setup = fixture();
  const post = createWebhookPost(setup.network);
  const forbiddenHeaders: Record<string, string>[] = [{ Host: "evil.example.com" }, { "webhook-id": "x\r\nHost: evil.example.com" }, { "Transfer-Encoding": "chunked" }, { "webhook-id": "x", "Webhook-Id": "y" }];
  for (const headers of forbiddenHeaders) {
    await assert.rejects(post(URL_VALUE, headers, "{}"), { reason: "invalid_response" });
  }
  await assert.rejects(post(URL_VALUE, {}, "你".repeat(Math.ceil(WEBHOOK_PAYLOAD_LIMIT / 3))), { reason: "payload_too_large" });
  assert.equal(setup.resolved, 0);
});

test("HTTP responses support bounded content length, chunked UTF-8 and connection close framing", async () => {
  for (const [wire, expected] of [
    ["HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}", "{}"],
    ["HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\n你好\r\n0\r\nX-End: yes\r\n\r\n", "你好"],
    ["HTTP/1.0 200 OK\r\n\r\n{}", "{}"],
  ]) {
    const setup = fixture([...encoder.encode(wire)].map((byte) => Uint8Array.of(byte)));
    assert.deepEqual(await createWebhookPost(setup.network)(URL_VALUE, {}, "{}"), { status: 200, body: expected });
  }
});

test("redirects are rejected without following Location", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const setup = fixture(`HTTP/1.1 ${status} Redirect\r\nLocation: http://169.254.169.254/latest\r\nContent-Length: 0\r\n\r\n`);
    await assert.rejects(createWebhookPost(setup.network)(URL_VALUE, {}, "{}"), { reason: "redirect" });
    assert.equal(setup.connected.length, 1);
    assert.equal(setup.closed, 1);
  }
});

test("terminal 410 and 413 acknowledgements preserve their status without reading an oversized body", async () => {
  for (const status of [410, 413]) {
    const setup = fixture(`HTTP/1.1 ${status} Rejected\r\nContent-Length: 1000000\r\n\r\n${"x".repeat(50_000)}`);
    assert.deepEqual(await createWebhookPost(setup.network)(URL_VALUE, {}, "{}"), { status, body: "" });
    assert.equal(setup.closed, 1);
  }
});

test("ambiguous framing, truncated bodies and malformed HTTP fail closed", async () => {
  for (const wire of [
    "HTTP/2 200\r\n\r\n", "HTTP/1.1 101 Switching Protocols\r\n\r\n", "HTTP/1.1 200 OK\r\n folded: header\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n{}", "HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\n{}", "HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n+2\r\n{}\r\n0\r\n\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}XX0\r\n\r\n",
  ]) {
    const setup = fixture(wire);
    await assert.rejects(createWebhookPost(setup.network)(URL_VALUE, {}, "{}"));
    assert.equal(setup.closed, 1);
  }
});

test("response headers, decoded body and chunk framing have independent size bounds", async () => {
  for (const wire of [
    `HTTP/1.1 200 OK\r\nContent-Length: ${WEBHOOK_RESPONSE_LIMIT + 1}\r\n\r\n`,
    `HTTP/1.1 200 OK\r\nX-Large: ${"a".repeat(8_192)}\r\n\r\n`,
    `HTTP/1.1 200 OK\r\n\r\n${"a".repeat(WEBHOOK_RESPONSE_LIMIT + 1)}`,
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1001\r\n",
    `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${"1;" + "a".repeat(255)}\r\na\r\n0\r\n\r\n`,
    `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${("1;" + "a".repeat(200) + "\r\na\r\n").repeat(200)}0\r\n\r\n`,
  ]) await assert.rejects(createWebhookPost(fixture(wire).network)(URL_VALUE, {}, "{}"), { reason: "response_too_large" });
});

test("network failures expose only a safe category and close the socket", async () => {
  const setup = fixture();
  setup.secure.opened = Promise.reject(new Error(`Secret-bearing URL: ${URL_VALUE}`));
  await assert.rejects(createWebhookPost(setup.network)(URL_VALUE, {}, "{}"), (error: unknown) => {
    assert.equal((error as Error).message, "Webhook connection_failed");
    assert.equal("cause" in (error as Error), false);
    return true;
  });
  assert.equal(setup.closed, 1);
});

test("a single timeout covers DNS and response reads and cancels the underlying connection", async () => {
  const dns = fixture();
  let signal: AbortSignal | undefined;
  dns.network.resolve = async (_, currentSignal) => { signal = currentSignal; return new Promise(() => undefined); };
  await assert.rejects(createWebhookPost(dns.network, 10)(URL_VALUE, {}, "{}"), { reason: "timeout" });
  assert.equal(signal?.aborted, true);
  assert.equal(dns.connected.length, 0);
  const stalled = fixture();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  stalled.secure.readable = new ReadableStream({ start(controller) { streamController = controller; } });
  const close = stalled.secure.close;
  stalled.secure.close = async () => { streamController?.error(new Error("closed")); await close(); };
  await assert.rejects(createWebhookPost(stalled.network, 10)(URL_VALUE, {}, "{}"), { reason: "timeout" });
  assert.ok(stalled.closed >= 1);
});

test("connections arriving after the deadline close and observe their rejected lifecycle promises", async () => {
  let resolveSocket: (socket: WebhookSocket) => void = () => undefined;
  const connection = new Promise<WebhookSocket>((resolve) => { resolveSocket = resolve; });
  let rejectOpened: (error: Error) => void = () => undefined;
  const opened = new Promise((_, reject) => { rejectOpened = reject; });
  let closed = 0;
  const socket: WebhookSocket = {
    readable: new ReadableStream(),
    writable: new WritableStream(),
    opened,
    closed: Promise.resolve(),
    close: async () => { closed++; rejectOpened(new Error("Connection closed after deadline")); },
    startTls: () => { throw new Error("Must not start TLS after deadline"); },
  };
  const post = createWebhookPost({ resolve: async () => ["93.184.215.14"], connect: () => connection }, 5);
  await assert.rejects(post(URL_VALUE, {}, "{}"), { reason: "timeout" });
  resolveSocket(socket);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(closed, 1);
});

test("DoH uses only the fixed HTTPS resolver, resolves both families and refuses redirects", async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    requests.push(input);
    assert.equal(url.origin, "https://cloudflare-dns.com");
    assert.equal(url.pathname, "/dns-query");
    assert.equal(url.searchParams.get("name"), "receiver.example.com");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    return Response.json({ Status: 0, TC: false, Answer: [{ type: 5, data: "alias.example.com." },
      { type: url.searchParams.get("type") === "A" ? 1 : 28, data: url.searchParams.get("type") === "A" ? "93.184.215.14" : "2001:4860::8888" }] });
  });
  assert.deepEqual(await resolveWebhookAddresses("receiver.example.com", new AbortController().signal), ["93.184.215.14", "2001:4860::8888"]);
  assert.equal(requests.length, 2);
});

test("malformed, truncated, oversized and failed DNS responses are categorized safely", async (t) => {
  for (const body of ["null", "{}", '{"Status":2,"TC":false}', '{"Status":0,"TC":true}', '{"Status":0,"TC":false,"Answer":[null]}', "x".repeat(16_385)]) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response(body));
    await assert.rejects(resolveWebhookAddresses("receiver.example.com", new AbortController().signal), { reason: "dns_failed" });
    mock.mock.restore();
  }
});

test("callback verification signs a fresh one-use challenge and requires an exact echo", async () => {
  const challenges = new Set<string>();
  const ids = new Set<string>();
  const post: WebhookPost = async (url, headers, body) => {
    assert.equal(url, URL_VALUE);
    assert.equal(headers["X-MCP-Subscription-Id"], "sub_123");
    assert.equal(headers["webhook-timestamp"], "1791547200");
    const expected = createHmac("sha256", Buffer.alloc(32, 7)).update(`${headers["webhook-id"]}.1791547200.${body}`).digest("base64");
    assert.equal(headers["webhook-signature"], `v1,${expected}`);
    const parsed = JSON.parse(body) as { type: string; challenge: string };
    assert.equal(parsed.type, "verification");
    assert.equal(Buffer.from(parsed.challenge, "base64").byteLength, 32);
    assert.equal(challenges.has(parsed.challenge), false);
    assert.equal(ids.has(headers["webhook-id"]), false);
    challenges.add(parsed.challenge);
    ids.add(headers["webhook-id"]);
    return { status: 200, body: JSON.stringify({ challenge: parsed.challenge }) };
  };
  await verifyCallback(URL_VALUE, SECRET, "sub_123", { post, now: () => 1_791_547_200_000 });
  await verifyCallback(URL_VALUE, SECRET, "sub_123", { post, now: () => 1_791_547_200_000 });
  for (const response of [{ status: 200, body: "null" }, { status: 200, body: "{}" }, { status: 200, body: '{"challenge":"wrong"}' }, { status: 500, body: "{}" }]) {
    await assert.rejects(verifyCallback(URL_VALUE, SECRET, "sub_123", { post: async () => response }), { reason: "challenge_failed" });
  }
});

test("a delayed challenge echo expires even when the injected transport succeeds", async () => {
  let now = 1_791_547_200_000;
  await assert.rejects(verifyCallback(URL_VALUE, SECRET, "sub_123", { now: () => now, post: async (_, __, body) => {
    now += 10_001;
    return { status: 200, body: JSON.stringify({ challenge: JSON.parse(body).challenge }) };
  } }), { reason: "timeout" });
});
