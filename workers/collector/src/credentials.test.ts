import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { appleDeveloperToken, readAppleMusicCredentials } from "@shared/apple-music-auth";
import { CREDENTIAL_KEYS } from "@shared/credentials";

import { installCollectorPorts } from "./ports";
import type { Env } from "./env";
import { bindEnv, unbindEnvForTests } from "./runtime";
import { MemoryKv } from "./testing/memory-kv";

installCollectorPorts();

afterEach(() => {
  unbindEnvForTests();
});

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString());
}

test("the developer token is signed here from APPLE_MUSIC_PRIVATE_KEY, without an origin claim and without asking the core", async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = Buffer.from((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer).toString("base64");
  bindEnv({
    APPLE_MUSIC_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`,
    APPLE_MUSIC_TEAM_ID: "TEAM000000",
    APPLE_MUSIC_KEY_ID: "KEY0000000",
    ALLOWED_ORIGINS: "https://lyjw.me",
    CORE: { appleDeveloperToken: async () => assert.fail("采集 Worker 不应再向状态核心要令牌") },
  } as unknown as Env);

  const [header, payload, signature] = (await appleDeveloperToken()).split(".");
  assert.ok(header && payload && signature, "JWT 应有三段");
  assert.deepEqual(decodePart(header), { alg: "ES256", kid: "KEY0000000" });
  assert.equal(decodePart(payload).iss, "TEAM000000");
  assert.equal("origin" in decodePart(payload), false);
  assert.ok(await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pair.publicKey,
    Buffer.from(signature, "base64url"),
    new TextEncoder().encode(`${header}.${payload}`),
  ));
});

test("the music user token is read from the credentials KV with the reason when absent", async () => {
  const credentials = new MemoryKv();
  bindEnv({ CREDENTIALS: credentials.asKv() } as Env);
  assert.deepEqual(await readAppleMusicCredentials(), { ok: false, reason: "never-pushed" });
  await credentials.put(CREDENTIAL_KEYS.appleMusic, JSON.stringify({ musicUserToken: "user-token", receivedAt: 1 }));
  assert.deepEqual(await readAppleMusicCredentials(), { ok: true, credentials: { musicUserToken: "user-token", receivedAt: 1 } });
});
