import assert from "node:assert/strict";
import test from "node:test";
import { ACTIONS_OIDC_ISSUER, ACTIONS_OIDC_JWKS_URL, ActionsOidcUnavailableError, BUILD_WORKFLOW_REF, verifyActionsToken } from "./build/actions-oidc.ts";
import { actionsClaims, createActionsOidcFixture } from "./build/testing/actions-oidc.ts";
import { base64url, hmacKey } from "./crypto.ts";

const audience = "https://api.homepage.lyjw.llc";
const now = Date.UTC(2026, 9, 12, 12);
const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

test("the trusted identity is GitHub's Actions issuer and the build workflow on main", () => {
  assert.equal(ACTIONS_OIDC_ISSUER, "https://token.actions.githubusercontent.com");
  assert.equal(ACTIONS_OIDC_JWKS_URL, "https://token.actions.githubusercontent.com/.well-known/jwks");
  assert.equal(BUILD_WORKFLOW_REF, "LYJW131/lyjwpage/.github/workflows/build.yml@refs/heads/main");
});

test("a build workflow token for the run's callback origin is accepted, also as one of several audiences", async () => {
  const oidc = await createActionsOidcFixture();
  const fetcher = oidc.serve();
  assert.equal((await verifyActionsToken(await oidc.token(audience, {}, now), audience, fetcher, now))?.run_id, "1");
  assert.ok(await verifyActionsToken(await oidc.token(audience, { aud: ["https://other.example", audience] }, now), audience, fetcher, now));
  assert.ok(await verifyActionsToken(await oidc.token(audience, { nbf: undefined }, now), audience, fetcher, now));
  assert.equal(oidc.jwksRequests, 1);
});

const nowS = Math.floor(now / 1000);
const rejectedClaims: [string, Record<string, unknown>][] = [
  ["another audience", { aud: "https://api.homepage.lyjw.llc.evil.test" }],
  ["an audience list without the run's origin", { aud: ["https://other.example"] }],
  ["another issuer", { iss: "https://token.actions.githubusercontent.com.evil.test" }],
  ["another repository", { repository: "someone/lyjwpage" }],
  ["the repository name reused by another repository", { repository_id: "1" }],
  ["the owner name reused by another account", { repository_owner_id: "1" }],
  ["a missing repository id", { repository_id: undefined }],
  ["another workflow", { workflow_ref: "LYJW131/lyjwpage/.github/workflows/ci.yml@refs/heads/main" }],
  ["the workflow from a branch", { workflow_ref: "LYJW131/lyjwpage/.github/workflows/build.yml@refs/heads/claude/build-x" }],
  ["a reusable workflow called from elsewhere", { job_workflow_ref: "someone/tools/.github/workflows/build.yml@refs/heads/main" }],
  ["another event", { event_name: "workflow_dispatch" }],
  ["a pull request event", { event_name: "pull_request_target" }],
  ["another ref", { ref: "refs/heads/claude/build-x" }],
  ["a self-hosted runner", { runner_environment: "self-hosted" }],
  ["a missing runner environment", { runner_environment: undefined }],
  ["an expired token", { iat: nowS - 400, exp: nowS - 1 }],
  ["an iat in the future", { iat: nowS + 61, exp: nowS + 361 }],
  ["an nbf in the future", { nbf: nowS + 61 }],
  ["a lifetime above an hour", { iat: nowS - 10, exp: nowS - 10 + 3601 }],
  ["a non-numeric expiry", { exp: String(nowS + 300) }],
  ["a missing iat", { iat: undefined }],
];
for (const [name, patch] of rejectedClaims) {
  test(`a token with ${name} is rejected`, async () => {
    const oidc = await createActionsOidcFixture();
    assert.equal(await verifyActionsToken(await oidc.token(audience, patch, now), audience, oidc.serve(), now), null);
  });
}

