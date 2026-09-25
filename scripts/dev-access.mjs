#!/usr/bin/env node
/**
 * 本地没有 Cloudflare Access，上报要带的 `Cf-Access-Jwt-Assertion` 由这里用一把测试钥匙自己签。
 * 本地 Worker 在 `ACCESS_TEAM_DOMAIN` 为 DEV_ISSUER 时认 `ACCESS_DEV_JWKS` 里的公钥
 * （见 workers/api/src/access-auth.ts）；线上的 team 域名是真的，这把钥匙在那边一文不值。
 *
 * 命令行：
 *   node scripts/dev-access.mjs init    生成钥匙（workers/api/.dev.vars.access-key.json，已被 gitignore），
 *                                       打印要加进 workers/api/.dev.vars 的 ACCESS_DEV_JWKS 那一行
 *   node scripts/dev-access.mjs header  打印一个 10 分钟有效的请求头，curl -H 直接用
 *
 * 隔离验证脚本直接 import createDevAccess()：每次现生成一对钥匙，vars 交给 Worker，headers() 签请求。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const DEV_ISSUER = 'https://access.local.invalid';
export const DEV_AUD = 'local-dev';
export const DEV_CLIENT_ID = 'local-dev.access';
const INGEST_SOURCES = ['mac', 'iphone', 'homepod', 'emby', 'playstation', 'server', 'agents'];
const DEV_PERMISSIONS = [...INGEST_SOURCES.map((source) => `ingest:${source}`), 'internal:site-deployed'];
const KEY_FILE = resolve(import.meta.dirname, '../workers/api/.dev.vars.access-key.json');
const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

const b64url = (data) => Buffer.from(data).toString('base64url');

async function fromPrivateJwk(privateJwk) {
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, ALGORITHM, false, ['sign']);
  const { kty, n, e } = privateJwk;
  const jwks = JSON.stringify({ keys: [{ kty, n, e, kid: 'local-dev' }] });
  return {
    privateJwk,
    /** 交给本地 Worker 的变量；ACCESS_CLIENTS 是对象，只能放进 wrangler 配置，不能进 .dev.vars。 */
    vars: { ACCESS_TEAM_DOMAIN: DEV_ISSUER, ACCESS_AUD: DEV_AUD, ACCESS_CLIENTS: { [DEV_CLIENT_ID]: DEV_PERMISSIONS }, ACCESS_DEV_JWKS: jwks },
    /** 签一张和 Access 放行时同形的 JWT；clientId 不在 ACCESS_CLIENTS 里就会被当成越权。 */
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

/** 子进程里复用父进程那把钥匙：父进程把 privateJwk 经环境变量 LOCAL_ACCESS_PRIVATE_JWK 传下来。 */
export async function devAccessFromEnv() {
  const raw = process.env.LOCAL_ACCESS_PRIVATE_JWK;
  return raw ? fromPrivateJwk(JSON.parse(raw)) : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  if (command === 'init') {
    const access = await createDevAccess();
    await writeFile(KEY_FILE, JSON.stringify(access.privateJwk), { mode: 0o600 });
    console.log(`钥匙写在 ${KEY_FILE}。把下面这行加进 workers/api/.dev.vars：\n`);
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
