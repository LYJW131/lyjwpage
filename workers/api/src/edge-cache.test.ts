import assert from "node:assert/strict";
import test from "node:test";

import { edgeCacheRequest, serveWithEdgeCache, type EdgeCache } from "./edge-cache.ts";

function memoryCache() {
  const entries = new Map<string, Response>();
  const urlOf = (request: string | URL | Request): string => (typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
  const puts: string[] = [];
  const cache: EdgeCache = {
    async match(request) {
      const url = urlOf(request);
      return entries.get(url)?.clone();
    },
    async put(request, response) {
      const url = urlOf(request);
      puts.push(url);
      entries.set(url, response);
    },
  };
  return { cache, puts };
}

function lookup(status: number, body: string) {
  let calls = 0;
  return {
    get calls() { return calls; },
    origin: async () => {
      calls += 1;
      return new Response(body, { status, headers: { "Cache-Control": status === 200 ? "public, max-age=60" : "no-store" } });
    },
  };
}

test("第二次同键请求从缓存回，不再回源", async () => {
  const { cache } = memoryCache();
  const source = lookup(200, "{\"lines\":[]}");
  const pending: Promise<unknown>[] = [];
  const key = edgeCacheRequest("https://api.example", "lyrics:v4:cn:1");
  const serve = () => serveWithEdgeCache({ cache, key, origin: source.origin, waitUntil: (p) => pending.push(p) });

  const first = await serve();
  assert.equal(first.headers.get("X-Edge-Cache"), "miss");
  assert.equal(await first.text(), "{\"lines\":[]}");
  await Promise.all(pending);

  const second = await serve();
  assert.equal(second.headers.get("X-Edge-Cache"), "hit");
  assert.equal(await second.text(), "{\"lines\":[]}");
  assert.equal(source.calls, 1);
});

test("非 200 不写回", async () => {
  const { cache, puts } = memoryCache();
  const pending: Promise<unknown>[] = [];
  const key = edgeCacheRequest("https://api.example", "lyrics:v4:cn:1");
  for (const status of [400, 500]) {
    const response = await serveWithEdgeCache({ cache, key, origin: lookup(status, "{}").origin, waitUntil: (p) => pending.push(p) });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("X-Edge-Cache"), "miss");
  }
  await Promise.all(pending);
  assert.deepEqual(puts, []);
});

test("没有键或没有缓存时直接回源", async () => {
  const { cache } = memoryCache();
  const source = lookup(200, "{}");
  const noKey = await serveWithEdgeCache({ cache, key: null, origin: source.origin, waitUntil: () => {} });
  const noCache = await serveWithEdgeCache({
    cache: undefined,
    key: edgeCacheRequest("https://api.example", "k"),
    origin: source.origin,
    waitUntil: () => {},
  });
  assert.equal(noKey.headers.get("X-Edge-Cache"), "bypass");
  assert.equal(noCache.headers.get("X-Edge-Cache"), "bypass");
  assert.equal(source.calls, 2);
});

test("缓存读出错时照常回源", async () => {
  const source = lookup(200, "{}");
  const broken: EdgeCache = {
    match: async () => { throw new Error("cache down"); },
    put: async () => { throw new Error("cache down"); },
  };
  const pending: Promise<unknown>[] = [];
  const response = await serveWithEdgeCache({
    cache: broken,
    key: edgeCacheRequest("https://api.example", "k"),
    origin: source.origin,
    waitUntil: (p) => pending.push(p),
  });
  await Promise.all(pending);
  assert.equal(response.status, 200);
  assert.equal(source.calls, 1);
});

test("键里的字符都经过编码，落在保留前缀下", () => {
  const request = edgeCacheRequest("https://api.example", "motion-artwork:v1:cn:album:1:https%3A%2F%2Fmusic.apple.com%2F?x=1");
  const url = new URL(request.url);
  assert.equal(url.origin, "https://api.example");
  assert.ok(url.pathname.startsWith("/__edge-cache/v2/"));
  assert.equal(url.search, "");
});

test("命中时恢复原始 Cache-Control，内部头不外露", async () => {
  const { cache } = memoryCache();
  const pending: Promise<unknown>[] = [];
  const key = edgeCacheRequest("https://api.example", "k");
  const origin = async () => new Response("{}", { headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } });
  await serveWithEdgeCache({ cache, key, origin, waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  // 模拟 Cloudflare 按区域浏览器 TTL 改写了存着的那份
  const stored = await cache.match(key);
  assert.ok(stored);
  const rewritten = new Headers(stored.headers);
  rewritten.set("Cache-Control", "public, max-age=14400, s-maxage=3600");
  await cache.put(key, new Response(await stored.text(), { headers: rewritten }));

  const hit = await serveWithEdgeCache({ cache, key, origin, waitUntil: () => {} });
  assert.equal(hit.headers.get("X-Edge-Cache"), "hit");
  assert.equal(hit.headers.get("Cache-Control"), "public, max-age=3600, s-maxage=3600");
  assert.equal(hit.headers.get("X-Origin-Cache-Control"), null);
});
