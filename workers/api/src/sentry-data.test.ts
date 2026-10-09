import assert from "node:assert/strict";
import test from "node:test";

import * as Sentry from "@sentry/cloudflare";

import type { Env } from "./runtime.ts";
import { sentryOptions } from "./sentry.ts";

const CHAT = "PLANTED-CHAT-TEXT";
const CODE = "PLANTED-OAUTH-CODE";
const API_KEY = "sk-ant-planted-000";

type Envelope = [Record<string, unknown>, [{ type: string }, unknown][]];
type Payload = { request?: { url?: string; method?: string; data?: unknown; headers?: unknown } };

function harness(options: (env: Env) => Sentry.CloudflareOptions) {
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
  const wrapped = (env: Env) => ({ ...options(env), tracesSampleRate: 1, transport }) as Sentry.CloudflareOptions;
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

async function exercise(options: (env: Env) => Sentry.CloudflareOptions) {
  const run = harness(options);
  await run.send("/api/chat", { messages: [{ role: "user", content: CHAT }], turnstileToken: "t" });
  await run.send("/api/github/issue", { title: "t", body: "b", code: CODE });
  await run.send("/throw", { code: CODE }, { "x-api-key": API_KEY });
  await run.send("/v1/messages", { messages: [{ role: "user", content: CHAT }] }, { "x-api-key": API_KEY });
  return run;
}

test("Worker 的 Sentry 事件不带请求正文与请求头，错误和 transaction 都只留 url 与 method", async () => {
  const run = await exercise(sentryOptions);
  const items = run.items();
  const types = new Set(items.map((item) => item.type));
  assert.ok(types.has("event") && types.has("transaction"), `expected errors and transactions, got ${[...types]}`);
  for (const { type, payload } of items.filter((item) => item.type === "event" || item.type === "transaction")) {
    assert.ok(payload.request?.url && payload.request?.method, `${type} keeps url and method`);
    assert.equal(payload.request.data, undefined, `${type} carries no body`);
    assert.equal(payload.request.headers, undefined, `${type} carries no headers`);
  }
  const raw = run.raw();
  for (const planted of [CHAT, CODE, API_KEY]) assert.ok(!raw.includes(planted), `${planted} leaked`);
});

test("对照：SDK 默认集成会把正文和 x-api-key 原样写进事件，上面的覆盖不能删", async () => {
  const run = await exercise((env) => ({ ...sentryOptions(env), integrations: [] }));
  const raw = run.raw();
  for (const planted of [CHAT, CODE, API_KEY]) assert.ok(raw.includes(planted), `${planted} expected in default capture`);
});