test("forged signatures, other algorithms and malformed tokens are rejected", async () => {
  const oidc = await createActionsOidcFixture();
  const fetcher = oidc.serve();
  const valid = await oidc.token(audience, {}, now);
  const [header, body, signature] = valid.split(".");
  const tampered = `${header}.${encode({ ...actionsClaims(audience, now), run_id: "2" })}.${signature}`;
  const other = await createActionsOidcFixture();
  const otherKey = await other.token(audience, {}, now);
  const hmacBody = `${encode({ alg: "HS256", typ: "JWT", kid: oidc.kid })}.${body}`;
  const hmac = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(audience), new TextEncoder().encode(hmacBody))));
  for (const token of [
    tampered,
    otherKey,
    `${header}.${body}.${signature.slice(0, -4)}AAAA`,
    `${encode({ alg: "none", typ: "JWT", kid: oidc.kid })}.${body}.`,
    `${encode({ alg: "none", typ: "JWT", kid: oidc.kid })}.${body}.${signature}`,
    await oidc.sign(actionsClaims(audience, now), { alg: "none" }),
    await oidc.sign(actionsClaims(audience, now), { alg: "RS512" }),
    `${hmacBody}.${hmac}`,
    await oidc.sign(actionsClaims(audience, now), { kid: undefined }),
    await oidc.sign(actionsClaims(audience, now), { crit: ["exp"] }),
    await oidc.sign({ ...actionsClaims(audience, now), padding: "x".repeat(8192) }),
    `${header}.${body}`,
    `${header}.${body}.${signature}.extra`,
    `${header}.${body}.${signature}=`,
    "f".repeat(64),
  ]) assert.equal(await verifyActionsToken(token, audience, fetcher, now), null);
  assert.equal(await verifyActionsToken(valid, "", fetcher, now), null);
  assert.ok(await verifyActionsToken(valid, audience, fetcher, now));
});

test("an unknown kid refetches the key set at most once a minute and is rejected when still unknown", async () => {
  const oidc = await createActionsOidcFixture();
  const fetcher = oidc.serve();
  assert.ok(await verifyActionsToken(await oidc.token(audience, {}, now), audience, fetcher, now));
  const unknown = await oidc.sign(actionsClaims(audience, now + 1000), { kid: "unknown" });
  assert.equal(await verifyActionsToken(unknown, audience, fetcher, now + 1000), null);
  assert.equal(oidc.jwksRequests, 1);
  const later = now + 61_000;
  const stillUnknown = await oidc.sign(actionsClaims(audience, later), { kid: "unknown" });
  assert.equal(await verifyActionsToken(stillUnknown, audience, fetcher, later), null);
  assert.equal(oidc.jwksRequests, 2);
  assert.equal(await verifyActionsToken(stillUnknown, audience, fetcher, later + 1000), null);
  assert.equal(oidc.jwksRequests, 2);
});

test("a rotated signing key is picked up by refetching, and a removed key stops verifying", async () => {
  const oidc = await createActionsOidcFixture();
  const fetcher = oidc.serve();
  const before = await oidc.token(audience, {}, now);
  assert.ok(await verifyActionsToken(before, audience, fetcher, now));
  await oidc.rotate();
  const rotatedAt = now + 61_000;
  assert.ok(await verifyActionsToken(await oidc.token(audience, {}, rotatedAt), audience, fetcher, rotatedAt));
  assert.equal(oidc.jwksRequests, 2);
  assert.equal(await verifyActionsToken(before, audience, fetcher, now + 62_000), null);
});

test("cached keys refresh after an hour and each fetcher keeps its own cache", async () => {
  const oidc = await createActionsOidcFixture();
  const fetcher = oidc.serve();
  for (const at of [now, now + 59 * 60_000]) assert.ok(await verifyActionsToken(await oidc.token(audience, {}, at), audience, fetcher, at));
  assert.equal(oidc.jwksRequests, 1);
  const hourLater = now + 60 * 60_000;
  assert.ok(await verifyActionsToken(await oidc.token(audience, {}, hourLater), audience, fetcher, hourLater));
  assert.equal(oidc.jwksRequests, 2);
  assert.ok(await verifyActionsToken(await oidc.token(audience, {}, hourLater), audience, oidc.serve(), hourLater));
  assert.equal(oidc.jwksRequests, 3);
});

test("concurrent first verifications share one key set request", async () => {
  const oidc = await createActionsOidcFixture();
  const fetcher = oidc.serve();
  const token = await oidc.token(audience, {}, now);
  const results = await Promise.all(Array.from({ length: 8 }, () => verifyActionsToken(token, audience, fetcher, now)));
  assert.ok(results.every(Boolean));
  assert.equal(oidc.jwksRequests, 1);
});

