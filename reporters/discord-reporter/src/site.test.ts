import assert from "node:assert/strict";
import test from "node:test";
import { createSitePush } from "./site.ts";

const settings = { ingestUrl: "https://example.com/api/ingest/quest", clientId: "test-id", clientSecret: "test-secret", dryRun: false, pushTimeoutMs: 1_000 };
const presence = { observedAt: 100, discordStatus: "online" as const, playing: null };

test("POST sends Quest envelope with Access service token and reads ingress receipt", async () => {
  const push = createSitePush(settings, (async (url, init) => {
    assert.equal(url, settings.ingestUrl);
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("CF-Access-Client-Id"), settings.clientId);
    assert.equal(headers.get("CF-Access-Client-Secret"), settings.clientSecret);
    assert.equal(headers.get("Authorization"), null);
    assert.deepEqual(JSON.parse(init?.body as string), { version: 1, presence });
    return Response.json({ ok: true, data: { changed: true } });
  }) as typeof fetch);
  assert.deepEqual(await push(presence), { changed: true });
});

test("bad HTTP, failed and non-JSON receipts reject rather than mark success", async () => {
  for (const response of [Response.json({ ok: false, error: "Rejected" }), Response.json({ ok: true }, { status: 403 }), new Response("Login")]) {
    const push = createSitePush(settings, (async () => response) as typeof fetch);
    await assert.rejects(push(presence), /站点返回/);
  }
});

test("successful unchanged receipt and dry-run are unchanged", async () => {
  const unchanged = createSitePush(settings, (async () => Response.json({ ok: true, data: { changed: false } })) as typeof fetch);
  assert.deepEqual(await unchanged(presence), { changed: false });
  const dryRun = createSitePush({ ...settings, dryRun: true }, (async () => { throw new Error("must not fetch"); }) as typeof fetch);
  assert.deepEqual(await dryRun(presence), { changed: false });
});

test("connection invalidation aborts the active HTTP request", async () => {
  const controller = new AbortController();
  const push = createSitePush(settings, (async (_url, init) => {
    const signal = init?.signal;
    assert.ok(signal);
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    return Response.json({ ok: true });
  }) as typeof fetch);
  const request = push(presence, controller.signal);
  controller.abort();
  await assert.rejects(request);
});
