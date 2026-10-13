import assert from "node:assert/strict";
import test from "node:test";

import * as Sentry from "@sentry/cloudflare";

import { sentryOptions as aiSentryOptions } from "../../ai/src/sentry.ts";
import { sentryOptions as collectorSentryOptions } from "../../collector/src/sentry.ts";
import { sentryOptions as ingressSentryOptions } from "../../ingress/src/sentry.ts";
import { sentryOptions } from "./sentry.ts";

const CHAT = "PLANTED-CHAT-TEXT";
const CODE = "PLANTED-OAUTH-CODE";
const API_KEY = "sk-ant-planted-000";
const CLIENT_IP = "203.0.113.77";

type Envelope = [Record<string, unknown>, [{ type: string }, unknown][]];
type Payload = { request?: { url?: string; method?: string; data?: unknown; headers?: unknown } };

function harness<Env>(options: (env: Env) => Sentry.CloudflareOptions) {
  const envelopes: Envelope[] = [];
  const transport = () => ({
    send: async (envelope: Envelope) => {
      envelopes.push(envelope);
      return { statusCode: 200 };
    },
    flush: async () => true,
  });
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };
  const env = { SENTRY_DSN: "http://public@127.0.0.1:9/1" } as Env;
  const wrapped = (env: Env) => ({ ...options(env), tracesSampleRate: 1, transport, cacheClient: false }) as Sentry.CloudflareOptions;
  const handler: ExportedHandler<Env> = {
    async fetch(request) {
      await request.text();
      if (new URL(request.url).pathname === "/throw") throw new Error("handler failed");
      Sentry.captureException(new Error("handled failure"));
      return new Response("bad", { status: 400 });
    },
  };
  const worker = Sentry.withSentry(wrapped, handler);
  async function send(path: string, body: unknown, headers: Record<string, string> = {}) {
    const request = new Request(`https://api.example.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    await Promise.resolve(worker.fetch!(request as never, env, ctx as never)).catch(() => undefined);
    await Promise.all(pending.splice(0));
  }
  const items = () => envelopes.flatMap(([, list]) => list.map(([header, payload]) => ({ type: header.type, payload: payload as Payload })));
  return { send, items, raw: () => JSON.stringify(envelopes) };
}

async function exercise<Env>(options: (env: Env) => Sentry.CloudflareOptions) {
  const run = harness(options);
  await run.send("/api/chat", { messages: [{ role: "user", content: CHAT }], turnstileToken: "t" });
  await run.send("/api/build", { title: "t", body: "b", code: CODE });
  await run.send("/throw", { code: CODE }, { "x-api-key": API_KEY, "cf-connecting-ip": CLIENT_IP });
  await run.send("/v1/messages", { messages: [{ role: "user", content: CHAT }] }, { "x-api-key": API_KEY });
  return run;
}

for (const { name, run: exerciseWorker } of [
  { name: "core", run: () => exercise(sentryOptions) },
  { name: "ai", run: () => exercise(aiSentryOptions) },
  { name: "ingress", run: () => exercise(ingressSentryOptions) },
  { name: "collector", run: () => exercise(collectorSentryOptions) },
]) {
  test(`${name} 的 Sentry 事件不带请求正文、请求头与客户端 IP，错误只留 url 与 method`, async () => {
    const run = await exerciseWorker();
    const items = run.items();
    const types = new Set(items.map((item) => item.type));
    assert.ok(types.has("event") && types.has("span"), `expected errors and spans, got ${[...types]}`);
    for (const { type, payload } of items.filter((item) => item.type === "event")) {
      assert.ok(payload.request?.url && payload.request?.method, `${type} keeps url and method`);
      assert.equal(payload.request.data, undefined, `${type} carries no body`);
      assert.equal(payload.request.headers, undefined, `${type} carries no headers`);
    }
    const raw = run.raw();
    for (const planted of [CHAT, CODE, API_KEY, CLIENT_IP]) assert.ok(!raw.includes(planted), `${planted} leaked`);
  });
}

test("对照：缺省 dataCollection 时 SDK 会把正文原样写进事件，上面的逐项关闭不能删", async () => {
  const run = await exercise((env: Parameters<typeof sentryOptions>[0]) => ({ ...sentryOptions(env), dataCollection: undefined }));
  const raw = run.raw();
  for (const planted of [CHAT, CODE, CLIENT_IP]) assert.ok(raw.includes(planted), `${planted} expected in default capture`);
});
