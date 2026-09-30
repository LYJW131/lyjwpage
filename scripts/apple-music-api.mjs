#!/usr/bin/env node
/**
 * 用生产凭据直接问 Apple Music API，排查「最近在听」和 Pulse 痕迹时看上游原样返回什么。
 * 凭据只落本机文件（0600），任何输出都不带令牌；要改这点先想清楚 agent 会把 stdout 整段收进上下文。
 *
 * 命令行：
 *   node scripts/apple-music-api.mjs refresh     重取凭据写进缓存文件，只打印到期时刻与文件路径
 *   node scripts/apple-music-api.mjs <路径>       例 "/v1/me/recent/played/tracks?types=songs,library-songs&limit=10"，
 *                                                打印 Apple 的 JSON；缓存缺失或快到期就先 refresh，401/403 重取一次再试
 *
 * 凭据两半来源不同：
 *   - developer token：api Worker 公开的 `/api/musickit/token`（访客跟听用的那种，签了 origin，
 *     所以请求 Apple 时要带同一个 Origin 头）。私钥只在 api 上，这里签不了。
 *   - music user token：凭据 KV 里 Mac 上报的那份，经 Cloudflare API 读。需要环境变量
 *     `CLOUDFLARE_API_TOKEN`（Workers KV Storage 读权限即可）；`CLOUDFLARE_ACCOUNT_ID` 可选，
 *     不给就取这把令牌能看到的唯一账号。
 *
 * 缓存文件默认 `~/.cache/lyjwpage/apple-music.json`，`APPLE_MUSIC_CREDENTIALS_FILE` 可改。
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

const API_ORIGIN = 'https://api.homepage.lyjw.llc';
/** developer token 的 origin 声明里要有它，见 workers/api/wrangler.toml 的 ALLOWED_ORIGINS */
const SITE_ORIGIN = 'https://lyjw.me';
/** 源：shared/credentials.ts#CREDENTIAL_KEYS */
const USER_TOKEN_KEY = 'apple-music:v1';
/** developer token 离到期不足这么久就重取 */
const RENEW_BEFORE_MS = 5 * 60 * 1000;
const CACHE_FILE = process.env.APPLE_MUSIC_CREDENTIALS_FILE ?? resolve(homedir(), '.cache/lyjwpage/apple-music.json');

/** 凭据 KV 的 namespace id 以采集 Worker 的绑定为准，不另抄一份 */
async function credentialsNamespaceId() {
  const toml = await readFile(resolve(import.meta.dirname, '../workers/collector/wrangler.toml'), 'utf8');
  const id = toml.match(/binding\s*=\s*"CREDENTIALS"\s*\n\s*id\s*=\s*"([0-9a-f]+)"/)?.[1];
  if (!id) throw new Error('workers/collector/wrangler.toml 里找不到 CREDENTIALS 绑定的 id');
  return id;
}

async function cloudflare(path) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('缺环境变量 CLOUDFLARE_API_TOKEN（Workers KV Storage 读权限）');
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Cloudflare API ${path.split('/values/')[0]} → HTTP ${response.status}`);
  return response;
}

async function accountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  const { result } = await (await cloudflare('/accounts')).json();
  if (result?.length !== 1) throw new Error(`这把令牌看得到 ${result?.length ?? 0} 个账号，设 CLOUDFLARE_ACCOUNT_ID 指定一个`);
  return result[0].id;
}

async function refresh() {
  const [developer, stored] = await Promise.all([
    fetch(`${API_ORIGIN}/api/musickit/token`, { headers: { Origin: SITE_ORIGIN } }).then(async (response) => {
      if (!response.ok) throw new Error(`/api/musickit/token → HTTP ${response.status}`);
      return response.json();
    }),
    Promise.all([accountId(), credentialsNamespaceId()]).then(async ([account, namespace]) =>
      (await cloudflare(`/accounts/${account}/storage/kv/namespaces/${namespace}/values/${encodeURIComponent(USER_TOKEN_KEY)}`)).json()),
  ]);
  if (typeof developer?.token !== 'string' || typeof stored?.musicUserToken !== 'string') throw new Error('凭据形状不对：developer token 或 musicUserToken 缺失');
  const cache = {
    developerToken: developer.token,
    developerExpiresAt: developer.expiresAt * 1000,
    musicUserToken: stored.musicUserToken,
    userTokenReceivedAt: stored.receivedAt ?? null,
  };
  await mkdir(dirname(CACHE_FILE), { recursive: true, mode: 0o700 });
  await writeFile(CACHE_FILE, JSON.stringify(cache), { mode: 0o600 });
  await chmod(CACHE_FILE, 0o600);
  return cache;
}

async function cached() {
  try {
    const cache = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
    if (cache.developerExpiresAt - Date.now() > RENEW_BEFORE_MS) return cache;
  } catch {
    // 没有或坏了都重取
  }
  return refresh();
}

function apple(path, cache) {
  return fetch(`https://api.music.apple.com${path}`, {
    headers: { Authorization: `Bearer ${cache.developerToken}`, 'Music-User-Token': cache.musicUserToken, Origin: SITE_ORIGIN },
  });
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

const [arg] = process.argv.slice(2);
if (!arg) {
  console.error('用法见文件头：node scripts/apple-music-api.mjs refresh | <路径>');
  process.exit(2);
}
try {
  if (arg === 'refresh') {
    const cache = await refresh();
    console.log(JSON.stringify({ file: CACHE_FILE, developerExpiresAt: iso(cache.developerExpiresAt), userTokenReceivedAt: iso(cache.userTokenReceivedAt) }));
  } else {
    if (!arg.startsWith('/v1/')) throw new Error('路径要以 /v1/ 开头');
    let response = await apple(arg, await cached());
    if (response.status === 401 || response.status === 403) response = await apple(arg, await refresh());
    const body = await response.text();
    if (!response.ok) console.error(`Apple → HTTP ${response.status}`);
    console.log(body);
    if (!response.ok) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
