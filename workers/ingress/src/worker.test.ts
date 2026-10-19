import assert from "node:assert/strict";
import test from "node:test";

import { STORAGE_MAX_BYTES } from "@shared/storage-contract";

import { DEPLOYER, MAC_ONLY, json, mac, post, world } from "./testing/world";

test("routes: only the ingest paths and site-deployed exist; unknown sources are 404 before auth", async () => {
  const w = world();
  const root = await w.send("/", { method: "GET", client: null });
  assert.equal(root.status, 200);
  assert.deepEqual(await json(root), { ok: true, service: "ingest" });
  for (const path of ["/count", "/ws", "/api/status/listening/now", "/api/internal/storage/import"]) {
    assert.equal((await w.send(path, { method: "GET", client: null })).status, 404, path);
  }
  const get = await w.send("/api/ingest/mac", { method: "GET", client: null });
  assert.equal(get.status, 405);
  assert.deepEqual(await json(get), { ok: false, error: "只接受 POST" });
  const unknown = await w.send("/api/ingest/constructor", post({}));
  assert.equal(unknown.status, 404);
  assert.deepEqual(await json(unknown), { ok: false, error: "没有这个上报来源：constructor" });
  assert.equal((await w.send("/api/ingest/agents-otlp", post({}))).status, 404, "the OTLP source is only reachable on its own path");
  assert.equal(w.calls.commits.length, 0);
});

test("preview versions refuse every report and hide site-deployed", async () => {
  const previous = process.env.PREVIEW_WORKER;
  process.env.PREVIEW_WORKER = "true";
  try {
    const w = world();
    const refused = await w.send("/api/ingest/mac", post(mac({})));
    assert.equal(refused.status, 403);
    assert.deepEqual(await json(refused), { ok: false, error: "预览 Worker 不接收上报" });
    assert.equal((await w.send("/api/ingest/agents/otlp", post({ resourceMetrics: [] }))).status, 403);
    assert.equal((await w.send("/api/internal/site-deployed", { client: DEPLOYER })).status, 404);
    assert.equal((await w.send("/api/internal/collector-refresh", { client: DEPLOYER })).status, 404);
    assert.equal(w.calls.commits.length + w.calls.broadcasts + w.calls.refreshed.length, 0);
  } finally {
    if (previous === undefined) delete process.env.PREVIEW_WORKER; else process.env.PREVIEW_WORKER = previous;
  }
});

test("auth: only a signed Access assertion counts, and each client id writes only its own sources", async () => {
  const w = world();
  const missing = await w.send("/api/ingest/mac", { ...post(mac({})), client: null });
  assert.equal(missing.status, 401);
  assert.deepEqual(await json(missing), { ok: false, error: "未授权" });
  assert.equal((await w.send("/api/ingest/mac", { ...post(mac({})), client: null, headers: { authorization: "Bearer retired-secret" } })).status, 401);
  assert.equal((await w.send("/api/ingest/mac", { ...post(mac({})), client: null, headers: { "CF-Access-Client-Id": MAC_ONLY, "CF-Access-Client-Secret": "x" } })).status, 401);
  const wrongSource = await w.send("/api/ingest/emby", { ...post({}), client: MAC_ONLY });
  assert.equal(wrongSource.status, 403);
  assert.deepEqual(await json(wrongSource), { ok: false, error: "这把凭据不能做这件事" });
  assert.equal((await w.send("/api/ingest/agents/otlp", { ...post({ resourceMetrics: [] }), client: MAC_ONLY })).status, 403);
  assert.equal((await w.send("/api/internal/site-deployed", { client: MAC_ONLY })).status, 403);
  assert.equal((await w.send("/api/ingest/emby", { ...post({}), client: DEPLOYER })).status, 403, "the deploy token cannot write reports");
  assert.equal((await w.send("/api/ingest/mac", { ...post(mac({})), client: "unregistered.access" })).status, 403);
  assert.equal(w.calls.commits.length, 0);
  assert.equal((await w.send("/api/ingest/mac", { ...post(mac({})), client: MAC_ONLY })).status, 202);
});

test("bodies are bounded by the bytes actually read", async () => {
  const w = world();
  const tooLarge = await w.send("/api/ingest/mac", { body: `"${"x".repeat(STORAGE_MAX_BYTES)}"` });
  assert.equal(tooLarge.status, 400);
  assert.deepEqual(await json(tooLarge), { ok: false, error: "无法读取上报数据" });
  assert.equal(w.calls.commits.length, 0);
});
