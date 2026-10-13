import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { lyricsCacheKey } from "@shared/lyrics";

import { serveAppleLookup, serveAppleMusic } from "./apple-music-http";
import type { Env } from "./env";
import { installCollectorPorts } from "./ports";
import { bindEnv, unbindEnvForTests } from "./runtime";
import { MemoryKv } from "./testing/memory-kv";

installCollectorPorts();

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  unbindEnvForTests();
});

const SITE = "https://lyjw.me";
const LYRICS = `${SITE}/api/lyrics?song=1501`;

function gatewayEnv(forwarded: string[] = []): Env {
  return {
    ALLOWED_ORIGINS: SITE,
    APPLE_LOOKUPS: {
      fetch: async (request: Request) => {
        forwarded.push(request.url);
        return Response.json({ songId: "1501", lines: [] }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
      },
    },
  } as unknown as Env;
}

test("the gateway answers preflight, method and origin itself, then adds CORS around the cached lookup", async () => {
  const forwarded: string[] = [];
  const env = gatewayEnv(forwarded);
  const preflight = await serveAppleMusic(new Request(LYRICS, { method: "OPTIONS", headers: { Origin: SITE } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), SITE);
  assert.equal((await serveAppleMusic(new Request(LYRICS, { method: "POST", headers: { Origin: SITE } }), env)).status, 405);
  assert.equal((await serveAppleMusic(new Request(LYRICS, { headers: { Origin: "https://evil.example" } }), env)).status, 403);
  assert.deepEqual(forwarded, []);

  const response = await serveAppleMusic(new Request(LYRICS, { headers: { Origin: SITE } }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), SITE);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60, s-maxage=60");
  assert.deepEqual(await response.json(), { songId: "1501", lines: [] });
  assert.deepEqual(forwarded, [LYRICS]);
});

test("the MusicKit token is signed for the asking site only, never cached by the browser, and refused elsewhere", async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = Buffer.from((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer).toString("base64");
  const env = {
    ...gatewayEnv(),
    ALLOWED_ORIGINS: `${SITE},https://*.lyjw.workers.dev`,
    APPLE_MUSIC_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`,
    APPLE_MUSIC_TEAM_ID: "TEAM000000",
    APPLE_MUSIC_KEY_ID: "KEY0000000",
  } as Env;
  const token = (origin: string, init: RequestInit = {}) =>
    serveAppleMusic(new Request(`${SITE}/api/musickit/token`, { ...init, headers: { Origin: origin } }), env);

  const issued = await token("https://x-site.lyjw.workers.dev");
  assert.equal(issued.status, 200);
  assert.equal(issued.headers.get("Cache-Control"), "no-store");
  const { token: jwt } = (await issued.json()) as { token: string };
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString()) as { origin?: string[] };
  assert.deepEqual(payload.origin, ["https://x-site.lyjw.workers.dev"]);

  assert.equal((await token("https://evil.example")).status, 403);
  assert.equal((await token(SITE, { method: "POST" })).status, 405);
  const misconfigured = await serveAppleMusic(
    new Request(`${SITE}/api/musickit/token`, { headers: { Origin: SITE } }),
    { ...env, APPLE_MUSIC_TEAM_ID: "" } as Env,
  );
  assert.equal(misconfigured.status, 500);
  assert.deepEqual(await misconfigured.json(), { error: "没有配置 APPLE_MUSIC_TEAM_ID" });
});

test("the lookup entrypoint answers from APPLE_CACHE without the network and rejects bad input uncached", async () => {
  const kv = new MemoryKv();
  bindEnv({ APPLE_CACHE: kv.asKv() } as Env);
  await kv.put(`lyjwpage:${lyricsCacheKey("1501")}`, JSON.stringify({ lines: [{ startMs: 0, endMs: 1_000, text: "la" }] }));
  globalThis.fetch = (async () => { throw new Error("network disabled"); }) as typeof fetch;

  const hit = await serveAppleLookup(new Request(LYRICS));
  assert.equal(hit.status, 200);
  assert.match(hit.headers.get("Cache-Control") ?? "", /^public, max-age=\d+, s-maxage=\d+$/);
  assert.deepEqual(await hit.json(), { songId: "1501", lines: [{ startMs: 0, endMs: 1_000, text: "la" }] });

  const invalid = await serveAppleLookup(new Request(`${SITE}/api/lyrics?song=abc`));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("Cache-Control"), "no-store, no-cache, must-revalidate");
  assert.equal((await serveAppleLookup(new Request(`${SITE}/api/musickit/token`))).status, 404);
});

function appleCacheConfig(path: string): { id?: string; prefix?: string; storefront?: string } {
  const text = readFileSync(`${dirname(fileURLToPath(import.meta.url))}/${path}`, "utf8").split(/^\[previews/m)[0] ?? "";
  const value = (name: string) => text.match(new RegExp(`^${name} = "([^"]*)"$`, "m"))?.[1];
  return {
    id: text.match(/^binding = "APPLE_CACHE"\nid = "([^"]+)"$/m)?.[1],
    prefix: value("STORAGE_PREFIX"),
    storefront: value("APPLE_MUSIC_STOREFRONT"),
  };
}

test("APPLE_CACHE is shared with api: namespace, key prefix and storefront match in production and local configs", () => {
  for (const file of ["wrangler.toml", "wrangler.test.toml"]) {
    const collector = appleCacheConfig(`../${file}`);
    assert.ok(collector.id && collector.prefix && collector.storefront, file);
    assert.deepEqual(appleCacheConfig(`../../api/${file}`), collector, file);
  }
});
