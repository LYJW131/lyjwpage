#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const DEV_ISSUER = 'https://access.local.invalid';
export const DEV_AUD = 'local-dev';
export const DEV_CLIENT_ID = 'local-dev.access';
const INGEST_SOURCES = ['mac', 'iphone', 'homepod', 'emby', 'playstation', 'server', 'agents'];
const DEV_PERMISSIONS = [...INGEST_SOURCES.map((source) => `ingest:${source}`), 'ingest:agents-otlp', 'internal:site-deployed'];
const KEY_FILE = resolve(import.meta.dirname, '../workers/ingress/.dev.vars.access-key.json');
const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

const b64url = (data) => Buffer.from(data).toString('base64url');

async function fromPrivateJwk(privateJwk) {
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, ALGORITHM, false, ['sign']);
  const { kty, n, e } = privateJwk;
  const jwks = JSON.stringify({ keys: [{ kty, n, e, kid: 'local-dev' }] });
  return {
    privateJwk,
    // ACCESS_CLIENTS 是对象，只能放进 Wrangler 配置，不能写入 .dev.vars。
    vars: { ACCESS_TEAM_DOMAIN: DEV_ISSUER, ACCESS_AUD: DEV_AUD, ACCESS_CLIENTS: { [DEV_CLIENT_ID]: DEV_PERMISSIONS }, ACCESS_DEV_JWKS: jwks },
    async headers(clientId = DEV_CLIENT_ID) {
      const now = Math.floor(Date.now() / 1000);
      const head = `${b64url(JSON.stringify({ alg: 'RS256', kid: 'local-dev' }))}.${b64url(JSON.stringify({
        aud: [DEV_AUD], iss: DEV_ISSUER, iat: now, exp: now + 600, common_name: clientId, type: 'app',
      }))}`;
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(head));
      return { 'Cf-Access-Jwt-Assertion': `${head}.${b64url(new Uint8Array(signature))}` };
    },
  };
}

export async function createDevAccess() {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  return fromPrivateJwk(await crypto.subtle.exportKey('jwk', pair.privateKey));
}

export async function devAccessFromEnv() {
  const raw = process.env.LOCAL_ACCESS_PRIVATE_JWK;
  return raw ? fromPrivateJwk(JSON.parse(raw)) : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  if (command === 'init') {
    const access = await createDevAccess();
    await writeFile(KEY_FILE, JSON.stringify(access.privateJwk), { mode: 0o600 });
    console.log(`钥匙写在 ${KEY_FILE}。把下面这行加进 workers/ingress/.dev.vars：\n`);
    console.log(`ACCESS_DEV_JWKS=${access.vars.ACCESS_DEV_JWKS}`);
  } else if (command === 'header') {
    const access = await fromPrivateJwk(JSON.parse(await readFile(KEY_FILE, 'utf8')));
    const [[name, value]] = Object.entries(await access.headers());
    console.log(`${name}: ${value}`);
  } else {
    console.error('用法：node scripts/dev-access.mjs init | header');
    process.exit(1);
  }
}
