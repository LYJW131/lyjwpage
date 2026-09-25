import assert from "node:assert/strict";
import test from "node:test";

import { setJwksFetcherForTests, verifyAccessJwt } from "@shared/access-jwt";

import { authorize, DEV_ACCESS_ISSUER, type AccessEnv } from "./access-auth";

const ISSUER = "https://team.cloudflareaccess.com";
const AUD = "aud-tag";
const MAC = "mac-client.access";
const HA = "ha-client.access";

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
) as CryptoKeyPair;
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey) as JsonWebKey), kid: "k1" };

const env: AccessEnv = {
  ACCESS_TEAM_DOMAIN: `${ISSUER}/`,
  ACCESS_AUD: AUD,
  ACCESS_CLIENTS: { [MAC]: ["ingest:mac"], [HA]: ["ingest:homepod", "ingest:playstation"] },
};

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return Buffer.from(bytes).toString("base64url");
}

async function sign(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1" }): Promise<string> {
  const head = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(head));
  return `${head}.${b64url(new Uint8Array(signature))}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { aud: [AUD], iss: ISSUER, iat: now, exp: now + 3600, common_name: MAC, ...overrides };
}

function request(headers: Record<string, string>): Request {
  return new Request("https://ingest.example/api/ingest/mac", { method: "POST", headers });
}

let fetches = 0;
setJwksFetcherForTests(async (issuer) => {
  assert.equal(issuer, ISSUER);
  fetches += 1;
  return [publicJwk];
});

test("a valid Access JWT authorizes only the permissions listed for its client id", async () => {
  const token = await sign(claims());
  assert.deepEqual(await authorize(request({ "Cf-Access-Jwt-Assertion": token }), env, "ingest:mac"),
    { ok: true, clientId: MAC });
  const other = await authorize(request({ "Cf-Access-Jwt-Assertion": token }), env, "ingest:emby");
  assert.equal(other.ok, false);
  assert.equal(!other.ok && other.status, 403);

  const ha = await sign(claims({ common_name: HA }));
  assert.equal((await authorize(request({ "Cf-Access-Jwt-Assertion": ha }), env, "ingest:playstation")).ok, true);
});

test("JWTs with the wrong audience, issuer, expiry, algorithm or signature are rejected", async () => {
  const now = Math.floor(Date.now() / 1000);
  const bad = [
    await sign(claims({ aud: ["other"] })),
    await sign(claims({ iss: "https://evil.cloudflareaccess.com" })),
    await sign(claims({ exp: now - 10 })),
    await sign(claims({ common_name: "unknown.access" })),
    await sign(claims(), { alg: "none", kid: "k1" }),
    (await sign(claims())).replace(/\.[^.]+$/, ".AAAA"),
    "not-a-jwt",
  ];
  for (const token of bad) {
    const result = await authorize(request({ "Cf-Access-Jwt-Assertion": token }), env, "ingest:mac");
    assert.equal(result.ok, false, token);
  }
});

test("the old shared bearer is no longer accepted", async () => {
  assert.equal((await authorize(request({ Authorization: "Bearer legacy" }), env, "ingest:mac")).ok, false);
});

test("a local test key set is honoured only under the dev issuer", async () => {
  const jwks = JSON.stringify({ keys: [publicJwk] });
  const dev: AccessEnv = { ...env, ACCESS_TEAM_DOMAIN: DEV_ACCESS_ISSUER, ACCESS_DEV_JWKS: jwks };
  setJwksFetcherForTests(async () => { throw new Error("dev keys must not hit the network"); });
  const token = await sign(claims({ iss: DEV_ACCESS_ISSUER }));
  assert.equal((await authorize(request({ "Cf-Access-Jwt-Assertion": token }), dev, "ingest:mac")).ok, true);
  // 真实 team 域名下误配了 ACCESS_DEV_JWKS：照样去拉线上公钥，不认测试钥匙
  const prod: AccessEnv = { ...env, ACCESS_DEV_JWKS: jwks };
  setJwksFetcherForTests(async () => []);
  assert.equal((await authorize(request({ "Cf-Access-Jwt-Assertion": await sign(claims()) }), prod, "ingest:mac")).ok, false);
});

test("an unknown kid refetches the key set, at most once a minute", async () => {
  setJwksFetcherForTests(async () => { fetches += 1; return [publicJwk]; });
  fetches = 0;
  const t0 = Date.now();
  const verify = (token: string, now: number) => verifyAccessJwt(token, { teamDomain: ISSUER, audience: AUD }, now);
  const jwt = (overrides = {}, kid = "k1") => sign(claims(overrides), { alg: "RS256", kid });
  assert.equal((await verify(await jwt(), t0))?.commonName, MAC);
  assert.equal((await verify(await jwt(), t0 + 1000))?.commonName, MAC);
  assert.equal(fetches, 1);
  // 编造的 kid：冷却期内不出网
  assert.equal(await verify(await jwt({}, "forged"), t0 + 2000), null);
  assert.equal(await verify(await jwt({}, "forged"), t0 + 3000), null);
  assert.equal(fetches, 1);
  // 冷却过了才重拉
  assert.equal(await verify(await jwt({ exp: Math.floor(t0 / 1000) + 3600 }, "forged"), t0 + 61_000), null);
  assert.equal(fetches, 2);
});
