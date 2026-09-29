import assert from "node:assert/strict";
import { test } from "node:test";

import { deliver } from "../dist/site.js";
import type { Env } from "../dist/env.js";
import { MemoryStore } from "../dist/store.js";

function environment(overrides: Partial<Env> = {}): Env {
  return {
    STATE: new MemoryStore(),
    SITE_INGEST_URL: "https://ingest.example/api/ingest/playstation",
    ACCESS_CLIENT_ID: "client",
    ACCESS_CLIENT_SECRET: "secret",
    ...overrides,
  };
}

test("delivery posts the raw envelope and reads the changed flag", async (t) => {
  let body = "";
  let headers: Headers | undefined;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    body = String(init?.body ?? "");
    headers = new Headers(init?.headers);
    return new Response(JSON.stringify({ ok: true, data: { changed: true } }), { status: 202 });
  });
  assert.deepEqual(await deliver(environment(), { version: 1 }), { changed: true });
  assert.equal(body, JSON.stringify({ version: 1 }));
  assert.equal(headers?.get("CF-Access-Client-Id"), "client");
  assert.equal(headers?.get("CF-Access-Client-Secret"), "secret");
});

test("a rejected or unfinished reply is a delivery failure", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ ok: false, error: "bad envelope" }), { status: 400 }));
  await assert.rejects(deliver(environment(), { version: 1 }), /400：bad envelope/);
  await assert.rejects(deliver(environment(), { version: 2 } as never), /version 必须为 1/);
});

test("dry run only logs the envelope and never calls the site", async (t) => {
  const logged = t.mock.method(console, "log", () => {});
  const fetched = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("should not be called");
  });
  assert.deepEqual(await deliver(environment({ PS_DRY_RUN: "true" }), { version: 1 }), { changed: true });
  assert.equal(logged.mock.callCount(), 1);
  assert.equal(fetched.mock.callCount(), 0);
});
