import assert from "node:assert/strict";
import test from "node:test";

import { setJwksFetcherForTests } from "@shared/access-jwt";

import { handleAuthorize, handleExchange, sealCode, setRotateForTests, type PairingEnv } from "./pairing";

const ISSUER = "https://team.cloudflareaccess.com";
const AUD = "pairing-aud";
const ORIGIN = "https://api.example";
const REDIRECT = "mactelemetryhub://pair";

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
) as CryptoKeyPair;
setJwksFetcherForTests(async () => [{ ...(await crypto.subtle.exportKey("jwk", pair.publicKey) as JsonWebKey), kid: "k1" }]);

const env: PairingEnv = {
  ACCESS_TEAM_DOMAIN: ISSUER,
  PAIRING_ACCESS_AUD: AUD,
  PAIRING_EMAILS: "Owner@example.com",
  PAIRING_SOURCES: { mac: { tokenId: "token-mac", clientId: "mac.access", redirectUri: REDIRECT, label: "Mac Telemetry Hub" } },
  PAIRING_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"),
  CF_ACCESS_API_TOKEN: "api-token",
  CLOUDFLARE_ACCOUNT_ID: "account",
};

const b64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64url");

async function jwt(email: string, aud = AUD): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64url(JSON.stringify({ alg: "RS256", kid: "k1" }))}.${b64url(JSON.stringify({ aud: [aud], iss: ISSUER, exp: now + 600, email }))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(head));
  return `${head}.${b64url(new Uint8Array(signature))}`;
}

const verifier = "a-client-generated-verifier-with-enough-entropy-1234567890";
const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
const query = { source: "mac", redirect_uri: REDIRECT, state: "st-1", code_challenge: challenge, code_challenge_method: "S256" };

async function authorizePage(email = "owner@example.com", params: Record<string, string> = query): Promise<Response> {
  return handleAuthorize(new Request(`${ORIGIN}/pair/authorize?${new URLSearchParams(params)}`, {
    headers: { "Cf-Access-Jwt-Assertion": await jwt(email) },
  }), env);
}

async function submit(fields: Record<string, string>, origin: string | null = ORIGIN, fetchSite?: string): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": await jwt("owner@example.com"), "Content-Type": "application/x-www-form-urlencoded" };
  if (origin !== null) headers.Origin = origin;
  if (fetchSite) headers["Sec-Fetch-Site"] = fetchSite;
  return handleAuthorize(new Request(`${ORIGIN}/pair/authorize`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  }), env);
}

async function formFields(): Promise<Record<string, string>> {
  const html = await (await authorizePage()).text();
  return Object.fromEntries([...html.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))]));
}

function exchange(code: string, codeVerifier = verifier): Promise<Response> {
  return handleExchange(new Request(`${ORIGIN}/api/pair/token`, { method: "POST", body: JSON.stringify({ code, codeVerifier }) }), env);
}

test("the authorize page requires an allowed Access identity and exact parameters", async () => {
  assert.equal((await handleAuthorize(new Request(`${ORIGIN}/pair/authorize?${new URLSearchParams(query)}`), env)).status, 401);
  assert.equal((await authorizePage("stranger@example.com")).status, 401);
  assert.equal((await authorizePage(undefined, { ...query, redirect_uri: "evil://pair" })).status, 400);
  assert.equal((await authorizePage(undefined, { ...query, source: "server" })).status, 400);
  assert.equal((await authorizePage(undefined, { ...query, code_challenge: "short" })).status, 400);
  const ok = await authorizePage();
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-security-policy") ?? "", /form-action 'self' mactelemetryhub:/);
  assert.match(await ok.text(), /Allow Mac Telemetry Hub to report\?/);
});

test("allow redirects a code to the app; deny, cross-site and tampered forms do not", async () => {
  const fields = await formFields();
  const allowed = await submit({ ...fields, decision: "allow" });
  assert.equal(allowed.status, 302);
  const location = new URL(allowed.headers.get("location")!);
  assert.equal(`${location.protocol}//${location.host}`, REDIRECT);
  assert.equal(location.searchParams.get("state"), "st-1");
  assert.ok(location.searchParams.get("code"));

  const denied = new URL((await submit({ ...fields, decision: "deny" })).headers.get("location")!);
  assert.equal(denied.searchParams.get("error"), "access_denied");
  assert.equal(denied.searchParams.get("code"), null);

  assert.equal((await submit({ ...fields, decision: "allow" }, "https://evil.example")).status, 403);
  // Origin 发成 null 时看 Sec-Fetch-Site
  assert.equal((await submit({ ...fields, decision: "allow" }, "null", "same-origin")).status, 302);
  assert.equal((await submit({ ...fields, decision: "allow" }, "null", "cross-site")).status, 403);
  assert.equal((await submit({ ...fields, decision: "allow" }, null)).status, 403);
  assert.equal((await submit({ ...fields, state: "other", decision: "allow" })).status, 400);
  assert.equal((await submit({ ...fields, form_token: "1.AAAA", decision: "allow" })).status, 400);
});

test("exchange rotates only after the code and verifier check out", async () => {
  const rotated: string[] = [];
  setRotateForTests(async (_env, tokenId) => { rotated.push(tokenId); return "cfast_new"; });
  const fields = await formFields();
  const code = new URL((await submit({ ...fields, decision: "allow" })).headers.get("location")!).searchParams.get("code")!;

  assert.equal((await exchange(code, "wrong-verifier")).status, 400);
  assert.equal((await exchange(code.slice(0, -2) + "AA")).status, 400);
  const expired = await sealCode(env, { s: "mac", c: challenge, e: Date.now() - 1 });
  assert.equal((await exchange(expired)).status, 400);
  assert.deepEqual(rotated, []);

  const response = await exchange(code);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: { source: "mac", clientId: "mac.access", clientSecret: "cfast_new", ingestUrl: "https://ingest.homepage.lyjw.llc/api/ingest/mac" },
  });
  assert.deepEqual(rotated, ["token-mac"]);
});

test("a failed rotation is reported without leaking details", async () => {
  setRotateForTests(async () => { throw new Error("upstream said no"); });
  const fields = await formFields();
  const code = new URL((await submit({ ...fields, decision: "allow" })).headers.get("location")!).searchParams.get("code")!;
  const response = await exchange(code);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /upstream said no/);
});
