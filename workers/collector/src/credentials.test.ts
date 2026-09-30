import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { CREDENTIAL_KEYS } from "@shared/credentials";

import { appleDeveloperToken, resetAppleDeveloperTokenForTests } from "./apple-developer-token";
import { readAppleMusicCredentials } from "./apple-music-credentials";
import type { Env } from "./env";
import { bindEnv, unbindEnvForTests } from "./runtime";
import { MemoryKv } from "./testing/memory-kv";

afterEach(() => {
  resetAppleDeveloperTokenForTests();
  unbindEnvForTests();
});

test("the developer token comes from the core and is reused until ten minutes before expiry", async (t) => {
  let issued = 0;
  let expiresAt = Date.now() + 60 * 60_000;
  bindEnv({ CORE: { appleDeveloperToken: async () => ({ token: `t${++issued}`, expiresAt }) } } as unknown as Env);
  assert.equal(await appleDeveloperToken(), "t1");
  assert.equal(await appleDeveloperToken(), "t1");
  assert.equal(issued, 1);

  t.mock.method(Date, "now", () => expiresAt - 9 * 60_000);
  expiresAt += 60 * 60_000;
  assert.equal(await appleDeveloperToken(), "t2");
});

test("the music user token is read from the credentials KV with the reason when absent", async () => {
  const credentials = new MemoryKv();
  bindEnv({ CREDENTIALS: credentials.asKv() } as Env);
  assert.deepEqual(await readAppleMusicCredentials(), { ok: false, reason: "never-pushed" });
  await credentials.put(CREDENTIAL_KEYS.appleMusic, JSON.stringify({ musicUserToken: "user-token", receivedAt: 1 }));
  assert.deepEqual(await readAppleMusicCredentials(), { ok: true, credentials: { musicUserToken: "user-token", receivedAt: 1 } });
});
