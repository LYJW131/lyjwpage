#!/usr/bin/env node
/** Isolated Worker → Durable Objects SQLite → Next cache + WebSocket verification. Requires Node 24 and pnpm build. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'workers/api/package.json'));
const temporary = await mkdtemp(join(tmpdir(), 'lyjw-ingest-'));
const children = [];
const logs = [];
let socket;
const secret = 'local-token-usage-verification';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}
function start(command, args, env = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, WRANGLER_LOG_PATH: join(temporary, 'wrangler.log'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => logs.push(data.toString()));
  return child;
}
async function eventually(check) {
  const deadline = Date.now() + 45_000;
  let failure;
  do {
    try { return await check(); } catch (error) { failure = error; }
    await sleep(100);
  } while (Date.now() < deadline);
  throw failure;
}
try {
  const [workerPort, sitePort] = await Promise.all([port(), port()]);
  const worker = `http://127.0.0.1:${workerPort}`;
  const site = `http://127.0.0.1:${sitePort}`;
  // 一次性 P-256 钥匙对：私钥按 .p8 的样子喂给 Worker 签 MusicKit 令牌，公钥留在这里验签
  const musicKitKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const musicKitPem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', musicKitKeys.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----`;
  const vars = {
    NEXT_PUBLIC_BACKEND_URL: worker, STORAGE_PREFIX: 'isolated-verify', TELEMETRY_INGEST_SECRET: secret, STATE_IMPORT_SECRET: `${secret}-import`,
    SITE_URL: site, ALLOWED_ORIGINS: '',
    R2_PUBLIC_BASE_URL: '', EMBY_PUBLIC_URL: '',
    APPLE_MUSIC_PRIVATE_KEY: musicKitPem, APPLE_MUSIC_TEAM_ID: 'ISOLATEDTM', APPLE_MUSIC_KEY_ID: 'ISOLATEDKY',
  };
  // Config lives outside the checkout so Wrangler cannot load real .dev.vars or production bindings.
  const config = {
    name: 'isolated-ingest', main: join(root, 'workers/api/src/index.ts'),
    compatibility_date: '2025-02-14', compatibility_flags: ['nodejs_compat', 'nodejs_compat_populate_process_env'],
    vars,
    alias: Object.fromEntries(['storage-driver'].map(name => [`@/lib/${name}`, join(root, `workers/api/src/${name}.ts`)])),
    durable_objects: { bindings: [
      { name: 'LIVE_PUSH', class_name: 'LivePushRoom' },
      { name: 'STATE', class_name: 'StateHub' },
    ] },
    migrations: [
      { tag: 'v1', new_sqlite_classes: ['LivePushRoom'] },
      { tag: 'v3', new_sqlite_classes: ['StateHub'] },
    ],
    r2_buckets: [{ binding: 'IMAGES', bucket_name: 'isolated-images' }],
  };
  const configPath = join(temporary, 'wrangler.json');
  await writeFile(configPath, JSON.stringify(config));
  const workerChild = start(process.execPath, [require.resolve('wrangler'), 'dev', '--config', configPath, '--port', String(workerPort), '--test-scheduled', '--persist-to', join(temporary, 'state')]);
  const notices = [];
  const mockSite = httpServer((request, response) => {
    let body = ''; request.on('data', chunk => body += chunk);
    request.on('end', () => { notices.push(JSON.parse(body)); response.setHeader('content-type', 'application/json'); response.end('{"ok":true}'); });
  });
  mockSite.listen(sitePort, '127.0.0.1');
  children.push({ kill: () => mockSite.close(), exitCode: 0 });
  await eventually(async () => assert.equal((await fetch(`${worker}/count`)).status, 200));
  assert.deepEqual(await (await fetch(`${worker}/count`)).json(), { ok: true, connections: 0 });
  assert.equal((await post(worker, '/api/ingest/homepod', {})).status, 503);
  assert.equal((await post(worker, '/api/internal/storage/import', { entries: [], finalize: true }, `${secret}-import`)).status, 200);
  assert.equal((await fetch(`${worker}/online/ws`)).status, 404);
  console.log('PASS: API count only reports live-push connections; online route removed');
  const events = [];
  socket = new WebSocket(`${worker.replace('http:', 'ws:')}/ws`);
  socket.addEventListener('message', e => { if (e.data !== 'pong') events.push(JSON.parse(e.data)); });
  await once(socket, 'open');
  async function post(base, path, body, token = secret) {
    return fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  }
  assert.equal((await post(worker, '/publish', { type: 'presence', payload: null })).status, 404);
  assert.equal((await post(worker, '/api/ingest/homepod', {}, 'wrong')).status, 401);
  assert.equal((await post(worker, '/api/ingest/constructor', {})).status, 404);
  const invalidEnvelope = await post(worker, '/api/ingest/mac', {});
  assert.equal(invalidEnvelope.status, 400);
  assert.deepEqual(await invalidEnvelope.json(), { ok: false, error: '上报数据无效或处理失败' });
  const invalidJson = await fetch(`${worker}/api/ingest/mac`, {
    method: 'POST', headers: { authorization: `Bearer ${secret}` },
    body: '{"private-marker":',
  });
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await invalidJson.json(), { ok: false, error: '上报数据无效或处理失败' });
  assert.equal(invalidJson.headers.get('cache-control'), 'no-store');
  async function nowPlaying() {
    return (await (await fetch(`${worker}/api/status/listening/now`)).json()).data?.music?.title;
  }
  for (const title of ['isolated-first', 'isolated-second']) {
    const body = { entityId: 'media_player.isolated', state: 'playing', title, positionMs: 0, durationMs: 3600000, observedAt: Date.now() };
    assert.equal((await post(worker, '/api/ingest/homepod', body)).status, 202);
    await eventually(async () => assert.equal(await nowPlaying(), title));
    await eventually(async () => assert.ok(events.some(e => e.type === 'listening-now' && e.payload.music?.title === title)));
  }
  await eventually(async () => assert.ok(notices.some(n => n.tags?.includes('listening-now'))));
  await sleep(200);
  const homePodNotices = notices.length;
  await post(worker, '/api/ingest/homepod', { entityId: 'media_player.isolated', state: 'playing', title: 'isolated-second', positionMs: 2000, durationMs: 3600000, observedAt: Date.now() });
  await sleep(200);
  assert.equal(notices.length, homePodNotices, 'HomePod position heartbeat must not invalidate page');
  console.log('PASS: Worker write → Durable Object SQLite → /api/revalidate → direct Worker status; WebSocket receives both updates');
  const response = await post(worker, '/api/ingest/mac', { version: 4, heartbeatAt: Date.now(), presence: 'online', activeModules: ['timezone'], modules: { timezone: { identifier: 'Asia/Singapore', secondsFromGMT: 28800 } } });
  assert.equal(response.status, 202);
  await eventually(async () => assert.ok(notices.some(n => n.tags?.includes('timezone'))));
  const before = notices.length;
  assert.equal((await post(worker, '/api/ingest/mac', { version: 4, heartbeatAt: Date.now(), presence: 'online', activeModules: ['timezone'], modules: {} })).status, 202);
  await sleep(300);
  assert.equal(notices.length, before, 'Pure heartbeat must not invalidate page');
  const home = await (await fetch(`${worker}/api/home`)).json();
  assert.equal(home.timezone.ok, true);
  assert.equal((await fetch(`${worker}/api/internal/storage`)).status, 404);
  assert.equal((await post(worker, '/api/internal/storage', { commands: [] })).status, 405);
  assert.equal((await fetch(`${worker}/api/status/listening/now`, { headers: { Origin: 'http://localhost:3000' } })).headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.equal(JSON.stringify(home).includes('musicUserToken'), false);
  assert.equal(JSON.stringify(home).includes('developerToken'), false);
  console.log('PASS: public snapshot, CORS, private storage removed, heartbeat does not invalidate HTML');
  // Emby 正在播放：设备、播放方式和规格按契约收下、逐字段收敛，不认识的字段（外挂字幕的路径之类）不落库也不广播
  const embyMedia = {
    container: 'mkv', bitrate: 6421965,
    video: { codec: 'hevc', width: 3840, height: 1600, range: 'hdr10', bitDepth: 10 },
    audio: { codec: 'dts', profile: 'DTS-HD MA', channels: 8, layout: '7.1', language: 'jpn' },
    subtitle: { codec: 'srt', language: 'zh-CN', title: null, forced: false, external: true, path: '\\\\nas\\private.srt' },
  };
  const embyReport = await post(worker, '/api/ingest/emby', { playing: {
    itemId: 'isolated-episode', paused: false, positionTicks: 600_000_000, runTimeTicks: 14_400_000_000,
    client: 'Infuse-Direct', deviceName: 'iPad', playMethod: 'directplay', media: embyMedia,
    item: { id: 'isolated-episode', name: 'Pilot', type: 'Episode', serverId: null, seriesName: 'Isolated Show', season: 1, episode: 1, year: 2026, progress: 4.2, playedAt: null, posterKey: null, backdropKey: null },
  } });
  assert.equal(embyReport.status, 202, await embyReport.text());
  const expectedMedia = { ...embyMedia, subtitle: { codec: 'srt', language: 'zh-CN', title: null, forced: false, external: true } };
  await eventually(async () => {
    const now = (await (await fetch(`${worker}/api/status/watching/now`)).json()).data;
    assert.equal(now.nowPlaying?.client, 'Infuse-Direct');
    assert.equal(now.nowPlaying?.deviceName, 'iPad');
    assert.equal(now.nowPlaying?.playMethod, 'directplay');
    assert.deepEqual(now.nowPlaying?.media, expectedMedia);
    assert.equal(now.current?.title, 'Isolated Show');
  });
  await eventually(async () => assert.ok(events.some(e => e.type === 'watching-now' && e.payload.nowPlaying?.media?.audio?.profile === 'DTS-HD MA')));
  assert.equal(JSON.stringify(events).includes('private.srt'), false);
  const embyJunk = await post(worker, '/api/ingest/emby', { playing: {
    itemId: 'isolated-episode', paused: true, positionTicks: 700_000_000, runTimeTicks: 14_400_000_000,
    client: 'x'.repeat(200), deviceName: null, playMethod: 'Transcode', media: { video: { codec: 'hevc', range: 'HDR10', width: -1 } },
  } });
  assert.equal(embyJunk.status, 202);
  await eventually(async () => {
    const now = (await (await fetch(`${worker}/api/status/watching/now`)).json()).data;
    assert.equal(now.nowPlaying?.paused, true);
    assert.equal(now.nowPlaying?.client?.length, 64);
    assert.equal(now.nowPlaying?.playMethod, null, 'play method is case-sensitive lowercase');
    assert.deepEqual(now.nowPlaying?.media, { container: null, bitrate: null, video: { codec: 'hevc', width: null, height: null, range: null, bitDepth: null }, audio: null, subtitle: null });
  });
  assert.equal((await post(worker, '/api/ingest/emby', { playing: null })).status, 202);
  await eventually(async () => assert.equal((await (await fetch(`${worker}/api/status/watching/now`)).json()).data.nowPlaying, null));
  console.log('PASS: Emby playback carries device, play method and media spec; junk fields are dropped');
  // 一起听的 developer token：同源签发、可验签、两个时刻齐全；不走 StateHub，也不被公开 API 那条兜住
  const tokenResponse = await fetch(`${worker}/api/musickit/token`, { headers: { Origin: 'http://localhost:3000' } });
  const tokenBody = await tokenResponse.text();
  assert.equal(tokenResponse.status, 200, tokenBody);
  assert.equal(tokenResponse.headers.get('cache-control'), 'no-store');
  assert.equal(tokenResponse.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  const issued = JSON.parse(tokenBody);
  assert.ok(Number.isSafeInteger(issued.issuedAt) && issued.expiresAt === issued.issuedAt + 7 * 24 * 3600);
  const [tokenHeader, tokenPayload, tokenSignature] = issued.token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(tokenHeader, 'base64url')), { alg: 'ES256', kid: 'ISOLATEDKY' });
  assert.deepEqual(JSON.parse(Buffer.from(tokenPayload, 'base64url')), { iss: 'ISOLATEDTM', iat: issued.issuedAt, exp: issued.expiresAt });
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, musicKitKeys.publicKey, Buffer.from(tokenSignature, 'base64url'), Buffer.from(`${tokenHeader}.${tokenPayload}`)));
  assert.equal((await post(worker, '/api/musickit/token', {})).status, 405);
  console.log('PASS: /api/musickit/token issues a verifiable ES256 developer token');
  const coding = start(process.execPath, [join(root, 'scripts/verify-coding-usage.mjs'), '--base', worker, '--ingest', worker, '--storage-prefix', 'isolated-verify']);
  const [codingExit] = await once(coding, 'exit');
  assert.equal(codingExit, 0, logs.join(''));
  console.log('PASS: coding usage, limits, history and invalid-envelope regression');
  const concurrent = Array.from({ length: 8 }, (_, i) => post(worker, '/api/ingest/mac', {
    version: 4, heartbeatAt: Date.now(), presence: 'online', activeModules: ['timezone'],
    modules: i % 2 ? {} : { timezone: { identifier: 'Asia/Singapore', secondsFromGMT: 28800 } },
  }));
  assert.ok((await Promise.all(concurrent)).every(response => response.status === 202));
  assert.equal((await (await fetch(`${worker}/api/home`)).json()).timezone.ok, true);
  console.log('PASS: concurrent heartbeats preserve a separately updated module');
  socket.close();
  const exited = once(workerChild, 'exit');
  workerChild.kill('SIGTERM');
  await exited;
  start(process.execPath, [require.resolve('wrangler'), 'dev', '--config', configPath, '--port', String(workerPort), '--test-scheduled', '--persist-to', join(temporary, 'state')]);
  await eventually(async () => assert.equal(await nowPlaying(), 'isolated-second'));
  assert.equal((await (await fetch(`${worker}/api/home`)).json()).timezone.ok, true);
  console.log('PASS: restart preserves initialized state and snapshots');
  assert.equal(logs.some(line => /Cannot perform I\/O|\[storage\]|\[revalidate\]|Uncaught/.test(line)), false, logs.join(''));
} catch (error) {
  console.error(logs.join('').slice(-12000));
  throw error;
} finally {
  socket?.close();
  for (const child of children.reverse()) child.kill('SIGTERM');
  await Promise.all(children.map(child => child.exitCode === null ? Promise.race([once(child, 'exit'), sleep(3000).then(() => child.kill('SIGKILL'))]) : undefined));
  await rm(temporary, { recursive: true, force: true });
}