test("a refresh abandoned by its request never blocks later verifications", async () => {
  const oidc = await createActionsOidcFixture();
  const serve = oidc.serve();
  let hanging = false;
  let cancel: ((reason: unknown) => void) | undefined;
  const fetcher: typeof fetch = (input, init) => hanging ? new Promise((_, reject) => { cancel = reject; }) : serve(input, init);
  assert.ok(await verifyActionsToken(await oidc.token(audience, {}, now), audience, fetcher, now));
  hanging = true;
  const hourLater = now + 60 * 60_000;
  const abandoned = verifyActionsToken(await oidc.token(audience, {}, hourLater), audience, fetcher, hourLater);
  assert.ok(await verifyActionsToken(await oidc.token(audience, {}, hourLater + 1000), audience, fetcher, hourLater + 1000), "a cached key does not wait for another request's refresh");
  hanging = false;
  await oidc.rotate(true);
  const replaced = hourLater + 61_000;
  assert.ok(await verifyActionsToken(await oidc.token(audience, {}, replaced), audience, fetcher, replaced), "a refresh pending past the fetch timeout is replaced");
  assert.equal(oidc.jwksRequests, 2);
  cancel?.(new Error("cancelled"));
  assert.ok(await abandoned);
});

test("an unavailable key set is reported separately from an invalid token and recovers on the next call", async () => {
  const oidc = await createActionsOidcFixture();
  const fetcher = oidc.serve();
  const token = await oidc.token(audience, {}, now);
  oidc.jwksStatus = 503;
  await assert.rejects(() => verifyActionsToken(token, audience, fetcher, now), ActionsOidcUnavailableError);
  await assert.rejects(() => verifyActionsToken(token, audience, async () => { throw new TypeError("network down"); }, now), ActionsOidcUnavailableError);
  assert.equal(await verifyActionsToken(await oidc.token("https://other.example", {}, now), audience, fetcher, now), null, "claims are checked before any key request");
  assert.equal(oidc.jwksRequests, 1);
  oidc.jwksStatus = 200;
  await assert.rejects(() => verifyActionsToken(token, audience, fetcher, now + 1000), ActionsOidcUnavailableError);
  assert.equal(oidc.jwksRequests, 1, "a failed fetch is retried at most once a minute");
  assert.ok(await verifyActionsToken(token, audience, fetcher, now + 61_000));
  assert.equal(oidc.jwksRequests, 2);
});

test("a failed hourly refresh keeps verifying with the cached keys and retries at most once a minute", async () => {
  const oidc = await createActionsOidcFixture();
  const fetcher = oidc.serve();
  assert.ok(await verifyActionsToken(await oidc.token(audience, {}, now), audience, fetcher, now));
  oidc.jwksStatus = 503;
  const hourLater = now + 60 * 60_000;
  for (const at of [hourLater, hourLater + 1000, hourLater + 59_000]) assert.ok(await verifyActionsToken(await oidc.token(audience, {}, at), audience, fetcher, at));
  assert.equal(oidc.jwksRequests, 2);
  const unknown = await oidc.sign(actionsClaims(audience, hourLater + 2000), { kid: "unknown" });
  assert.equal(await verifyActionsToken(unknown, audience, fetcher, hourLater + 2000), null);
  assert.equal(oidc.jwksRequests, 2);
  await assert.rejects(() => verifyActionsToken(unknown, audience, fetcher, hourLater + 61_000), ActionsOidcUnavailableError);
  assert.equal(oidc.jwksRequests, 3);
  oidc.jwksStatus = 200;
  const recovered = hourLater + 122_000;
  assert.ok(await verifyActionsToken(await oidc.token(audience, {}, recovered), audience, fetcher, recovered));
  assert.equal(oidc.jwksRequests, 4);
  assert.ok(await verifyActionsToken(await oidc.token(audience, {}, recovered + 61_000), audience, fetcher, recovered + 61_000));
  assert.equal(oidc.jwksRequests, 4, "a successful refresh restarts the hourly cache");
});

test("key set entries other than RS256 signing keys are ignored", async () => {
  const oidc = await createActionsOidcFixture();
  const token = await oidc.token(audience, {}, now);
  const { keys: [key] } = await (await oidc.serve()(ACTIONS_OIDC_JWKS_URL)).json() as { keys: Record<string, unknown>[] };
  const unusable = async () => Response.json({ keys: [{ ...key, alg: "RS512" }, { ...key, use: "enc" }, { ...key, kty: "EC" }, { ...key, n: 1 }] });
  await assert.rejects(() => verifyActionsToken(token, audience, unusable, now), ActionsOidcUnavailableError);
  const mixed = async () => Response.json({ keys: [{ ...key, kid: "other", alg: "RS512" }, "not a key", key] });
  assert.ok(await verifyActionsToken(token, audience, mixed, now));
});
