import assert from "node:assert/strict";
import test from "node:test";

import { peerOrigins, relayIngest } from "./ingest-relay.ts";

test("逗号分隔，只留源 —— 路径由转发时按原请求拼上去", () => {
  assert.deepEqual(peerOrigins("https://a.example.com"), ["https://a.example.com"]);
  assert.deepEqual(peerOrigins("https://a.example.com, https://b.example.com"), [
    "https://a.example.com",
    "https://b.example.com",
  ]);
  // 配成带路径的地址也只取源，否则会转发到 /api/ingest/mac/api/ingest/mac
  assert.deepEqual(peerOrigins("https://a.example.com/api/ingest/mac"), ["https://a.example.com"]);
  assert.deepEqual(peerOrigins("https://a.example.com:8443"), ["https://a.example.com:8443"]);
});

test("没配就是空 —— 对应「不传播」，本地 dev 因此不会去敲线上", () => {
  assert.deepEqual(peerOrigins(undefined), []);
  assert.deepEqual(peerOrigins(""), []);
  // 末尾多一个逗号是手写清单的常态，不该冒出一个空地址
  assert.deepEqual(peerOrigins("https://a.example.com,"), ["https://a.example.com"]);
});

test("配坏了的那条跳过，别的照转 —— 一个错字不该把整条传播链停掉", () => {
  assert.deepEqual(peerOrigins("a.example.com, https://b.example.com"), [
    "https://b.example.com",
  ]);
  assert.deepEqual(peerOrigins("不是地址, https://b.example.com"), ["https://b.example.com"]);
  assert.deepEqual(peerOrigins("ws://a.example.com"), []);
});

test("自己被填进名单时摘掉：一跳的限制挡得住环，挡不住原地再跑一遍", () => {
  // 裸主机名（VERCEL_URL 那样的）和完整地址都要认得出是同一台
  assert.deepEqual(peerOrigins("https://a.example.com, https://b.example.com", ["a.example.com"]), [
    "https://b.example.com",
  ]);
  assert.deepEqual(
    peerOrigins("https://a.example.com, https://b.example.com", ["https://a.example.com"]),
    ["https://b.example.com"],
  );
  // EdgeOne 上没有那几个 Vercel 变量，取到 undefined 不能把整份名单判成自己
  assert.deepEqual(peerOrigins("https://a.example.com", [undefined, null]), [
    "https://a.example.com",
  ]);
});

test("同一个源填两遍只转一次，不给对端送两份一模一样的上报", () => {
  assert.deepEqual(peerOrigins("https://a.example.com, https://a.example.com/"), [
    "https://a.example.com",
  ]);
});

/* ── 转发本身 ──────────────────────────────────────────────── */

type Sent = { url: string; init: RequestInit };

/** 换掉 fetch 和 console.error，跑完还原。返回这一轮发出去的请求 */
function stub(
  t: { after: (fn: () => void) => void },
  reply: (url: string) => Promise<Response>,
): Sent[] {
  const sent: Sent[] = [];
  const realFetch = globalThis.fetch;
  const realError = console.error;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return reply(url);
  }) as typeof globalThis.fetch;
  // 失败那几条本来就该打日志，测试里不用看
  console.error = () => {};
  t.after(() => {
    globalThis.fetch = realFetch;
    console.error = realError;
    delete process.env.INGEST_PEERS;
    delete process.env.TELEMETRY_INGEST_SECRET;
  });
  return sent;
}

function accepted(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ ok: true, data }), { status: 202 }),
  );
}

/** 上报器打进来的那一次：本站的地址 + 上报器那把密钥 */
function incoming(headers: Record<string, string> = {}) {
  return new Request("https://mine.example.com/api/ingest/mac", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: '{"version":4}',
  });
}

test("转发是原样重发：同一条路径、同一段字节，外加转发标记和密钥", async (t) => {
  process.env.INGEST_PEERS = "https://peer.example.com";
  process.env.TELEMETRY_INGEST_SECRET = "s3cret";
  const sent = stub(t, () => accepted({ accepted: 1 }));

  assert.equal(await relayIngest(incoming(), '{"version":4}'), undefined);

  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.url, "https://peer.example.com/api/ingest/mac");
  assert.equal(sent[0]!.init.method, "POST");
  assert.equal(sent[0]!.init.body, '{"version":4}');
  const headers = sent[0]!.init.headers as Record<string, string>;
  assert.equal(headers["x-ingest-relay"], "1");
  assert.equal(headers.authorization, "Bearer s3cret");
});

test("对端转来的那份不再往下传 —— 两边互填对方，再传一次就成环", async (t) => {
  process.env.INGEST_PEERS = "https://peer.example.com";
  const sent = stub(t, () => accepted({}));

  await relayIngest(incoming({ "x-ingest-relay": "1" }), "{}");

  assert.deepEqual(sent, []);
});

test("没配对端就一次都不发，本地 dev 因此不会去敲线上", async (t) => {
  const sent = stub(t, () => accepted({}));
  await relayIngest(incoming(), "{}");
  assert.deepEqual(sent, []);
});

test("一个对端连不上不连累另一个，也不往上抛 —— 本地这次已经落库了", async (t) => {
  process.env.INGEST_PEERS = "https://down.example.com, https://up.example.com";
  const sent = stub(t, (url) =>
    url.startsWith("https://down")
      ? Promise.reject(new Error("connect ETIMEDOUT"))
      : accepted({ missingImages: ["a"] }),
  );

  await assert.doesNotReject(() => relayIngest(incoming(), "{}"));
  assert.equal(sent.length, 2);
});

test("对端回了 4xx 或者根本不是信封也不抛，只进日志", async (t) => {
  process.env.INGEST_PEERS = "https://peer.example.com";
  const sent = stub(t, () =>
    Promise.resolve(new Response("<html>502</html>", { status: 502 })),
  );
  await assert.doesNotReject(() => relayIngest(incoming(), "{}"));
  assert.equal(sent.length, 1);
});
