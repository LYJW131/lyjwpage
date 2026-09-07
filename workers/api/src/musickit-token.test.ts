import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  ConfigError,
  type IssuedToken,
  issueMusicKitToken,
  pastHalfLife,
  resolveTtlSeconds,
  signedOrigins,
} from "@api/musickit-token";

const PRODUCTION = "https://lyjw.me,https://lyjw131.com,https://*.vercel.app";
const LITERAL = ["https://lyjw.me", "https://lyjw131.com"];

/** 一次性生成的 P-256 钥匙对：私钥按 .p8 的样子（PKCS#8 PEM）喂给签发，公钥用来验签 */
async function generateKeyPair(): Promise<{ pem: string; publicKey: CryptoKey }> {
  // workers-types 把 generateKey 的返回写成 CryptoKey | CryptoKeyPair，按算法收窄一下
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const base64 = Buffer.from(pkcs8).toString("base64").replace(/(.{64})/g, "$1\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

function base64UrlDecode(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
}

function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Uint8Array } {
  const [header, payload, signature] = token.split(".");
  assert.ok(header && payload && signature, "JWT 应有三段");
  return {
    header: JSON.parse(Buffer.from(base64UrlDecode(header)).toString()),
    payload: JSON.parse(Buffer.from(base64UrlDecode(payload)).toString()),
    signingInput: `${header}.${payload}`,
    signature: base64UrlDecode(signature),
  };
}

test("signedOrigins：写死的来源签整份名单，通配匹配和 localhost 只签自己", () => {
  const allowed = PRODUCTION.split(",");
  assert.deepEqual(signedOrigins("https://lyjw.me", allowed), LITERAL);
  assert.deepEqual(signedOrigins("https://lyjwpage-abc123.vercel.app", allowed), ["https://lyjwpage-abc123.vercel.app"]);
  // 不把生产域名捎给 localhost：它无条件放行，带上就等于把兜底那道也交出去
  assert.deepEqual(signedOrigins("http://localhost:3211", allowed), ["http://localhost:3211"]);
  assert.deepEqual(signedOrigins(null, allowed), LITERAL);
  assert.deepEqual(signedOrigins("https://lyjw.me", []), []);
});

test("resolveTtlSeconds：缺省 7 天，封顶半年，非法值回缺省", () => {
  assert.equal(resolveTtlSeconds({}), DEFAULT_TTL_SECONDS);
  assert.equal(resolveTtlSeconds({ MUSICKIT_TOKEN_TTL_SECONDS: "3600" }), 3600);
  assert.equal(resolveTtlSeconds({ MUSICKIT_TOKEN_TTL_SECONDS: "99999999" }), MAX_TTL_SECONDS);
  assert.equal(resolveTtlSeconds({ MUSICKIT_TOKEN_TTL_SECONDS: "-1" }), DEFAULT_TTL_SECONDS);
  assert.equal(resolveTtlSeconds({ MUSICKIT_TOKEN_TTL_SECONDS: "abc" }), DEFAULT_TTL_SECONDS);
});

test("pastHalfLife：中点之前不续，到中点就续", () => {
  const token: IssuedToken = { token: "", issuedAt: 1000, expiresAt: 1000 + 200 };
  assert.equal(pastHalfLife(token, 1099), false);
  assert.equal(pastHalfLife(token, 1100), true);
});

test("issueMusicKitToken：签出可验的 ES256 JWT，声明按来源分开缓存，过半衰期重签", async () => {
  const { pem, publicKey } = await generateKeyPair();
  const env = {
    APPLE_MUSIC_PRIVATE_KEY: pem,
    APPLE_MUSIC_TEAM_ID: "TEAM000000",
    APPLE_MUSIC_KEY_ID: "KEY0000000",
    ALLOWED_ORIGINS: PRODUCTION,
    MUSICKIT_TOKEN_TTL_SECONDS: "3600",
  };
  const cache = new Map<string, IssuedToken>();

  const issued = await issueMusicKitToken("https://lyjw.me", env, { now: 1_700_000_000, cache });
  assert.equal(issued.issuedAt, 1_700_000_000);
  assert.equal(issued.expiresAt, 1_700_003_600);

  const { header, payload, signingInput, signature } = decodeJwt(issued.token);
  assert.deepEqual(header, { alg: "ES256", kid: "KEY0000000" });
  assert.deepEqual(payload, { iss: "TEAM000000", iat: 1_700_000_000, exp: 1_700_003_600, origin: LITERAL });
  // r‖s 定长拼接（P-256 是 64 字节），不是 DER；混了 Apple 只会说「签名不对」
  assert.equal(signature.byteLength, 64);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, new TextEncoder().encode(signingInput)));

  // 同一份声明、半衰期内：复用；另一份来源：另签一份，声明只有它自己
  assert.equal(await issueMusicKitToken("https://lyjw131.com", env, { now: 1_700_001_000, cache }), issued);
  const preview = await issueMusicKitToken("https://lyjwpage-x.vercel.app", env, { now: 1_700_001_000, cache });
  assert.notEqual(preview.token, issued.token);
  assert.deepEqual(decodeJwt(preview.token).payload.origin, ["https://lyjwpage-x.vercel.app"]);
  assert.equal(cache.size, 2);

  // 过了中点（1800 秒）就换新
  const renewed = await issueMusicKitToken("https://lyjw.me", env, { now: 1_700_001_800, cache });
  assert.notEqual(renewed, issued);
  assert.equal(renewed.issuedAt, 1_700_001_800);
});

test("issueMusicKitToken：没配名单时不带 origin 声明；缺变量抛可外带的 ConfigError", async () => {
  const { pem } = await generateKeyPair();
  const base = { APPLE_MUSIC_PRIVATE_KEY: pem, APPLE_MUSIC_TEAM_ID: "TEAM000000", APPLE_MUSIC_KEY_ID: "KEY0000000" };

  const open = await issueMusicKitToken("http://localhost:3211", base, { cache: new Map() });
  assert.equal("origin" in decodeJwt(open.token).payload, false);

  await assert.rejects(
    issueMusicKitToken("https://lyjw.me", { ...base, APPLE_MUSIC_TEAM_ID: "" }, { cache: new Map() }),
    (error: unknown) => error instanceof ConfigError && error.hint === "没有配置 APPLE_MUSIC_TEAM_ID",
  );
  await assert.rejects(
    issueMusicKitToken("https://lyjw.me", { ...base, APPLE_MUSIC_KEY_ID: undefined }, { cache: new Map() }),
    (error: unknown) => error instanceof ConfigError && error.hint === "没有配置 APPLE_MUSIC_KEY_ID",
  );
});
